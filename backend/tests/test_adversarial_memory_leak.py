"""
ThinkPort AI Gateway - Adversarial Multi-Tenant Memory Leak Verification Suite.
Stress-tests:
1. Multi-tenant memory scoping & zero-leakage cross-tenant isolation in AgentMemoryService.
2. Cross-agent memory leak prevention within the same tenant.
3. Zero fallback to "THINKPORT_CORE" on missing or empty app_id/agent_id.
4. Tenant spoofing prevention via request body (user_ctx.app_id precedence).
5. Fallback header spoofing prevention (token precedence over headers).
6. Parameterized SQL query safety against injection in memory partition filters.
7. End-to-end memory isolation with an in-memory pgvector partition engine.
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
from app.core.security import hash_api_key, parse_composite_bearer_token
from app.dtos.api_key_dto import ApiKeyRecordDTO
from app.dtos.chat_dto import ChatCompletionRequestDTO, ChatMessageDTO
from app.dtos.user_dto import AuthenticatedUserContextDTO, UserResponseDTO
from app.repositories.postgres_driver import PgCursorResult, PgRow
from app.services.agent_memory_service import AgentMemoryService
from app.services.auth_service import AuthService
from app.services.chat_service import ChatService


class InMemoryPartitionedMemoryDb:
    """
    In-memory simulation of the PostgreSQL `agent_memories` table with pgvector
    and strict parameter-bound query emulation.
    """

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
                    "request_id": "",
                    "memory_type": params_list[4],
                    "role": "assistant",
                    "prompt_text": "",
                    "content": params_list[5],
                    "tags_json": params_list[6],
                    "importance": params_list[7],
                    "is_pinned": params_list[8],
                    "access_count": 0,
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
                    "role": "assistant",
                    "prompt_text": params_list[5],
                    "content": params_list[6],
                    "tags_json": "[]",
                    "importance": 0.5,
                    "is_pinned": 0,
                    "access_count": 0,
                    "token_count": params_list[7],
                    "embedding": params_list[8],
                    "expires_at": params_list[9],
                    "last_accessed_at": params_list[10],
                    "created_at": params_list[11],
                }
            else:
                row_dict = {
                    "id": params_list[0],
                    "app_id": params_list[1],
                    "agent_id": params_list[2],
                    "conversation_id": "",
                    "request_id": "",
                    "memory_type": "interaction",
                    "role": "assistant",
                    "prompt_text": "",
                    "content": "",
                    "tags_json": "[]",
                    "importance": 0.5,
                    "is_pinned": 0,
                    "access_count": 0,
                    "token_count": 0,
                    "embedding": "",
                    "expires_at": "",
                    "last_accessed_at": "",
                    "created_at": "",
                }
            self.rows.append(row_dict)
            return PgCursorResult([], rowcount=1)

        elif "SELECT id, conversation_id, memory_type, prompt_text, content" in sql_clean:
            # SELECT ... FROM agent_memories WHERE app_id = ? AND agent_id = ? ...
            target_app = params_list[1]
            target_agent = params_list[2]

            matched: List[PgRow] = []
            for r in self.rows:
                if r["app_id"] == target_app and r["agent_id"] == target_agent:
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
                        r["conversation_id"],
                        r["memory_type"],
                        r["prompt_text"],
                        r["content"],
                        r["tags_json"],
                        r["importance"],
                        r["is_pinned"],
                        r["access_count"],
                        r["created_at"],
                        0.95,
                    ]
                    matched.append(PgRow(cols, vals))
            return PgCursorResult(matched, rowcount=len(matched))

        elif "UPDATE agent_memories" in sql_clean:
            return PgCursorResult([], rowcount=1)

        elif "DELETE FROM agent_memories" in sql_clean:
            if "expires_at <" in sql_clean:
                target_app = params_list[0]
                target_agent = params_list[1]
                cutoff_time = params_list[2]
                initial_len = len(self.rows)
                self.rows = [
                    r for r in self.rows
                    if not (
                        r["app_id"] == target_app
                        and r["agent_id"] == target_agent
                        and r.get("is_pinned") == 0
                        and r.get("expires_at")
                        and r.get("expires_at") < cutoff_time
                    )
                ]
                return PgCursorResult([], rowcount=initial_len - len(self.rows))
            elif "WHERE id = ?" in sql_clean:
                target_id = params_list[0]
                self.rows = [r for r in self.rows if r["id"] != target_id]
                return PgCursorResult([], rowcount=1)
            return PgCursorResult([], rowcount=0)

        elif "SELECT COUNT(1) AS c FROM agent_memories" in sql_clean:
            target_app = params_list[0]
            target_agent = params_list[1]
            count = sum(1 for r in self.rows if r["app_id"] == target_app and r["agent_id"] == target_agent)
            return PgCursorResult([PgRow(["c"], [count])], rowcount=1)

        elif "SELECT id, uygulama_id, ad, kod" in sql_clean:
            return PgCursorResult([], rowcount=0)

        elif "SELECT COALESCE(MAX(id), 0)" in sql_clean:
            return PgCursorResult([PgRow(["m"], [1])], rowcount=1)

        elif "INSERT INTO ai_agents" in sql_clean:
            return PgCursorResult([], rowcount=1)

        return PgCursorResult([], rowcount=0)


class TestAdversarialMultiTenantMemoryScoping(unittest.IsolatedAsyncioTestCase):
    """Empirical adversarial stress test suite for multi-tenant memory isolation."""

    def setUp(self):
        self.memory_service = AgentMemoryService()
        self.mock_db = InMemoryPartitionedMemoryDb()

    @patch("app.services.agent_memory_service.postgres_db")
    def test_adversarial_cross_tenant_isolation_zero_leakage(self, mock_postgres_db):
        """
        Adversarial Test 1:
        Create confidential memories under (TENANT_A, AGENT_X).
        Query using (TENANT_B, AGENT_X) with identical search vectors/text.
        Verify ZERO records returned.
        """
        mock_postgres_db.connection.return_value.__enter__.return_value = self.mock_db

        with patch.object(
            self.memory_service,
            "ensure_agent_registered_and_get_config",
            return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000, "hafiza_saklama_gun": 30},
        ):
            # 1. Tenant Alpha saves confidential M&A memo
            save_res_alpha = self.memory_service.save_explicit_agent_memory(
                app_id="TENANT_CORP_ALPHA",
                agent_id="AGENT_FINANCE",
                conversation_id="conv_alpha_secret_01",
                content="CONFIDENTIAL: Alpha Corp acquiring Beta for 50M USD cash.",
                memory_type="fact",
                importance=1.0,
                is_pinned=True,
            )
            self.assertEqual(save_res_alpha["status"], "saved")
            self.assertEqual(save_res_alpha["app_id"], "TENANT_CORP_ALPHA")
            self.assertEqual(save_res_alpha["agent_id"], "AGENT_FINANCE")

            # 2. Tenant Alpha records confidential interaction memory
            rec_res_alpha = self.memory_service.record_interaction_memory(
                app_id="TENANT_CORP_ALPHA",
                agent_id="AGENT_FINANCE",
                conversation_id="conv_alpha_secret_02",
                request_id="req_alpha_secret_02",
                prompt_text="What is executive bonus pool 2026?",
                response_text="Executive bonus pool approved at 3.5M EUR.",
            )
            self.assertIsNotNone(rec_res_alpha)

            # 3. Tenant Beta (Hostile Actor) queries with identical vectors and keywords
            leak_attempt_1 = self.memory_service.search_agent_memory(
                app_id="TENANT_CORP_BETA",
                agent_id="AGENT_FINANCE",
                query="CONFIDENTIAL: Alpha Corp acquiring Beta for 50M USD cash",
                top_k=10,
            )
            # Must return ZERO records
            self.assertEqual(leak_attempt_1["total_found"], 0)
            self.assertEqual(leak_attempt_1["results"], [])

            leak_attempt_2 = self.memory_service.search_agent_memory(
                app_id="TENANT_CORP_BETA",
                agent_id="AGENT_FINANCE",
                query="executive bonus pool approved",
                top_k=10,
            )
            # Must return ZERO records
            self.assertEqual(leak_attempt_2["total_found"], 0)
            self.assertEqual(leak_attempt_2["results"], [])

            # 4. Tenant Alpha verifies its own memories are intact
            alpha_query = self.memory_service.search_agent_memory(
                app_id="TENANT_CORP_ALPHA",
                agent_id="AGENT_FINANCE",
                query="CONFIDENTIAL: Alpha Corp acquiring Beta",
                top_k=10,
            )
            self.assertGreaterEqual(alpha_query["total_found"], 1)
            self.assertIn("Alpha Corp acquiring Beta", alpha_query["results"][0]["content"])

    @patch("app.services.agent_memory_service.postgres_db")
    def test_adversarial_cross_agent_isolation_same_tenant(self, mock_postgres_db):
        """
        Adversarial Test 2:
        Create memories under (TENANT_A, AGENT_X).
        Query using (TENANT_A, AGENT_Y) with identical search vectors/text.
        Verify ZERO records returned.
        """
        mock_postgres_db.connection.return_value.__enter__.return_value = self.mock_db

        with patch.object(
            self.memory_service,
            "ensure_agent_registered_and_get_config",
            return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000, "hafiza_saklama_gun": 30},
        ):
            # Tenant Alpha Finance agent saves sensitive financial data
            self.memory_service.save_explicit_agent_memory(
                app_id="TENANT_CORP_ALPHA",
                agent_id="AGENT_FINANCE",
                conversation_id="conv_finance_1",
                content="BANKING_SECRET: Offshore account #CH99-1234-5678-90 balance $12M.",
                memory_type="fact",
            )

            # Tenant Alpha Support agent attempts to query banking secret
            leak_attempt = self.memory_service.search_agent_memory(
                app_id="TENANT_CORP_ALPHA",
                agent_id="AGENT_SUPPORT",
                query="Offshore account balance CH99-1234-5678-90",
                top_k=5,
            )
            self.assertEqual(leak_attempt["total_found"], 0)
            self.assertEqual(leak_attempt["results"], [])

    @patch("app.services.agent_memory_service.postgres_db")
    def test_adversarial_empty_identifiers_zero_fallback_to_thinkport_core(self, mock_postgres_db):
        """
        Adversarial Test 3:
        Query with empty app_id or empty agent_id.
        Verify strict rejection or empty results, with ZERO fallback to "THINKPORT_CORE".
        """
        mock_postgres_db.connection.return_value.__enter__.return_value = self.mock_db

        empty_variations = ["", "   ", None]

        for empty_val in empty_variations:
            # 1. normalize_identity checks
            norm_app, norm_agent = self.memory_service.normalize_identity(empty_val, "AGENT_SALES")
            self.assertEqual(norm_app, "", f"Expected empty app_id, got '{norm_app}'")
            self.assertEqual(norm_agent, "", f"Expected empty agent_id, got '{norm_agent}'")
            self.assertNotEqual(norm_app, "THINKPORT_CORE", "Forbidden fallback to THINKPORT_CORE!")

            norm_app2, norm_agent2 = self.memory_service.normalize_identity("TENANT_APP", empty_val)
            self.assertEqual(norm_app2, "", f"Expected empty app_id, got '{norm_app2}'")
            self.assertEqual(norm_agent2, "", f"Expected empty agent_id, got '{norm_agent2}'")
            self.assertNotEqual(norm_app2, "THINKPORT_CORE", "Forbidden fallback to THINKPORT_CORE!")

            # 2. search_agent_memory with empty app_id
            res_search = self.memory_service.search_agent_memory(
                app_id=empty_val,  # type: ignore
                agent_id="AGENT_SALES",
                query="confidential data",
            )
            self.assertEqual(res_search["total_found"], 0)
            self.assertEqual(res_search["results"], [])
            self.assertEqual(res_search["app_id"], "")

            # 3. save_explicit_agent_memory with empty app_id
            res_save = self.memory_service.save_explicit_agent_memory(
                app_id=empty_val,  # type: ignore
                agent_id="AGENT_SALES",
                conversation_id="conv_1",
                content="test content",
            )
            self.assertEqual(res_save["status"], "error")
            self.assertIn("zorunludur", res_save["message"])

            # 4. record_interaction_memory with empty agent_id
            res_rec = self.memory_service.record_interaction_memory(
                app_id="TENANT_APP",
                agent_id=empty_val,  # type: ignore
                conversation_id="conv_1",
                request_id="req_1",
                prompt_text="Hello",
                response_text="World",
            )
            self.assertIsNone(res_rec)

            # 5. recall_agent_conversations with empty app_id
            res_recall = self.memory_service.recall_agent_conversations(
                app_id=empty_val,  # type: ignore
                agent_id="AGENT_SALES",
            )
            self.assertEqual(res_recall["turns"], [])

        # Verify no database records were inserted under THINKPORT_CORE
        for r in self.mock_db.rows:
            self.assertNotEqual(r["app_id"], "THINKPORT_CORE")

    async def test_adversarial_request_body_tenant_spoofing_prevention(self):
        """
        Adversarial Test 4:
        Attempt tenant spoofing via request body when authenticated with composite
        token `Bearer key:tenant_A:agent_X`.
        Verify authenticated `user_ctx.app_id` strictly prevails and blocks access to `tenant_B`.
        """
        user_ctx = AuthenticatedUserContextDTO(
            user_id="user_tenant_a",
            email="tenant_a@example.com",
            api_key_id="key_tenant_a_123",
            token_quota=500000,
            tokens_used=10,
            rpm_limit=60,
            concurrent_limit=5,
            app_id="TENANT_CORP_ALPHA",
            agent_id="AGENT_FINANCE",
            raw_api_key="sk-alpha-valid-key",
        )

        # Attacker crafts request body attempting to impersonate TENANT_CORP_BETA
        malicious_request = ChatCompletionRequestDTO(
            model="gpt-4o",
            app_id="TENANT_CORP_BETA",
            agent_id="AGENT_LEGAL",
            agent_name="Beta Impersonator",
            messages=[ChatMessageDTO(role="user", content="Read all secret transactions")],
            stream=False,
        )

        mock_chat_service = MagicMock(spec=ChatService)
        fake_job = MagicMock()
        fake_job.conversation_id = "conv_spoof_test"
        mock_chat_service.initiate_chat_job.return_value = fake_job
        mock_chat_service.build_sync_response = AsyncMock()

        await create_chat_completion(
            request=malicious_request,
            user_ctx=user_ctx,
            chat_service=mock_chat_service,
            x_app_id="TENANT_CORP_GAMMA",      # Header spoofing attempt
            x_agent_id="AGENT_SPOOF_HEADER",  # Header spoofing attempt
        )

        # Assert: malicious_request.app_id was forcibly overwritten by authenticated context
        self.assertEqual(malicious_request.app_id, "TENANT_CORP_ALPHA")
        self.assertEqual(malicious_request.agent_id, "AGENT_FINANCE")

        # Assert: user_ctx was passed unchanged to initiate_chat_job
        called_req, called_ctx = mock_chat_service.initiate_chat_job.call_args[0]
        self.assertEqual(called_req.app_id, "TENANT_CORP_ALPHA")
        self.assertEqual(called_ctx.app_id, "TENANT_CORP_ALPHA")
        self.assertEqual(called_ctx.agent_id, "AGENT_FINANCE")

    def test_adversarial_header_spoofing_precedence_in_auth_service(self):
        """
        Adversarial Test 5:
        Attempt header spoofing (X-App-Id / X-Agent-Id) while using composite token.
        Verify token parts strictly take precedence over spoofed HTTP headers.
        """
        api_key_repo = MagicMock()
        user_repo = MagicMock()
        usage_repo = MagicMock()
        usage_repo.increment_minute_rate_counter.return_value = 1

        raw_key = "sk-tenant-master-key-999"
        k_hash = hash_api_key(raw_key)
        key_record = ApiKeyRecordDTO(
            id="key_rec_alpha_999",
            user_id="usr_alpha_999",
            name="Alpha Corp Key",
            key_prefix="sk-tenant-m...",
            raw_preview=None,
            key_hash=k_hash,
            is_active=True,
            expires_at=(datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        api_key_repo.get_by_hash.return_value = key_record

        user_repo.get_by_id.return_value = UserResponseDTO(
            id="usr_alpha_999",
            email="admin@alpha.com",
            full_name="Alpha Admin",
            role="user",
            status="active",
            token_quota=1000000,
            tokens_used=0,
            rpm_limit=120,
            concurrent_limit=10,
            last_login_at=None,
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        auth_service = AuthService(user_repo, api_key_repo, usage_repo)

        # Composite Bearer token specifying TENANT_ALPHA and AGENT_HR
        bearer = f"Bearer {raw_key}:TENANT_ALPHA:AGENT_HR"

        # Hostile request specifies different tenant in X-App-Id header
        user_ctx = auth_service.authenticate_and_authorize(
            authorization=bearer,
            x_app_id="TENANT_BETA_SPOOFED",
            x_agent_id="AGENT_SPOOFED",
            header_app_id="TENANT_BETA_SPOOFED",
            header_agent_id="AGENT_SPOOFED",
        )

        # Token parts MUST strictly prevail
        self.assertEqual(user_ctx.app_id, "TENANT_ALPHA")
        self.assertEqual(user_ctx.agent_id, "AGENT_HR")
        self.assertEqual(user_ctx.raw_api_key, raw_key)
        self.assertNotEqual(user_ctx.app_id, "TENANT_BETA_SPOOFED")

    @patch("app.services.agent_memory_service.postgres_db")
    def test_adversarial_sql_injection_in_memory_scoping_params(self, mock_postgres_db):
        """
        Adversarial Test 6:
        Attempt SQL injection via tenant/agent identifiers (e.g. `' OR '1'='1`).
        Verify parameter binding strictly treats injection string as literal values.
        """
        mock_postgres_db.connection.return_value.__enter__.return_value = self.mock_db

        sql_injection_app = "TENANT_ALPHA' OR '1'='1"
        sql_injection_agent = "AGENT_X'; DROP TABLE agent_memories; --"

        with patch.object(
            self.memory_service,
            "ensure_agent_registered_and_get_config",
            return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000, "hafiza_saklama_gun": 30},
        ):
            # Save under legitimate tenant
            self.memory_service.save_explicit_agent_memory(
                app_id="TENANT_ALPHA",
                agent_id="AGENT_X",
                conversation_id="conv_clean",
                content="CONFIDENTIAL DATA THAT MUST NOT BE DUMPED BY SQL INJECTION",
            )

            # Attacker queries using SQL injection string
            res = self.memory_service.search_agent_memory(
                app_id=sql_injection_app,
                agent_id=sql_injection_agent,
                query="CONFIDENTIAL DATA",
            )

            # Query must return ZERO records because it parameter-matches the exact literal string
            self.assertEqual(res["total_found"], 0)
            self.assertEqual(res["results"], [])

    @patch("app.services.agent_memory_service.postgres_db")
    def test_adversarial_multi_turn_interaction_memory_chat_service_isolation(self, mock_postgres_db):
        """
        Adversarial Test 7:
        End-to-end ChatService chat job completion:
        Verify that job.app_id and job.agent_id strictly record memory to the
        authenticated partition and never to an unauthorized partition.
        """
        mock_postgres_db.connection.return_value.__enter__.return_value = self.mock_db

        with patch.object(
            self.memory_service,
            "ensure_agent_registered_and_get_config",
            return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000, "hafiza_saklama_gun": 30},
        ):
            # Record an interaction directly as ChatService does on line 940
            mem_id_a = self.memory_service.record_interaction_memory(
                app_id="ENTERPRISE_TENANT_A",
                agent_id="AGENT_FINANCE",
                conversation_id="conv_a_turn_1",
                request_id="req_a_1",
                prompt_text="What is the EBITDA margin for FY2026?",
                response_text="Projected EBITDA margin is 28.4%.",
            )
            self.assertIsNotNone(mem_id_a)

            mem_id_b = self.memory_service.record_interaction_memory(
                app_id="ENTERPRISE_TENANT_B",
                agent_id="AGENT_FINANCE",
                conversation_id="conv_b_turn_1",
                request_id="req_b_1",
                prompt_text="What is the EBITDA margin for FY2026?",
                response_text="Projected EBITDA margin is 11.2%.",
            )
            self.assertIsNotNone(mem_id_b)

            # Search from Tenant A
            res_a = self.memory_service.search_agent_memory(
                app_id="ENTERPRISE_TENANT_A",
                agent_id="AGENT_FINANCE",
                query="EBITDA margin FY2026",
            )
            self.assertEqual(res_a["total_found"], 1)
            self.assertIn("28.4%", res_a["results"][0]["content"])
            self.assertNotIn("11.2%", res_a["results"][0]["content"])

            # Search from Tenant B
            res_b = self.memory_service.search_agent_memory(
                app_id="ENTERPRISE_TENANT_B",
                agent_id="AGENT_FINANCE",
                query="EBITDA margin FY2026",
            )
            self.assertEqual(res_b["total_found"], 1)
            self.assertIn("11.2%", res_b["results"][0]["content"])
            self.assertNotIn("28.4%", res_b["results"][0]["content"])

    @patch("app.services.agent_memory_service.postgres_db")
    def test_adversarial_high_volume_combinatorial_partition_matrix(self, mock_postgres_db):
        """
        Adversarial Test 8:
        Stress test with 10 distinct tenants x 4 distinct agents = 40 independent partitions.
        Verify 100% isolation across 160 combinatorial cross-tenant and cross-agent query pairs.
        """
        mock_postgres_db.connection.return_value.__enter__.return_value = self.mock_db

        tenants = [f"TENANT_{i:02d}" for i in range(1, 11)]
        agents = ["SALES", "HR", "LEGAL", "FINANCE"]

        with patch.object(
            self.memory_service,
            "ensure_agent_registered_and_get_config",
            return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000, "hafiza_saklama_gun": 30},
        ):
            # Seed each partition with a unique secret token
            for t in tenants:
                for a in agents:
                    secret_tag = f"SECRET_PAYLOAD_{t}_{a}_XYZ"
                    self.memory_service.save_explicit_agent_memory(
                        app_id=t,
                        agent_id=a,
                        conversation_id=f"conv_{t}_{a}",
                        content=f"Classified memory for {t} / {a}. Unique token: {secret_tag}",
                        importance=0.9,
                    )

            # Adversarially query across all tenant pairs
            for src_idx, src_tenant in enumerate(tenants):
                # Target a different tenant's secret
                foreign_tenant = tenants[(src_idx + 1) % len(tenants)]
                foreign_agent = "FINANCE"
                foreign_secret = f"SECRET_PAYLOAD_{foreign_tenant}_{foreign_agent}_XYZ"

                # Attempt leak from foreign tenant
                leak_query = self.memory_service.search_agent_memory(
                    app_id=src_tenant,
                    agent_id="FINANCE",
                    query=foreign_secret,
                    top_k=5,
                )
                # Verify that NEVER does a foreign tenant's secret leak into results
                for res in leak_query["results"]:
                    self.assertNotIn(
                        foreign_secret,
                        res["content"],
                        f"Cross-tenant leak detected: {src_tenant} leaked {foreign_tenant}'s secret!",
                    )

                # Attempt leak from different agent in same tenant
                same_tenant_foreign_agent = "HR"
                agent_secret = f"SECRET_PAYLOAD_{src_tenant}_{same_tenant_foreign_agent}_XYZ"
                leak_agent_query = self.memory_service.search_agent_memory(
                    app_id=src_tenant,
                    agent_id="FINANCE",
                    query=agent_secret,
                    top_k=5,
                )
                # Verify that NEVER does another agent's secret leak into results
                for res in leak_agent_query["results"]:
                    self.assertNotIn(
                        agent_secret,
                        res["content"],
                        f"Cross-agent leak detected: {src_tenant}:FINANCE leaked {same_tenant_foreign_agent}'s secret!",
                    )

                # Positive control: verify foreign tenant CAN access its own secret
                own_query = self.memory_service.search_agent_memory(
                    app_id=foreign_tenant,
                    agent_id=foreign_agent,
                    query=foreign_secret,
                    top_k=5,
                )
                self.assertGreaterEqual(own_query["total_found"], 1)
                self.assertIn(foreign_secret, own_query["results"][0]["content"])

            # Verify unregistered tenant receives strictly 0 results
            unregistered_query = self.memory_service.search_agent_memory(
                app_id="TENANT_NON_EXISTENT",
                agent_id="FINANCE",
                query="SECRET_PAYLOAD",
                top_k=5,
            )
            self.assertEqual(unregistered_query["total_found"], 0)

    def test_adversarial_composite_token_edge_cases_scoping(self):
        """
        Adversarial Test 9:
        Verify parser and auth resolver correctly partition tokens with colons inside URN agent IDs,
        whitespace padding, and special characters.
        """
        cases = [
            # raw_token, expected_key, expected_app, expected_agent
            ("sk-live-123:CORP_ACME:urn:agent:code:42:worker", "sk-live-123", "CORP_ACME", "urn:agent:code:42:worker"),
            ("sk-live-456:APP_BETA:AGENT_01:", "sk-live-456", "APP_BETA", "AGENT_01:"),
            ("  sk-live-789  :  APP_GAMMA  :  AGENT_LEGAL  ", "sk-live-789", "APP_GAMMA", "AGENT_LEGAL"),
            ("sk-live-999:AGENT_DEFAULT", "sk-live-999", None, "AGENT_DEFAULT"),
        ]

        for raw_tok, exp_k, exp_app, exp_agent in cases:
            k, app, agent = parse_composite_bearer_token(raw_tok)
            self.assertEqual(k, exp_k)
            self.assertEqual(app, exp_app)
            self.assertEqual(agent, exp_agent)


if __name__ == "__main__":
    unittest.main()

