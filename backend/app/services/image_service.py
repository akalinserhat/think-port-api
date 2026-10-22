import asyncio
import base64
import json
import re
import ssl
import time
import urllib.parse
import urllib.request
import uuid
from typing import Callable, List, Optional, Tuple
from app.core.config import settings, IMAGE_STYLE_MODIFIERS
from app.core.security import create_verified_ssl_context, create_unverified_ssl_context
from app.core.exceptions import resource_not_found_error
from app.dtos.image_dto import (
    ImageGenerationRequestDTO,
    ImageDataItemDTO,
    ImageGenerationResponseDTO,
    ImageDimensionsDTO,
    GeneratedImageResultDTO,
    CachedImageDTO,
)
from app.dtos.user_dto import AuthenticatedUserContextDTO
from app.dtos.admin_dto import RecordUsageInputDTO
from app.repositories.telemetry_repository import ImageCacheRepository
from app.services.model_service import ModelService
from app.services.llm_provider_service import LlmProviderService
from app.services.document_service import DocumentService


class ImageService:
    """
    Yapay zeka görsel üretim ve önbellek servisi.
    Her görsel üretim sağlayıcısı (HF ZeroGPU FLUX, Pollinations, Stable Horde, SVG Fallback)
    ve yardımcı işlem (boyut ayrıştırma, istem çevirisi, önbellek) tek görevli metotlara ayrılmıştır.
    """

    def __init__(
        self,
        image_cache_repo: ImageCacheRepository,
        model_service: ModelService,
        llm_provider: LlmProviderService,
        record_usage_fn: Callable[[RecordUsageInputDTO], None],
    ) -> None:
        self._cache_repo = image_cache_repo
        self._model_service = model_service
        self._llm_provider = llm_provider
        self._record_usage = record_usage_fn

    async def generate_images(
        self,
        request: ImageGenerationRequestDTO,
        user_ctx: AuthenticatedUserContextDTO,
    ) -> ImageGenerationResponseDTO:
        """OpenAI /v1/images/generations isteğini işler, görselleri üretir ve kullanımı kaydeder."""
        t0 = time.perf_counter()
        dimensions = self.parse_size_string(request.size)
        target_model = request.model or "flux"
        engine_model = self._resolve_engine_image_model(target_model)

        items: List[ImageDataItemDTO] = []
        count = max(1, min(4, request.n or 1))
        for idx in range(count):
            seed_val = (request.seed + idx) if request.seed is not None else None
            generated = await asyncio.to_thread(
                self.generate_single_image_sync,
                request.prompt,
                engine_model,
                dimensions.width,
                dimensions.height,
                seed_val,
            )
            items.append(self._map_to_image_data_item(generated, request.prompt, request.response_format))

        latency_ms = int((time.perf_counter() - t0) * 1000)
        self._record_usage(
            RecordUsageInputDTO(
                user_id=user_ctx.user_id,
                request_id=f"img-{uuid.uuid4().hex[:12]}",
                model=target_model,
                prompt_tokens=DocumentService.estimate_tokens(request.prompt),
                completion_tokens=250 * count,
                is_stream=False,
                latency_ms=latency_ms,
                session_id="pollinations-image",
            )
        )
        return ImageGenerationResponseDTO(data=items)

    def get_cached_image_or_404(self, image_id: str) -> CachedImageDTO:
        """Önbellekteki görseli döner; bulunamazsa 404 HTTPException fırlatır."""
        cached = self._cache_repo.get_by_id(image_id)
        if not cached:
            raise resource_not_found_error("Görsel bulunamadı veya süresi doldu.")
        return cached

    def generate_single_image_sync(
        self,
        prompt: str,
        image_model: str = "flux",
        width: int = 1024,
        height: int = 1024,
        seed: Optional[int] = None,
    ) -> GeneratedImageResultDTO:
        """Tek bir görseli sağlayıcı zinciriyle üretir, önbelleğe kaydeder ve DTO döner."""
        clean_prompt, dims = self.extract_inline_size_directive(prompt, width, height)
        used_seed = seed if seed is not None else (int(time.time() * 1000) % 999999)
        enhanced_prompt = self._build_enhanced_english_prompt(clean_prompt, image_model)

        raw_bytes, media_type = self._fetch_from_provider_chain(
            enhanced_prompt, image_model, dims.width, dims.height, used_seed
        )
        if not raw_bytes:
            raw_bytes, media_type = self._build_fallback_svg(
                clean_prompt, image_model, dims.width, dims.height, used_seed
            )

        ext = self._resolve_file_extension(media_type)
        image_id = f"img_{uuid.uuid4().hex[:14]}.{ext}"
        self._cache_repo.save(
            CachedImageDTO(
                image_id=image_id,
                raw_bytes=raw_bytes,
                media_type=media_type,
                prompt=clean_prompt,
                model=image_model,
                width=dims.width,
                height=dims.height,
                seed=used_seed,
            )
        )
        return GeneratedImageResultDTO(
            image_id=image_id,
            raw_bytes=raw_bytes,
            media_type=media_type,
            width=dims.width,
            height=dims.height,
            used_seed=used_seed,
            clean_prompt=clean_prompt,
        )

    @staticmethod
    def parse_size_string(size_str: Optional[str]) -> ImageDimensionsDTO:
        """'1024x1024' biçimindeki boyut dizgesini güvenli sınırlar içinde ayrıştırır."""
        width, height = 1024, 1024
        if size_str and "x" in size_str:
            parts = size_str.lower().split("x", 1)
            if parts[0].isdigit() and parts[1].isdigit():
                width = max(256, min(1536, int(parts[0])))
                height = max(256, min(1536, int(parts[1])))
        return ImageDimensionsDTO(width=width, height=height)

    @staticmethod
    def extract_inline_size_directive(
        prompt: str,
        default_w: int = 1024,
        default_h: int = 1024,
    ) -> Tuple[str, ImageDimensionsDTO]:
        """İstem içindeki '[size:WxH]' etiketini ayıklar ve temizlenmiş istemi döner."""
        clean = prompt.strip()
        w, h = default_w, default_h
        match = re.search(r"\[size:(\d+)x(\d+)\]", clean)
        if match:
            w = max(256, min(1536, int(match.group(1))))
            h = max(256, min(1536, int(match.group(2))))
            clean = re.sub(r"\[size:\d+x\d+\]", "", clean).strip()
        if not clean:
            clean = "Futuristic artificial intelligence gateway studio, cinematic lighting, 8k"
        return clean, ImageDimensionsDTO(width=w, height=h)

    def _resolve_engine_image_model(self, model_id: str) -> str:
        """Model tanımlayıcısından gerçek görsel motoru adını bulur."""
        definition = self._model_service.find_image_model(model_id)
        return (definition.image_model or model_id) if definition else model_id

    @staticmethod
    def _map_to_image_data_item(
        generated: GeneratedImageResultDTO,
        original_prompt: str,
        response_format: Optional[str],
    ) -> ImageDataItemDTO:
        """Üretilen görseli URL veya Base64 formatında ImageDataItemDTO nesnesine dönüştürür."""
        if response_format == "b64_json":
            return ImageDataItemDTO(
                b64_json=base64.b64encode(generated.raw_bytes).decode("utf-8"),
                revised_prompt=original_prompt,
            )
        return ImageDataItemDTO(
            url=f"/v1/images/files/{generated.image_id}",
            revised_prompt=original_prompt,
        )

    def _build_enhanced_english_prompt(self, prompt: str, image_model: str) -> str:
        """İstemi gerekirse İngilizceye çevirir ve modele özgü stil niteleyicilerini ekler."""
        style_suffix = IMAGE_STYLE_MODIFIERS.get(image_model, IMAGE_STYLE_MODIFIERS["flux"])
        english_core = prompt
        if self._requires_translation(prompt):
            translator = self._model_service.select_best_local_model("qwen2.5:7b")
            if translator:
                translated = self._llm_provider.translate_prompt_via_ollama(prompt, translator)
                if translated:
                    english_core = translated
        return f"{english_core}, {style_suffix}"

    @staticmethod
    def _requires_translation(prompt: str) -> bool:
        """İstemin Türkçe karakter veya yaygın Türkçe kelimeler içerip içermediğini denetler."""
        tr_chars = set("çğıöşüÇĞİÖŞÜ")
        if any(c in tr_chars for c in prompt):
            return True
        common_tr_words = {
            "bir", "ve", "ile", "içinde", "üstünde", "ufukta", "görünen",
            "yelkenli", "kedi", "köpek", "manzara", "deniz", "güneş",
            "uzay", "şehir", "portre", "çiz", "oluştur", "resim", "görsel",
        }
        words_lower = set(re.findall(r"\w+", prompt.lower()))
        return bool(words_lower & common_tr_words)

    def _fetch_from_provider_chain(
        self,
        prompt: str,
        image_model: str,
        width: int,
        height: int,
        seed: int,
    ) -> Tuple[Optional[bytes], str]:
        """Üç aşamalı sağlayıcı zincirini (HF FLUX -> Pollinations -> Stable Horde) sırasıyla dener."""
        for ctx in (create_verified_ssl_context(), create_unverified_ssl_context()):
            raw_bytes, media_type = self._generate_via_hf_flux(prompt, width, height, seed, ctx)
            if raw_bytes:
                return raw_bytes, media_type

            raw_bytes, media_type = self._generate_via_pollinations(
                prompt, image_model, width, height, seed, ctx
            )
            if raw_bytes:
                return raw_bytes, media_type

            raw_bytes, media_type = self._generate_via_stable_horde(prompt, width, height, seed, ctx)
            if raw_bytes:
                return raw_bytes, media_type

        return None, "image/jpeg"

    def _generate_via_hf_flux(
        self,
        prompt: str,
        width: int,
        height: int,
        seed: int,
        ctx: ssl.SSLContext,
    ) -> Tuple[Optional[bytes], str]:
        """Hugging Face ZeroGPU FLUX.1-schnell uzayından görsel üretir."""
        base_url = settings.hf_flux_space_url
        event_id = self._submit_hf_gradio_job(base_url, prompt, width, height, seed, ctx)
        if not event_id:
            return None, ""
        image_url = self._read_hf_gradio_stream_url(base_url, event_id, ctx)
        if not image_url:
            return None, ""
        return self._download_binary_image(image_url, ctx, default_mime="image/webp")

    @staticmethod
    def _submit_hf_gradio_job(
        base_url: str,
        prompt: str,
        width: int,
        height: int,
        seed: int,
        ctx: ssl.SSLContext,
    ) -> Optional[str]:
        """HF Gradio /call/infer uç noktasına üretim işini başlatır ve event_id döner."""
        try:
            payload = json.dumps(
                {
                    "data": [
                        prompt,
                        int(seed) % 2147483647,
                        False,
                        max(256, min(1536, (width // 32) * 32)),
                        max(256, min(1536, (height // 32) * 32)),
                        4,
                    ]
                }
            ).encode("utf-8")
            req = urllib.request.Request(
                f"{base_url}/gradio_api/call/infer",
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
                if resp.status != 200:
                    return None
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("event_id")
        except Exception:
            return None

    @staticmethod
    def _read_hf_gradio_stream_url(
        base_url: str,
        event_id: str,
        ctx: ssl.SSLContext,
    ) -> Optional[str]:
        """HF Gradio SSE akışını dinleyerek üretilen görselin indirme adresini alır."""
        try:
            req = urllib.request.Request(
                f"{base_url}/gradio_api/call/infer/{event_id}",
                headers={
                    "Accept": "text/event-stream",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=45, context=ctx) as sresp:
                current_event = ""
                while True:
                    raw_line = sresp.fp.readline()
                    if not raw_line:
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if line.startswith("event:"):
                        current_event = line[6:].strip()
                    elif line.startswith("data:"):
                        if current_event == "error":
                            return None
                        url = ImageService._parse_gradio_file_url(base_url, line[5:].strip())
                        if url:
                            return url
        except Exception:
            pass
        return None

    @staticmethod
    def _parse_gradio_file_url(base_url: str, data_str: str) -> Optional[str]:
        """Gradio SSE veri satırından dosya URL'sini çıkarır."""
        try:
            parsed = json.loads(data_str)
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                file_info = parsed[0]
                if file_info.get("url"):
                    return str(file_info["url"])
                if file_info.get("path"):
                    return f"{base_url}/gradio_api/file={file_info['path']}"
        except Exception:
            pass
        return None

    def _generate_via_pollinations(
        self,
        prompt: str,
        image_model: str,
        width: int,
        height: int,
        seed: int,
        ctx: ssl.SSLContext,
    ) -> Tuple[Optional[bytes], str]:
        """Pollinations.ai ücretsiz görsel uç noktalarını sırasıyla dener."""
        encoded = urllib.parse.quote(prompt)
        mapped = "z-image" if image_model == "turbo" else "flux"
        candidate_urls = [
            f"https://image.pollinations.ai/prompt/{encoded}?model=sana&width={width}&height={height}&seed={seed}&nologo=true",
            f"https://image.pollinations.ai/prompt/{encoded}?model={mapped}&width={width}&height={height}&seed={seed}&nologo=true",
            f"https://gen.pollinations.ai/image/{encoded}?model={mapped}&width={width}&height={height}&seed={seed}&nologo=true",
            f"https://gen.pollinations.ai/image/{encoded}?model=z-image&width={width}&height={height}&seed={seed}&nologo=true",
            f"https://gen.pollinations.ai/image/{encoded}?model=sana&width={width}&height={height}&seed={seed}&nologo=true",
        ]
        for url in candidate_urls:
            raw_bytes, ctype = self._download_binary_image(url, ctx, default_mime="image/jpeg")
            if raw_bytes:
                return raw_bytes, ctype
        return None, ""

    def _generate_via_stable_horde(
        self,
        prompt: str,
        width: int,
        height: int,
        seed: int,
        ctx: ssl.SSLContext,
    ) -> Tuple[Optional[bytes], str]:
        """AI Horde / Stable Horde dağıtık GPU kümesinden görsel üretir."""
        req_id = self._submit_stable_horde_job(prompt, width, height, seed, ctx)
        if not req_id:
            return None, ""
        return self._poll_stable_horde_job(req_id, ctx)

    @staticmethod
    def _submit_stable_horde_job(
        prompt: str,
        width: int,
        height: int,
        seed: int,
        ctx: ssl.SSLContext,
    ) -> Optional[str]:
        """Stable Horde asenkron üretim kuyruğuna iş gönderir."""
        try:
            h_w = max(384, min(768, (width // 64) * 64))
            h_h = max(384, min(768, (height // 64) * 64))
            payload = json.dumps(
                {
                    "prompt": prompt,
                    "params": {
                        "steps": 20,
                        "width": h_w,
                        "height": h_h,
                        "seed": str(seed),
                        "sampler_name": "k_euler_a",
                    },
                    "nsfw": False,
                    "censor_nsfw": False,
                    "r2": True,
                }
            ).encode("utf-8")
            req = urllib.request.Request(
                f"{settings.stable_horde_base_url}/generate/async",
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "apikey": "0000000000",
                    "Client-Agent": "ThinkPortAPI:2.0:local",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=12, context=ctx) as resp:
                if resp.status not in (200, 202):
                    return None
                return json.loads(resp.read().decode("utf-8")).get("id")
        except Exception:
            return None

    def _poll_stable_horde_job(
        self,
        req_id: str,
        ctx: ssl.SSLContext,
    ) -> Tuple[Optional[bytes], str]:
        """Stable Horde işinin tamamlanmasını bekler ve üretilen görseli indirir."""
        try:
            for _ in range(12):
                time.sleep(2.5)
                st_req = urllib.request.Request(
                    f"{settings.stable_horde_base_url}/generate/status/{req_id}",
                    headers={
                        "Client-Agent": "ThinkPortAPI:2.0:local",
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
                    },
                    method="GET",
                )
                with urllib.request.urlopen(st_req, timeout=10, context=ctx) as st_resp:
                    st_data = json.loads(st_resp.read().decode("utf-8"))
                    if st_data.get("done") and st_data.get("generations"):
                        img_field = st_data["generations"][0].get("img", "")
                        if img_field.startswith("http"):
                            return self._download_binary_image(img_field, ctx, "image/webp")
                        if img_field:
                            raw = base64.b64decode(img_field)
                            if len(raw) > 2048:
                                return raw, "image/webp"
                        break
                    if st_data.get("faulted"):
                        break
        except Exception:
            pass
        return None, ""

    @staticmethod
    def _download_binary_image(
        url: str,
        ctx: ssl.SSLContext,
        default_mime: str = "image/jpeg",
    ) -> Tuple[Optional[bytes], str]:
        """Verilen URL'den ikili görsel verisini indirir ve boyut/MIME doğrulaması yapar."""
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                if resp.status == 200:
                    data = resp.read()
                    ctype = resp.headers.get("Content-Type", default_mime).split(";")[0].strip()
                    if len(data) > 2048 and ctype.startswith("image/"):
                        return data, ctype
        except Exception:
            pass
        return None, ""

    @staticmethod
    def _build_fallback_svg(
        clean_prompt: str,
        image_model: str,
        width: int,
        height: int,
        seed: int,
    ) -> Tuple[bytes, str]:
        """Dış servisler erişilemez olduğunda yüksek çözünürlüklü vektörel SVG poster üretir."""
        safe_title = (
            clean_prompt[:90]
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        svg_markup = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="50%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#311042"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="42%" r="45%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="#ec4899" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="{width // 2}" cy="{int(height * 0.42)}" r="{int(min(width, height) * 0.38)}" fill="url(#glow)"/>
  <circle cx="{width // 2}" cy="{int(height * 0.42)}" r="{int(min(width, height) * 0.18)}" fill="none" stroke="#818cf8" stroke-width="2" stroke-opacity="0.45"/>
  <circle cx="{width // 2}" cy="{int(height * 0.42)}" r="{int(min(width, height) * 0.27)}" fill="none" stroke="#f472b6" stroke-width="1.5" stroke-dasharray="8 8" stroke-opacity="0.35"/>
  <text x="50%" y="44%" text-anchor="middle" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="28" font-weight="700">{image_model.upper()} · AI STUDIO</text>
  <text x="50%" y="52%" text-anchor="middle" fill="#cbd5e1" font-family="system-ui, sans-serif" font-size="18">{safe_title}</text>
  <text x="50%" y="92%" text-anchor="middle" fill="#64748b" font-family="monospace" font-size="13">{width}x{height} · seed:{seed}</text>
</svg>"""
        return svg_markup.encode("utf-8"), "image/svg+xml"

    @staticmethod
    def _resolve_file_extension(media_type: str) -> str:
        """MIME tipine göre dosya uzantısını belirler."""
        if media_type == "image/svg+xml":
            return "svg"
        if "webp" in media_type:
            return "webp"
        if "png" in media_type:
            return "png"
        return "jpg"
