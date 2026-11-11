import sys
import unittest
from unittest.mock import MagicMock, patch

if "app.repositories.postgres_db" not in sys.modules:
    mock_pg_db = MagicMock()
    mock_db_mod = MagicMock()
    mock_db_mod.postgres_db = mock_pg_db
    mock_db_mod.sqlite_db = mock_pg_db
    mock_db_mod.PostgresDatabaseManager = MagicMock
    sys.modules["app.repositories.postgres_db"] = mock_db_mod

from app.services.agent_memory_service import AgentMemoryService


class TestMemoryScopingUnit(unittest.TestCase):
    """Unit tests for AgentMemoryService multi-tenant scoping and SQL query binding."""

    def setUp(self):
        self.service = AgentMemoryService()

    def test_normalize_identity_happy_path(self):
        app, agent = self.service.normalize_identity("APP_CORP", "AGENT_SALES")
        self.assertEqual(app, "APP_CORP")
        self.assertEqual(agent, "AGENT_SALES")

    def test_normalize_identity_casing_and_strip(self):
        app, agent = self.service.normalize_identity("  corp_app  ", "  agent_sales  ")
        self.assertEqual(app, "CORP_APP")
        self.assertEqual(agent, "AGENT_SALES")

    def test_normalize_identity_no_fallback_to_thinkport_core_when_app_id_missing(self):
        # Prevent cross-tenant leakage: do NOT fall back to THINKPORT_CORE
        self.assertEqual(self.service.normalize_identity("", "AGENT_SALES"), ("", ""))
        self.assertEqual(self.service.normalize_identity(None, "AGENT_SALES"), ("", ""))
        self.assertEqual(self.service.normalize_identity("   ", "AGENT_SALES"), ("", ""))

    def test_normalize_identity_empty_agent_returns_empty(self):
        self.assertEqual(self.service.normalize_identity("APP_1", ""), ("", ""))
        self.assertEqual(self.service.normalize_identity("APP_1", None), ("", ""))
        self.assertEqual(self.service.normalize_identity("", ""), ("", ""))

    def test_normalize_identity_explicit_thinkport_core_preserved(self):
        app, agent = self.service.normalize_identity("THINKPORT_CORE", "AGENT_1")
        self.assertEqual(app, "THINKPORT_CORE")
        self.assertEqual(agent, "AGENT_1")

    @patch("app.services.agent_memory_service.postgres_db")
    def test_search_agent_memory_binds_where_clause_with_app_and_agent(self, mock_db):
        mock_conn = MagicMock()
        mock_db.connection.return_value.__enter__.return_value = mock_conn
        mock_conn.execute.return_value.fetchall.return_value = []

        res = self.service.search_agent_memory(
            app_id="TENANT_ALPHA",
            agent_id="AGENT_SALES",
            query="quarterly revenue",
            top_k=5,
        )
        self.assertEqual(res["app_id"], "TENANT_ALPHA")
        self.assertEqual(res["agent_id"], "AGENT_SALES")
        self.assertEqual(res["total_found"], 0)

        mock_conn.execute.assert_called()
        executed_sql = mock_conn.execute.call_args[0][0]
        params = mock_conn.execute.call_args[0][1]

        self.assertIn("WHERE app_id = ? AND agent_id = ?", executed_sql)
        self.assertIn("TENANT_ALPHA", params)
        self.assertIn("AGENT_SALES", params)

    def test_search_agent_memory_empty_app_id_returns_empty_without_query(self):
        res = self.service.search_agent_memory(
            app_id="",
            agent_id="AGENT_SALES",
            query="quarterly revenue",
        )
        self.assertEqual(res["total_found"], 0)
        self.assertEqual(res["results"], [])

    @patch("app.services.agent_memory_service.postgres_db")
    def test_record_interaction_memory_inserts_app_and_agent(self, mock_db):
        mock_conn = MagicMock()
        mock_db.connection.return_value.__enter__.return_value = mock_conn
        mock_conn.execute.return_value.fetchone.return_value = {"c": 1}

        with patch.object(self.service, "ensure_agent_registered_and_get_config", return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000}):
            mem_id = self.service.record_interaction_memory(
                app_id="TENANT_ALPHA",
                agent_id="AGENT_SALES",
                conversation_id="conv_101",
                request_id="req_101",
                prompt_text="What is our Q3 forecast?",
                response_text="Q3 forecast is 4.5M USD.",
            )
            self.assertIsNotNone(mem_id)

            # Check INSERT statement
            insert_call = mock_conn.execute.call_args_list[0]
            sql = insert_call[0][0]
            params = insert_call[0][1]

            self.assertIn("INSERT INTO agent_memories", sql)
            self.assertIn("app_id", sql)
            self.assertIn("agent_id", sql)
            self.assertEqual(params[1], "TENANT_ALPHA")
            self.assertEqual(params[2], "AGENT_SALES")

    def test_record_interaction_memory_empty_app_id_returns_none(self):
        res = self.service.record_interaction_memory(
            app_id="",
            agent_id="AGENT_SALES",
            conversation_id="conv_1",
            request_id="req_1",
            prompt_text="Prompt",
            response_text="Response",
        )
        self.assertIsNone(res)

    @patch("app.services.agent_memory_service.postgres_db")
    def test_save_explicit_agent_memory_binds_app_and_agent(self, mock_db):
        mock_conn = MagicMock()
        mock_db.connection.return_value.__enter__.return_value = mock_conn
        mock_conn.execute.return_value.fetchone.return_value = {"c": 1}

        with patch.object(self.service, "ensure_agent_registered_and_get_config", return_value={"hafiza_aktif_mi": True, "hafiza_max_kayit": 1000}):
            res = self.service.save_explicit_agent_memory(
                app_id="TENANT_BETA",
                agent_id="AGENT_HR",
                conversation_id="conv_202",
                content="HR policy: 25 days paid leave.",
            )
            self.assertEqual(res["status"], "saved")
            self.assertEqual(res["app_id"], "TENANT_BETA")
            self.assertEqual(res["agent_id"], "AGENT_HR")

            insert_call = mock_conn.execute.call_args_list[0]
            params = insert_call[0][1]
            self.assertEqual(params[1], "TENANT_BETA")
            self.assertEqual(params[2], "AGENT_HR")

    @patch("app.services.agent_memory_service.postgres_db")
    def test_prune_agent_memories_binds_app_and_agent(self, mock_db):
        mock_conn = MagicMock()
        mock_db.connection.return_value.__enter__.return_value = mock_conn
        mock_res_ttl = MagicMock()
        mock_res_ttl.rowcount = 2
        mock_cnt = MagicMock()
        mock_cnt.fetchone.return_value = {"c": 50}
        mock_conn.execute.side_effect = [
            mock_res_ttl,
            mock_cnt,
        ]

        deleted = self.service.prune_agent_memories(
            app_id="TENANT_GAMMA",
            agent_id="AGENT_LEGAL",
            max_records=100,
        )
        self.assertEqual(deleted, 2)

        # Verify DELETE statement
        delete_call = mock_conn.execute.call_args_list[0]
        sql = delete_call[0][0]
        params = delete_call[0][1]

        self.assertIn("DELETE FROM agent_memories", sql)
        self.assertIn("WHERE app_id = ? AND agent_id = ?", sql)
        self.assertEqual(params[0], "TENANT_GAMMA")
        self.assertEqual(params[1], "AGENT_LEGAL")


if __name__ == "__main__":
    unittest.main()
