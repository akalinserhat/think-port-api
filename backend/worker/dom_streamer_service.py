import asyncio
import json
from typing import Dict
import redis.asyncio as redis
from playwright.async_api import Page, Locator
from worker.dtos import BrowserJobDTO, ProviderSelectorsDTO, RedisStreamEventDTO
from worker.session_pool import WarmTabSession


PROVIDER_SELECTORS: Dict[str, ProviderSelectorsDTO] = {
    "chatgpt-web": ProviderSelectorsDTO(
        prompt_input="#prompt-textarea",
        send_button='button[data-testid="send-button"]',
        assistant_message='div[data-message-author-role="assistant"]',
        streaming_indicator='button[data-testid="stop-button"]',
    ),
    "claude-web": ProviderSelectorsDTO(
        prompt_input='div[contenteditable="true"]',
        send_button='button[aria-label="Send Message"]',
        assistant_message=".font-claude-message",
        streaming_indicator='button[aria-label="Stop Response"]',
    ),
}


class DomStreamerService:
    """
    Playwright DOM etkileşimini ve Redis Pub/Sub delta yayınını yöneten servis.
    Her metot yalnızca tek bir DOM veya yayın adımından sorumludur.
    """

    def __init__(self, redis_client: redis.Redis) -> None:
        self._redis = redis_client

    async def execute_and_stream(
        self,
        session: WarmTabSession,
        job: BrowserJobDTO,
    ) -> None:
        """Prompt gönderimini, DOM yanıt beklemesini ve Redis delta akışını koordine eder."""
        page = session.page
        selectors = self._resolve_selectors(session.provider)
        channel = f"stream:{job.job_id}"

        if await self._has_cloudflare_challenge(page):
            await self.publish_event(
                channel,
                RedisStreamEventDTO(
                    event="error",
                    message="Cloudflare challenge tespit edildi, oturum rotasyona alındı.",
                ),
            )
            return

        msg_locator = page.locator(selectors.assistant_message)
        initial_count = await msg_locator.count()

        await self._type_and_submit_prompt(page, selectors, job.prompt)

        if not await self._wait_for_assistant_bubble(msg_locator, initial_count):
            await self.publish_event(
                channel,
                RedisStreamEventDTO(
                    event="error",
                    message="Asistan yanıtı zaman aşımına uğradı (DOM oluşmadı).",
                ),
            )
            return

        last_msg = msg_locator.nth(await msg_locator.count() - 1)
        timed_out = await self._stream_deltas_until_complete(
            page,
            last_msg,
            selectors,
            channel,
        )
        if timed_out:
            await self.publish_event(
                channel,
                RedisStreamEventDTO(
                    event="error",
                    message="Web Gateway DOM akışı zaman aşımına uğradı (90s).",
                ),
            )
            return
        await self.publish_event(channel, RedisStreamEventDTO(event="done"))

    async def publish_event(self, channel: str, event_dto: RedisStreamEventDTO) -> None:
        """Tek bir RedisStreamEventDTO nesnesini JSON olarak ilgili kanala yayınlar."""
        await self._redis.publish(channel, json.dumps(event_dto.to_payload_dict()))

    @staticmethod
    def _resolve_selectors(provider: str) -> ProviderSelectorsDTO:
        """Sağlayıcı adına göre DOM seçici DTO'sunu döner."""
        return PROVIDER_SELECTORS.get(provider, PROVIDER_SELECTORS["chatgpt-web"])

    @staticmethod
    async def _has_cloudflare_challenge(page: Page) -> bool:
        """Sayfa başlığından Cloudflare veya anti-bot engeli olup olmadığını kontrol eder."""
        title = await page.title()
        return "Just a moment" in title or "Attention Required" in title

    @staticmethod
    async def _type_and_submit_prompt(
        page: Page,
        selectors: ProviderSelectorsDTO,
        prompt: str,
    ) -> None:
        """İstem metnini giriş kutusuna yazar ve Enter tuşuyla gönderir."""
        input_box = page.locator(selectors.prompt_input).first
        await input_box.click()
        await input_box.fill(prompt)
        await page.keyboard.press("Enter")

    @staticmethod
    async def _wait_for_assistant_bubble(msg_locator: Locator, initial_count: int) -> bool:
        """DOM üzerinde yeni bir asistan mesaj balonunun oluşmasını bekler."""
        for _ in range(100):
            if await msg_locator.count() > initial_count:
                return True
            await asyncio.sleep(0.1)
        return False

    async def _stream_deltas_until_complete(
        self,
        page: Page,
        last_msg: Locator,
        selectors: ProviderSelectorsDTO,
        channel: str,
        max_duration_sec: float = 90.0,
    ) -> bool:
        """Asistan mesaj balonundaki yeni karakterleri izleyerek anlık delta olarak yayınlar."""
        sent_length = 0
        stable_ticks = 0
        deadline = asyncio.get_running_loop().time() + max_duration_sec

        while True:
            if asyncio.get_running_loop().time() >= deadline:
                return sent_length == 0

            current_text = await last_msg.inner_text()
            if len(current_text) > sent_length:
                delta_chunk = current_text[sent_length:]
                sent_length = len(current_text)
                stable_ticks = 0
                await self.publish_event(
                    channel,
                    RedisStreamEventDTO(event="delta", text=delta_chunk),
                )
            else:
                stable_ticks += 1

            is_generating = await page.locator(selectors.streaming_indicator).count() > 0
            if not is_generating and stable_ticks >= 8 and sent_length > 0:
                return False

            await asyncio.sleep(0.12)
