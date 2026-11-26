"""
ThinkPort AI Gateway - Modüler Belge Ayrıştırıcı Arayüzü (base.py).
Her dosya formatı için ayrı olarak kodlanan Markdown dönüştürücülerin ortak sözleşmesini tanımlar.
"""
from abc import ABC, abstractmethod
from typing import Tuple


class IDocumentParser(ABC):
    """Tüm belge formatı ayrıştırıcılarının uyguladığı temel arayüz."""

    @property
    @abstractmethod
    def supported_extensions(self) -> Tuple[str, ...]:
        """Bu ayrıştırıcının desteklediği küçük harfli dosya uzantıları (örn. ('.pdf',))."""
        raise NotImplementedError

    def can_parse(self, filename: str, raw_bytes: bytes) -> bool:
        """Dosya adı veya ham bayt imzasına göre bu ayrıştırıcının uygun olup olmadığını döner."""
        lower_name = (filename or "").strip().lower()
        return any(lower_name.endswith(ext) for ext in self.supported_extensions)

    @abstractmethod
    def parse_to_markdown(self, filename: str, raw_bytes: bytes) -> str:
        """Verilen ikili dosya içeriğini LLM dostu yapılandırılmış Markdown metnine dönüştürür."""
        raise NotImplementedError
