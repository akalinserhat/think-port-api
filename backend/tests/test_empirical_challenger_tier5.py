"""
ThinkPort AI Gateway - Empirical Adversarial Verification Suite (Tier 5).
Written by m_final_challenger_1 (teamwork_challenger).

Target areas:
1. Multiple colons in token segments (URNs, extra colons, sub-agents).
2. Empty/whitespace segments in composite tokens.
3. Header vs token priority conflicts & Anti-impersonation in chat_router.
4. Cross-tenant memory isolation in vector queries (zero leakage across differing app_id / agent_id).
5. SQL injection resilience in memory scoping parameters.
6. Empty/missing tenant identity zero-fallback assurance.
"""

from __future__ import annotations
import sys
import unittest
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

if "app.repositories.postgres_db" not in sys.modules:
    mock_pg_db = MagicMock()
    mock_db_mod = MagicMock()
    mock_db_mod.postgres_db = mock_pg_db
    mock_db_mod.sqlite_db = mock_pg_db
    mock_db_mod.PostgresDatabaseManager = MagicMock
    sys.modules["app.repositories.postgres_db"] = mock_db_mod

from app.api.v1.chat_router import create_chat_completion
from fastapi import HTTPException
from app.core.security import (
    extract_bearer_token,
    hash_api_key,
    parse_composite_bearer_token,
)
from app.dtos.api_key_dto import ApiKeyRecordDTO
from app.dtos.chat_dto import ChatCompletionRequestDTO, ChatMessageDTO
from app.dtos.user_dto import AuthenticatedUserContextDTO, UserResponseDTO
from app.repositories.postgres_driver import PgCursorResult, PgRow
from app.services.agent_memory_service import AgentMemoryService
from app.services.auth_service import AuthService
from app.services.chat_service import ChatService


class MockMemoryDbEngine:
    """In-memory mock for PostgreSQL agent_memories table."""

    def __init__(self):
        self.rows: List[Dict[str, Any]] = []

    def execute(self, sql: str, params: Optional[Any] = None) -> PgCursorResult:
        sql_clean = " ".join(sql.split())
        params_list = list(params) if params is not None else []

        if sql_clean.startswith("INSERT INTO agent_memories"):
            if len(params_list) == 14:
                # save_explicit_agent_memory
                row_dict = {
                    "id": params_list[0],
                    "app_id": params_list[1],
                    "agent_id": params_list[2],
                    "conversation_id": params_list[3],
                    "memory_type": params_list[4],
                    "content": params_list[5],
                    "tags_json": params_list[6],
                    "importance": params_list[7],
                    "is_pinned": params_list[8],
                    "token_count": params_list[9],
                    "embedding": params_list[10],
                    "expires_at": params_list[11],
                    "last_accessed_at": params_list[12],
                    "created_at": params_list[13],
                }
            elif len(params_list) == 12:
                # record_interaction_memory
                row_dict = {
                    "id": params_list[0],
                    "app_id": params_list[1],
                    "agent_id": params_list[2],
                    "conversation_id": params_list[3],
                    "request_id": params_list[4],
                    "memory_type": "interaction",
                    "content": params_list[6],
                    "importance": 0.5,
                    "is_pinned": 0,
                    "token_count": params_list[7],
                    "embedding": params_list[8],
                    "expires_at": params_list[9],
                    "last_accessed_at": params_list[10],
                    "created_at": params_list[11],
                }
            else:
                row_dict = {"id": params_list[0], "app_id": params_list[1], "agent_id": params_list[2]}
            self.rows.append(row_dict)
            return PgCursorResult([], rowcount=1)

        elif "SELECT id, conversation_id, memory_type" in sql_clean:
            # Query format: WHERE app_id = ? AND agent_id = ?
            target_app = params_list[1]
            target_agent = params_list[2]
            type_filter = params_list[3] if len(params_list) == 6 else None

            matched: List[PgRow] = []
            for r in self.rows:
                if r["app_id"] == target_app and r["agent_id"] == target_agent:
                    if type_filter and r.get("memory_type") != type_filter:
                        continue
                    cols = [
                        "id",
                        "conversation_id",
                        "memory_type",
                        "prompt_text",
                        "content",
                        "tags_json",
                        "importance",
                        "is_pinned",
                        "access_count",
                        "created_at",
                        "vector_score",
                    ]
                    vals = [
                        r["id"],
                        r.get("conversation_id", ""),
                        r.get("memory_type", "fact"),
                        "",
                        r.get("content", ""),
                        "[]",
                        r.get("importance", 0.5),
                        r.get("is_pinned", 0),
                        0,
                        r.get("created_at", ""),
                        0.98,
                    ]
                    matched.append(PgRow(cols, vals))
            return PgCursorResult(matched, rowcount=len(matched))

        elif "UPDATE agent_memories" in sql_clean:
            return PgCursorResult([], rowcount=1)

        elif "DELETE FROM agent_memories" in sql_clean:
            return PgCursorResult([], rowcount=0)

        elif "SELECT COUNT(1)" in sql_clean:
            target_app = params_list[0]
            target_agent = params_list[1]
            c = sum(1 for r in self.rows if r["app_id"] == target_app and r["agent_id"] == target_agent)
            return PgCursorResult([PgRow(["c"], [c])], rowcount=1)

        elif "SELECT id, uygulama_id, ad, kod" in sql_clean:
            return PgCursorResult([], rowcount=0)

        elif "SELECT COALESCE(MAX(id), 0)" in sql_clean:
            return PgCursorResult([PgRow(["m"], [10])], rowcount=1)

        elif "INSERT INTO ai_agents" in sql_clean:
            return PgCursorResult([], rowcount=1)

        return PgCursorResult([], rowcount=0)


