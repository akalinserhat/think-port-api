"""
ThinkPort AI Gateway Unit Test Suite.
Stubs postgres_db connection on module load to allow tests to run offline
and within restricted sandbox environments without socket permission errors.
"""
import sys
from unittest.mock import MagicMock

if "app.repositories.postgres_db" not in sys.modules:
    mock_pg_db = MagicMock()
    mock_db_mod = MagicMock()
    mock_db_mod.postgres_db = mock_pg_db
    mock_db_mod.sqlite_db = mock_pg_db
    mock_db_mod.PostgresDatabaseManager = MagicMock
    sys.modules["app.repositories.postgres_db"] = mock_db_mod
