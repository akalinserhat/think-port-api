from pydantic import BaseModel, Field


class CreateUserRequestDTO(BaseModel):
    """Yeni kullanıcı oluşturma isteği DTO'su."""

    email: str
    full_name: str = "Yeni Kullanıcı"
    role: str = "user"
    token_quota: int = Field(default=250000, ge=1000)
    rpm_limit: int = Field(default=20, ge=1, le=10000)


class UserResponseDTO(BaseModel):
    """Kullanıcı bilgilerini temsil eden yanıt DTO'su."""

    id: str
    email: str
    full_name: str
    role: str
    status: str
    token_quota: int
    tokens_used: int
    rpm_limit: int
    concurrent_limit: int
    created_at: str


class AuthenticatedUserContextDTO(BaseModel):
    """Doğrulanmış API isteğinin kullanıcı ve kota bağlamı DTO'su."""

    user_id: str
    email: str
    api_key_id: str
    token_quota: int
    tokens_used: int
    rpm_limit: int
    concurrent_limit: int
