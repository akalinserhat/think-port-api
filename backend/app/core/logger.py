import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import List

LOG_DIR = Path(__file__).resolve().parents[2] / "logs"
LOG_FILE_PATH = LOG_DIR / "gateway.log"


def _setup_gateway_logger() -> logging.Logger:
    """Dosya ve konsol çıktılı merkezi Gateway loglayıcısını yapılandırır."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("openai_gateway")
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-7s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    file_handler = RotatingFileHandler(
        LOG_FILE_PATH,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    return logger


gateway_logger = _setup_gateway_logger()


def read_recent_log_lines(max_lines: int = 200) -> List[str]:
    """gateway.log dosyasındaki son N satırı en güncelden eskiye doğru döner."""
    if not LOG_FILE_PATH.is_file():
        return []
    try:
        lines = LOG_FILE_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
        return list(reversed(lines[-max_lines:]))
    except Exception:
        return []


def clear_log_file() -> None:
    """gateway.log dosyasının içeriğini temizler."""
    if LOG_FILE_PATH.is_file():
        LOG_FILE_PATH.write_text("", encoding="utf-8")
