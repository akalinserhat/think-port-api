import sys
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

if "app.repositories.postgres_db" not in sys.modules:
    mock_pg_db = MagicMock()
    mock_db_mod = MagicMock()
    mock_db_mod.postgres_db = mock_pg_db
    mock_db_mod.sqlite_db = mock_pg_db
    mock_db_mod.PostgresDatabaseManager = MagicMock
    sys.modules["app.repositories.postgres_db"] = mock_db_mod

from fastapi import HTTPException
from app.core.security import hash_api_key
from app.dtos.api_key_dto import ApiKeyRecordDTO
from app.dtos.user_dto import UserResponseDTO
from app.services.auth_service import AuthService


class TestAuthServiceUnit(unittest.TestCase):
    """Unit tests for AuthService: composite tokens, defaulting, header fallbacks, HTTP 401s."""

    def setUp(self):
        self.user_repo = MagicMock()
        self.api_key_repo = MagicMock()
        self.usage_repo = MagicMock()

        self.valid_raw_key = "sk-gw-active-key"
        self.valid_hash = hash_api_key(self.valid_raw_key)
        self.key_record = ApiKeyRecordDTO(
            id="key_11aca43f",
            user_id="user_test_01",
            name="Serhat API Key",
            key_prefix="sk-gw-activ...",
            raw_preview="sk-gw-active-key",
            key_hash=self.valid_hash,
            is_active=True,
            expires_at=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        self.inactive_raw_key = "sk-gw-inactive-key"
        self.inactive_hash = hash_api_key(self.inactive_raw_key)
        self.inactive_key_record = ApiKeyRecordDTO(
            id="key_inactive_01",
            user_id="user_test_01",
            name="Inactive Key",
            key_prefix="sk-gw-inact...",
            raw_preview=None,
            key_hash=self.inactive_hash,
            is_active=False,
            expires_at=None,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        self.expired_raw_key = "sk-gw-expired-key"
        self.expired_hash = hash_api_key(self.expired_raw_key)
        self.expired_key_record = ApiKeyRecordDTO(
            id="key_expired_01",
            user_id="user_test_01",
            name="Expired Key",
            key_prefix="sk-gw-expir...",
            raw_preview=None,
            key_hash=self.expired_hash,
            is_active=True,
            expires_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        def mock_get_by_hash(h):
            if h == self.valid_hash:
                return self.key_record
            if h == self.inactive_hash:
                return self.inactive_key_record
            if h == self.expired_hash:
                return self.expired_key_record
            return None

        self.api_key_repo.get_by_hash.side_effect = mock_get_by_hash

        self.user = UserResponseDTO(
            id="user_test_01",
            email="test@example.com",
            full_name="Test User",
            role="user",
            status="active",
            token_quota=250000,
            tokens_used=1000,
            rpm_limit=100,
            concurrent_limit=5,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.user_repo.get_by_id.return_value = self.user
        self.usage_repo.increment_minute_rate_counter.return_value = 1

        self.auth_service = AuthService(
            user_repo=self.user_repo,
            api_key_repo=self.api_key_repo,
            usage_repo=self.usage_repo,
        )

    def test_auth_3_part_token_preserves_explicit_app_and_agent(self):
        ctx = self.auth_service.authenticate_and_authorize(
            f"Bearer {self.valid_raw_key}:MY_TENANT:AGENT_FINANCE"
        )
        self.assertEqual(ctx.user_id, "user_test_01")
        self.assertEqual(ctx.api_key_id, "key_11aca43f")
        self.assertEqual(ctx.app_id, "MY_TENANT")
        self.assertEqual(ctx.agent_id, "AGENT_FINANCE")
        self.assertEqual(ctx.raw_api_key, self.valid_raw_key)

    def test_auth_2_part_token_defaults_app_id_to_key_id(self):
        ctx = self.auth_service.authenticate_and_authorize(
            f"Bearer {self.valid_raw_key}:AGENT_HR"
        )
        self.assertEqual(ctx.app_id, "key_11aca43f")
        self.assertEqual(ctx.agent_id, "AGENT_HR")

    def test_auth_1_part_token_defaults_app_id_to_key_id(self):
        ctx = self.auth_service.authenticate_and_authorize(
            f"Bearer {self.valid_raw_key}"
        )
        self.assertEqual(ctx.app_id, "key_11aca43f")
        self.assertEqual(ctx.agent_id, "")

    def test_auth_header_x_app_id_fallback_when_omitted_in_token(self):
        ctx = self.auth_service.authenticate_and_authorize(
            f"Bearer {self.valid_raw_key}:AGENT_OPS",
            header_app_id="HDR_APP_99",
        )
        self.assertEqual(ctx.app_id, "HDR_APP_99")
        self.assertEqual(ctx.agent_id, "AGENT_OPS")

    def test_auth_header_both_fallbacks_with_bare_token(self):
        ctx = self.auth_service.authenticate_and_authorize(
            f"Bearer {self.valid_raw_key}",
            header_app_id="HDR_APP",
            header_agent_id="HDR_AGENT",
        )
        self.assertEqual(ctx.app_id, "HDR_APP")
        self.assertEqual(ctx.agent_id, "HDR_AGENT")

    def test_auth_token_app_id_precedence_over_header(self):
        ctx = self.auth_service.authenticate_and_authorize(
            f"Bearer {self.valid_raw_key}:TOKEN_APP:TOKEN_AGENT",
            header_app_id="HDR_APP",
            header_agent_id="HDR_AGENT",
        )
        self.assertEqual(ctx.app_id, "TOKEN_APP")
        self.assertEqual(ctx.agent_id, "TOKEN_AGENT")

    def test_auth_empty_header_falls_back_to_key_id(self):
        ctx = self.auth_service.authenticate_and_authorize(
            f"Bearer {self.valid_raw_key}:AGENT_X",
            header_app_id="   ",
        )
        self.assertEqual(ctx.app_id, "key_11aca43f")
        self.assertEqual(ctx.agent_id, "AGENT_X")

    def test_auth_missing_header_raises_401(self):
        with self.assertRaises(HTTPException) as cm:
            self.auth_service.authenticate_and_authorize(None)
        self.assertEqual(cm.exception.status_code, 401)

    def test_auth_empty_header_raises_401(self):
        with self.assertRaises(HTTPException) as cm:
            self.auth_service.authenticate_and_authorize("")
        self.assertEqual(cm.exception.status_code, 401)

    def test_auth_invalid_key_raises_401(self):
        with self.assertRaises(HTTPException) as cm:
            self.auth_service.authenticate_and_authorize("Bearer sk-gw-unknown-key:APP:AGENT")
        self.assertEqual(cm.exception.status_code, 401)

    def test_auth_inactive_key_raises_401(self):
        with self.assertRaises(HTTPException) as cm:
            self.auth_service.authenticate_and_authorize(f"Bearer {self.inactive_raw_key}")
        self.assertEqual(cm.exception.status_code, 401)

    def test_auth_expired_key_raises_401(self):
        with self.assertRaises(HTTPException) as cm:
            self.auth_service.authenticate_and_authorize(f"Bearer {self.expired_raw_key}")
        self.assertEqual(cm.exception.status_code, 401)

    def test_removal_of_unauthenticated_fallback(self):
        # Even with an explicit x_user_id passed, an invalid key must raise 401, never returning sys_usr_01
        with self.assertRaises(HTTPException) as cm:
            self.auth_service.authenticate_and_authorize("Bearer sk-invalid", x_user_id="sys_usr_01")
        self.assertEqual(cm.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
