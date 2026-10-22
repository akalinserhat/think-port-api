from pydantic import BaseModel


class ParseFileRequestDTO(BaseModel):
    """Dosya içerik çözümleme (metin çıkarımı) isteği DTO'su."""

    filename: str
    mime_type: str = ""
    base64_data: str


class ParseFileResponseDTO(BaseModel):
    """Dosya içerik çözümleme yanıt DTO'su."""

    filename: str
    extracted_text: str
    char_count: int
    estimated_tokens: int