class EmpiricalChallengerTestSuite(unittest.IsolatedAsyncioTestCase):
    """Deep adversarial test suite for Tier 5 verification."""

    def setUp(self):
        self.memory_service = AgentMemoryService()
        self.db = MockMemoryDbEngine()

    # =========================================================================
    # 1. Multiple colons in token segments
    # =========================================================================
    def test_empirical_multiple_colons_in_agent_id_urn(self):
        """Test composite token where agent_id is a full URN containing multiple colons."""
        raw = "sk-live-secret-key:APP_ENTERPRISE_1:urn:agent:thinkport:worker:sub:99"
        key, app, agent = parse_composite_bearer_token(raw)
        self.assertEqual(key, "sk-live-secret-key")
        self.assertEqual(app, "APP_ENTERPRISE_1")
        self.assertEqual(agent, "urn:agent:thinkport:worker:sub:99")

    def test_empirical_multiple_colons_with_trailing_colon(self):
        """Test trailing colon preserved in agent segment without crash."""
        raw = "sk-live-key:APP_TENANT:AGENT_CODE:"
        key, app, agent = parse_composite_bearer_token(raw)
        self.assertEqual(key, "sk-live-key")
        self.assertEqual(app, "APP_TENANT")
        self.assertEqual(agent, "AGENT_CODE:")

    def test_empirical_consecutive_colons_in_agent_id(self):
        """Test consecutive colons in agent_id (e.g. C++ namespace format)."""
        raw = "sk-live-key:MY_APP:Namespace::SubNamespace::Agent"
        key, app, agent = parse_composite_bearer_token(raw)
        self.assertEqual(key, "sk-live-key")
        self.assertEqual(app, "MY_APP")
        self.assertEqual(agent, "Namespace::SubNamespace::Agent")

    def test_empirical_empty_middle_segment_defaults_app_id_to_none(self):
        """Test empty middle segment: sk: :AGENT -> (key, None, AGENT)."""
        raw = "sk-live-key::urn:agent:finance:01"
        key, app, agent = parse_composite_bearer_token(raw)
        self.assertEqual(key, "sk-live-key")
        self.assertIsNone(app, "Empty middle segment must parse as None")
        self.assertEqual(agent, "urn:agent:finance:01")

    # =========================================================================
    # 2. Empty and whitespace segments in composite tokens
    # =========================================================================
    def test_empirical_empty_and_whitespace_token_variations(self):
        """Adversarial testing of empty/whitespace inputs in parse_composite_bearer_token and auth_service."""
        auth_service, _ = self._create_mock_auth_service()

        invalid_empty_tokens = [
            None,
            "",
            "   ",
            "\t\n\r",
            "Bearer",
            "bearer",
            "BEARER",
            "Bearer ",
            "Bearer    ",
            "Bearer \t\n\r",
            ":",
            "::",
            ":::",
            " : : ",
            "Bearer :",
            "Bearer ::",
            "Bearer  :  :  ",
            " : : : : ",
        ]
        for token in invalid_empty_tokens:
            key, _, _ = parse_composite_bearer_token(token)
            self.assertEqual(key, "", f"Expected empty key for token {token!r}, got {key!r}")
            # Verify auth_service immediately raises HTTP 401 Unauthorized
            with self.assertRaises(HTTPException) as cm:
                auth_service.authenticate_and_authorize(token)
            self.assertEqual(cm.exception.status_code, 401)

    def test_empirical_whitespace_padded_segments(self):
        """Ensure heavy whitespace padding inside segments is cleanly stripped."""
        token = "  Bearer   \t  sk-clean-key  :  APP_SPACED  :   AGENT_SPACED  \n"
        key, app, agent = parse_composite_bearer_token(token)
        self.assertEqual(key, "sk-clean-key")
        self.assertEqual(app, "APP_SPACED")
        self.assertEqual(agent, "AGENT_SPACED")

    def test_empirical_two_part_token_no_app_id(self):
        """2-part token <API_KEY>:<AGENT_ID> returns (key, None, agent_id)."""
        token = "sk-live-12345:AGENT_DIRECT"
        key, app, agent = parse_composite_bearer_token(token)
        self.assertEqual(key, "sk-live-12345")
        self.assertIsNone(app)
        self.assertEqual(agent, "AGENT_DIRECT")

    # =========================================================================
    # 3. Header vs token priority conflicts & Anti-Impersonation
    # =========================================================================
    def _create_mock_auth_service(self):
        user_repo = MagicMock()
        api_key_repo = MagicMock()
        usage_repo = MagicMock()
        usage_repo.increment_minute_rate_counter.return_value = 1

        raw_key = "sk-valid-master-test-key"
        key_rec = ApiKeyRecordDTO(
            id="key_rec_db_id_001",
            user_id="usr_001",
            name="Test Key",
            key_prefix="sk-valid-m...",
            raw_preview=None,
            key_hash=hash_api_key(raw_key),
            is_active=True,
            expires_at=(datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        api_key_repo.get_by_hash.return_value = key_rec

        user_repo.get_by_id.return_value = UserResponseDTO(
            id="usr_001",
            email="tenant@corp.com",
            full_name="Corp Admin",
            role="user",
            status="active",
            token_quota=1000000,
            tokens_used=10,
            rpm_limit=120,
            concurrent_limit=10,
            last_login_at=None,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        return AuthService(user_repo, api_key_repo, usage_repo), raw_key

    def test_empirical_header_vs_token_token_strictly_prevails(self):
        """Token (APP_TOKEN, AGENT_TOKEN) MUST strictly prevail over headers (APP_HDR, AGENT_HDR)."""
        auth_service, raw_key = self._create_mock_auth_service()
        bearer = f"Bearer {raw_key}:TOKEN_TENANT:TOKEN_AGENT"

        ctx = auth_service.authenticate_and_authorize(
            authorization=bearer,
            x_app_id="SPOOFED_HDR_TENANT",
            x_agent_id="SPOOFED_HDR_AGENT",
            header_app_id="SPOOFED_HDR_TENANT",
            header_agent_id="SPOOFED_HDR_AGENT",
        )
        self.assertEqual(ctx.app_id, "TOKEN_TENANT")
        self.assertEqual(ctx.agent_id, "TOKEN_AGENT")
        self.assertEqual(ctx.raw_api_key, raw_key)

    def test_empirical_fallback_to_headers_when_omitted_in_token(self):
        """When token omits app/agent, header fallback MUST take effect."""
        auth_service, raw_key = self._create_mock_auth_service()
        # 1-part bare token
        bearer = f"Bearer {raw_key}"

        ctx = auth_service.authenticate_and_authorize(
            authorization=bearer,
            x_app_id="FALLBACK_APP",
            x_agent_id="FALLBACK_AGENT",
            header_app_id="FALLBACK_APP",
            header_agent_id="FALLBACK_AGENT",
        )
        self.assertEqual(ctx.app_id, "FALLBACK_APP")
        self.assertEqual(ctx.agent_id, "FALLBACK_AGENT")

    def test_empirical_fallback_to_key_id_when_app_id_completely_omitted(self):
        """When app_id is omitted from both token and header, candidate_key.id MUST be used."""
        auth_service, raw_key = self._create_mock_auth_service()
        # 2-part token: key:agent
        bearer = f"Bearer {raw_key}:SPECIFIC_AGENT"

        ctx = auth_service.authenticate_and_authorize(
            authorization=bearer,
            header_app_id=None,
            header_agent_id=None,
        )
        self.assertEqual(ctx.app_id, "key_rec_db_id_001", "Must default to API key record ID")
        self.assertEqual(ctx.agent_id, "SPECIFIC_AGENT")

    def test_empirical_invalid_api_key_raises_401(self):
        """Invalid API key hash MUST raise 401 Unauthorized immediately."""
        user_repo = MagicMock()
        api_key_repo = MagicMock()
        api_key_repo.get_by_hash.return_value = None  # Key not found
        usage_repo = MagicMock()

        auth_service = AuthService(user_repo, api_key_repo, usage_repo)
        with self.assertRaises(HTTPException) as cm:
            auth_service.authenticate_and_authorize("Bearer sk-non-existent-key:APP:AGENT")
        self.assertEqual(cm.exception.status_code, 401)

    async def test_empirical_anti_impersonation_chat_router(self):
        """Chat router MUST overwrite body request.app_id with authenticated user_ctx.app_id."""
        user_ctx = AuthenticatedUserContextDTO(
            user_id="user_tenant_1",
            email="legit@tenant1.com",
            api_key_id="key_1",
            token_quota=100000,
            tokens_used=0,
            rpm_limit=60,
            concurrent_limit=5,
            app_id="CORP_LEGITIMATE",
            agent_id="AGENT_FINANCE_LEGIT",
            raw_api_key="sk-legit",
        )

        malicious_req = ChatCompletionRequestDTO(
            model="gpt-4o",
            app_id="CORP_VICTIM_TARGET",
            agent_id="AGENT_VICTIM_ADMIN",
            agent_name="Malicious Spoof",
            messages=[ChatMessageDTO(role="user", content="Steal victim records")],
            stream=False,
        )

        mock_chat_svc = MagicMock(spec=ChatService)
        fake_job = MagicMock()
        fake_job.conversation_id = "conv_test_anti_impersonation"
        mock_chat_svc.initiate_chat_job.return_value = fake_job
        mock_chat_svc.build_sync_response = AsyncMock()

        await create_chat_completion(
            request=malicious_req,
            user_ctx=user_ctx,
            chat_service=mock_chat_svc,
            x_app_id="CORP_VICTIM_TARGET",
            x_agent_id="AGENT_VICTIM_ADMIN",
            x_agent_name="Malicious Header Name",
        )

        # Verified: request was locked to authenticated tenant
        self.assertEqual(malicious_req.app_id, "CORP_LEGITIMATE")
        self.assertEqual(malicious_req.agent_id, "AGENT_FINANCE_LEGIT")

        called_job_req, called_job_ctx = mock_chat_svc.initiate_chat_job.call_args[0]
        self.assertEqual(called_job_req.app_id, "CORP_LEGITIMATE")
        self.assertEqual(called_job_ctx.app_id, "CORP_LEGITIMATE")
        self.assertEqual(called_job_ctx.agent_id, "AGENT_FINANCE_LEGIT")

    # =========================================================================
    # 4. Cross-tenant memory isolation in vector queries (Zero Leakage)
    # =========================================================================
    @patch("app.services.agent_memory_service.postgres_db")
    def test_empirical_zero_memory_leakage_across_tenants(self, mock_postgres_db):
        """Cross-tenant memory isolation test: 0 records leaked across 5 tenants."""
        mock_postgres_db.connection.return_value.__enter__.return_value = self.db

        tenants = ["TENANT_ACME", "TENANT_GLOBEX", "TENANT_SOYLENT", "TENANT_INITECH", "TENANT_UMBRELLA"]
        secret_payloads = {
            t: f"TOP_SECRET_CODE_{t}_2026_XYZ_999" for t in tenants
        }

        with patch.object(
            self.memory_service,
            "ensure_agent_registered_and_get_config",
            return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000, "hafiza_saklama_gun": 30},
        ):
            # Save secrets for all 5 tenants
            for t in tenants:
                self.memory_service.save_explicit_agent_memory(
                    app_id=t,
                    agent_id="AGENT_CORE",
                    conversation_id=f"conv_{t}",
                    content=secret_payloads[t],
                    importance=1.0,
                )

            # Adversarial search: Each tenant queries using OTHER tenants' exact secrets
            for attacker in tenants:
                for victim, secret_token in secret_payloads.items():
                    if attacker == victim:
                        continue
                    res = self.memory_service.search_agent_memory(
                        app_id=attacker,
                        agent_id="AGENT_CORE",
                        query=secret_token,
                        top_k=10,
                    )
                    # Verify that the victim's secret NEVER appears in attacker's results
                    for row in res["results"]:
                        self.assertNotIn(
                            secret_token,
                            row["content"],
                            f"CRITICAL LEAK: Attacker {attacker} retrieved victim {victim}'s memory payload!",
                        )

            # Positive control: Each tenant can access its own memory
            for legit_tenant in tenants:
                res_self = self.memory_service.search_agent_memory(
                    app_id=legit_tenant,
                    agent_id="AGENT_CORE",
                    query=secret_payloads[legit_tenant],
                    top_k=5,
                )
                self.assertGreaterEqual(res_self["total_found"], 1)
                self.assertIn(secret_payloads[legit_tenant], res_self["results"][0]["content"])

            # Verify unseeded / external tenant gets 0 results
            res_external = self.memory_service.search_agent_memory(
                app_id="TENANT_OUTSIDER",
                agent_id="AGENT_CORE",
                query="TOP_SECRET_CODE",
                top_k=5,
            )
            self.assertEqual(res_external["total_found"], 0)
            self.assertEqual(res_external["results"], [])

    @patch("app.services.agent_memory_service.postgres_db")
    def test_empirical_zero_memory_leakage_across_agents_same_tenant(self, mock_postgres_db):
        """Cross-agent memory isolation test: 0 records leaked between different agents of the same tenant."""
        mock_postgres_db.connection.return_value.__enter__.return_value = self.db

        with patch.object(
            self.memory_service,
            "ensure_agent_registered_and_get_config",
            return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000, "hafiza_saklama_gun": 30},
        ):
            self.memory_service.save_explicit_agent_memory(
                app_id="TENANT_ALPHA",
                agent_id="FINANCE_BOT",
                conversation_id="conv_fin",
                content="CONFIDENTIAL_SALARY: CEO earns $1,200,000 / year",
            )

            # Support bot queries salary
            res = self.memory_service.search_agent_memory(
                app_id="TENANT_ALPHA",
                agent_id="SUPPORT_BOT",
                query="CONFIDENTIAL_SALARY CEO earns",
                top_k=5,
            )
            self.assertEqual(res["total_found"], 0)
            self.assertEqual(res["results"], [])

    @patch("app.services.agent_memory_service.postgres_db")
    def test_empirical_sql_injection_parameters_zero_leakage(self, mock_postgres_db):
        """Verify SQL injection strings in app_id/agent_id cannot leak other tenant records."""
        mock_postgres_db.connection.return_value.__enter__.return_value = self.db

        with patch.object(
            self.memory_service,
            "ensure_agent_registered_and_get_config",
            return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000, "hafiza_saklama_gun": 30},
        ):
            self.memory_service.save_explicit_agent_memory(
                app_id="TENANT_REAL",
                agent_id="AGENT_REAL",
                conversation_id="conv_real",
                content="BANKING_VAULT_PIN: 987654",
            )

            injection_attempts = [
                ("TENANT_REAL' OR 1=1 --", "AGENT_REAL"),
                ("TENANT_REAL", "AGENT_REAL' OR 'a'='a"),
                ("' UNION SELECT * FROM agent_memories --", "AGENT_REAL"),
                ("'; DROP TABLE agent_memories; --", "AGENT_REAL"),
            ]

            for inj_app, inj_agent in injection_attempts:
                res = self.memory_service.search_agent_memory(
                    app_id=inj_app,
                    agent_id=inj_agent,
                    query="BANKING_VAULT_PIN",
                )
                self.assertEqual(res["total_found"], 0)
                self.assertEqual(res["results"], [])

    @patch("app.services.agent_memory_service.postgres_db")
    def test_empirical_empty_tenant_zero_fallback_to_thinkport_core(self, mock_postgres_db):
        """Verify empty tenant or agent receives 0 results and NEVER falls back to THINKPORT_CORE."""
        mock_postgres_db.connection.return_value.__enter__.return_value = self.db

        for empty_app in ["", "  ", None]:
            norm_app, norm_agent = self.memory_service.normalize_identity(empty_app, "AGENT_X")
            self.assertEqual(norm_app, "")
            self.assertEqual(norm_agent, "")
            self.assertNotEqual(norm_app, "THINKPORT_CORE")

            res = self.memory_service.search_agent_memory(
                app_id=empty_app,  # type: ignore
                agent_id="AGENT_X",
                query="anything",
            )
            self.assertEqual(res["total_found"], 0)
            self.assertEqual(res["results"], [])


if __name__ == "__main__":
    unittest.main()
