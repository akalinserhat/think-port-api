from fastapi import HTTPException, status


def build_openai_error_exception(
    status_code: int,
    message: str,
    error_type: str,
    code: str,
) -> HTTPException:
    """OpenAI REST API hata şemasıyla birebir uyumlu HTTPException üretir."""
    return HTTPException(
        status_code=status_code,
        detail={
            "error": {
                "message": message,
                "type": error_type,
                "code": code,
            }
        },
    )


def invalid_auth_header_error() -> HTTPException:
    """Geçersiz Authorization başlığı hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_401_UNAUTHORIZED,
        message="Geçersiz Authorization başlığı. 'Bearer sk-gw-...' formatında olmalıdır.",
        error_type="invalid_request_error",
        code="invalid_api_key",
    )


def invalid_api_key_error() -> HTTPException:
    """Geçersiz veya iptal edilmiş API anahtarı hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_401_UNAUTHORIZED,
        message="API anahtarı geçersiz veya iptal edilmiş.",
        error_type="invalid_request_error",
        code="invalid_api_key",
    )


def expired_api_key_error() -> HTTPException:
    """Süresi dolmuş API anahtarı hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_401_UNAUTHORIZED,
        message="API anahtarının kullanım süresi dolmuş.",
        error_type="invalid_request_error",
        code="expired_api_key",
    )


def account_suspended_error(current_status: str) -> HTTPException:
    """Askıya alınmış veya aktif olmayan kullanıcı hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_403_FORBIDDEN,
        message=f"Kullanıcı hesabı aktif değil ({current_status}).",
        error_type="permission_error",
        code="account_suspended",
    )


def quota_exceeded_error() -> HTTPException:
    """Token kotası aşımı hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        message="Tanımlanan token/kredi kotanız dolmuştur.",
        error_type="insufficient_quota",
        code="insufficient_quota",
    )


def rpm_limit_exceeded_error(rpm_limit: int) -> HTTPException:
    """Dakikalık istek sınırı (RPM) aşımı hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        message=f"Dakikalık istek sınırını ({rpm_limit} RPM) aştınız.",
        error_type="rate_limit_error",
        code="rate_limit_exceeded",
    )


def concurrency_limit_exceeded_error(concurrent_limit: int) -> HTTPException:
    """Eşzamanlı maksimum istek sınırı aşımı hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        message=f"Maksimum eşzamanlı istek sınırına ({concurrent_limit}) ulaştınız.",
        error_type="rate_limit_error",
        code="concurrency_limit_exceeded",
    )


def gateway_timeout_error(
    message: str = "Web AI Gateway zaman aşımına uğradı. Alt sağlayıcıdan belirlenen sürede yanıt alınamadı.",
    code: str = "gateway_timeout",
) -> HTTPException:
    """504 OpenAI standartlarında Gateway Timeout hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_504_GATEWAY_TIMEOUT,
        message=message,
        error_type="gateway_timeout",
        code=code,
    )


def upstream_provider_error(
    message: str = "Alt yapay zeka sağlayıcısından geçerli bir yanıt alınamadı.",
    code: str = "upstream_error",
) -> HTTPException:
    """502 OpenAI standartlarında alt sağlayıcı (upstream) hatası döner."""
    return build_openai_error_exception(
        status_code=status.HTTP_502_BAD_GATEWAY,
        message=message,
        error_type="gateway_timeout",
        code=code,
    )


def resource_not_found_error(detail_message: str) -> HTTPException:
    """404 Kaynak bulunamadı hatası döner."""
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail_message)


def bad_request_error(detail_message: str) -> HTTPException:
    """400 Geçersiz istek hatası döner."""
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail_message)


def forbidden_access_error(detail_message: str) -> HTTPException:
    """403 Yetkisiz erişim hatası döner."""
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail_message)

