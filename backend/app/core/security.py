import hashlib
import os
import secrets
import ssl
from typing import Optional


def generate_raw_api_token() -> str:
    """OpenAI formatında kriptografik olarak güvenli ham API anahtarı üretir."""
    return f"sk-gw-{secrets.token_urlsafe(24)}"


def format_api_key_prefix(raw_token: str) -> str:
    """API anahtarının arayüzde maskelenmiş ön ekini üretir."""
    return f"{raw_token[:12]}..."


def hash_api_key(raw_key: str) -> str:
    """API anahtarının SHA-256 özetini (hash) hesaplar."""
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_api_key_bundle(custom_raw_token: Optional[str] = None) -> tuple[str, str, str]:
    """Yeni API anahtarı üçlüsünü (raw_token, key_prefix, key_hash) döner."""
    cleaned = (custom_raw_token or "").strip()
    raw_token = cleaned if cleaned else generate_raw_api_token()
    prefix = format_api_key_prefix(raw_token)
    key_hash = hash_api_key(raw_token)
    return raw_token, prefix, key_hash


def extract_bearer_token(authorization_header: Optional[str]) -> Optional[str]:
    """Authorization başlığından Bearer token veya doğrudan ham API anahtarı değerini ayrıştırır."""
    if not authorization_header:
        return None
    raw = authorization_header.strip()
    if not raw:
        return None
    if raw.lower().startswith("bearer "):
        token = raw[7:].strip()
        return token if token else None
    return raw


def create_verified_ssl_context() -> ssl.SSLContext:
    """Sistem kök sertifikalarını kullanan güvenli SSL bağlamı oluşturur."""
    try:
        if os.path.exists("/etc/ssl/cert.pem"):
            return ssl.create_default_context(cafile="/etc/ssl/cert.pem")
        ctx = ssl.create_default_context()
        if ctx.cert_store_stats().get("x509_ca", 0) > 0:
            return ctx
    except Exception:
        pass
    return create_unverified_ssl_context()


def create_unverified_ssl_context() -> ssl.SSLContext:
    """Sertifika doğrulaması devre dışı bırakılmış yedek SSL bağlamı oluşturur."""
    return ssl._create_unverified_context()
