"""
think-port-api - Sanal Tarayıcı Ters Proxy Yönlendiricisi (browser_proxy_router.py)
Frontend ve API tüketicilerinden gelen /api/browser isteklerini akalin-browser-module (port 8002) servisine iletir.
"""
from __future__ import annotations
import os
import urllib.error
import urllib.request
from fastapi import APIRouter, Request, Response

router = APIRouter(prefix="/api/browser", tags=["Virtual Browser Proxy"])
BROWSER_SERVICE_URL = os.getenv("BROWSER_SERVICE_URL", "http://localhost:8002").rstrip("/")


@router.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def proxy_browser_request(full_path: str, request: Request) -> Response:
    """Tüm /api/browser isteklerini akalin-browser-module servisine ters proxy (reverse proxy) olarak iletir."""
    target_url = f"{BROWSER_SERVICE_URL}/api/browser/{full_path}"
    if request.url.query:
        target_url = f"{target_url}?{request.url.query}"

    body = await request.body()
    forward_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "connection")
    }

    req = urllib.request.Request(
        url=target_url,
        data=body if body else None,
        headers=forward_headers,
        method=request.method,
    )

    try:
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            content = resp.read()
            media_type = resp.headers.get("content-type", "application/json")
            return Response(content=content, status_code=resp.status, media_type=media_type)
    except urllib.error.HTTPError as exc:
        err_content = exc.read()
        media_type = exc.headers.get("content-type", "application/json")
        return Response(content=err_content, status_code=exc.code, media_type=media_type)
    except Exception as exc:
        return Response(
            content=f'{{"error": "Sanal tarayıcı servisine ({BROWSER_SERVICE_URL}) ulaşılamadı: {str(exc)}"}}'.encode("utf-8"),
            status_code=502,
            media_type="application/json",
        )
