import unittest
from app.core.security import (
    extract_bearer_token,
    parse_composite_bearer_token,
    parse_composite_token,
    hash_api_key,
)


class TestSecurityCompositeTokens(unittest.TestCase):
    """Unit tests for Bearer token extraction and composite token parsing."""

    def test_extract_bearer_token_standard(self):
        token = extract_bearer_token("Bearer sk-gw-abcdef123456")
        self.assertEqual(token, "sk-gw-abcdef123456")

    def test_extract_bearer_token_case_insensitive(self):
        self.assertEqual(extract_bearer_token("bearer sk-gw-lower"), "sk-gw-lower")
        self.assertEqual(extract_bearer_token("BEARER sk-gw-upper"), "sk-gw-upper")

    def test_extract_bearer_token_bare(self):
        self.assertEqual(extract_bearer_token("sk-gw-bare-key"), "sk-gw-bare-key")

    def test_extract_bearer_token_empty_and_none(self):
        self.assertIsNone(extract_bearer_token(None))
        self.assertIsNone(extract_bearer_token(""))
        self.assertIsNone(extract_bearer_token("   "))
        self.assertIsNone(extract_bearer_token("Bearer"))
        self.assertIsNone(extract_bearer_token("Bearer "))

    def test_parse_composite_3_parts(self):
        api_key, app_id, agent_id = parse_composite_bearer_token("Bearer sk-gw-123:WEBAKUS_ERP:AGENT_SALES")
        self.assertEqual(api_key, "sk-gw-123")
        self.assertEqual(app_id, "WEBAKUS_ERP")
        self.assertEqual(agent_id, "AGENT_SALES")

    def test_parse_composite_2_parts(self):
        api_key, app_id, agent_id = parse_composite_bearer_token("Bearer sk-gw-123:AGENT_OPS")
        self.assertEqual(api_key, "sk-gw-123")
        self.assertIsNone(app_id)
        self.assertEqual(agent_id, "AGENT_OPS")

    def test_parse_composite_1_part(self):
        api_key, app_id, agent_id = parse_composite_bearer_token("Bearer sk-gw-123")
        self.assertEqual(api_key, "sk-gw-123")
        self.assertIsNone(app_id)
        self.assertIsNone(agent_id)

    def test_parse_composite_with_colons_inside_agent_id(self):
        api_key, app_id, agent_id = parse_composite_bearer_token("Bearer sk-gw-123:APP_CORP:urn:agent:code:42:sub")
        self.assertEqual(api_key, "sk-gw-123")
        self.assertEqual(app_id, "APP_CORP")
        self.assertEqual(agent_id, "urn:agent:code:42:sub")

    def test_parse_composite_multiple_consecutive_colons(self):
        api_key, app_id, agent_id = parse_composite_bearer_token("Bearer sk-gw-123::AGENT_OPS")
        self.assertEqual(api_key, "sk-gw-123")
        self.assertIsNone(app_id)
        self.assertEqual(agent_id, "AGENT_OPS")

    def test_parse_composite_trailing_colons(self):
        api_key, app_id, agent_id = parse_composite_bearer_token("Bearer sk-gw-123:APP_1:AGENT_1:")
        self.assertEqual(api_key, "sk-gw-123")
        self.assertEqual(app_id, "APP_1")
        self.assertEqual(agent_id, "AGENT_1:")

    def test_parse_composite_whitespace_around_parts(self):
        api_key, app_id, agent_id = parse_composite_bearer_token("Bearer   sk-gw-123   :   APP_SPACED   :   AGENT_SPACED   ")
        self.assertEqual(api_key, "sk-gw-123")
        self.assertEqual(app_id, "APP_SPACED")
        self.assertEqual(agent_id, "AGENT_SPACED")

    def test_parse_composite_empty_and_colon_only(self):
        self.assertEqual(parse_composite_bearer_token(""), ("", None, None))
        self.assertEqual(parse_composite_bearer_token("   "), ("", None, None))
        self.assertEqual(parse_composite_bearer_token(":"), ("", None, None))
        self.assertEqual(parse_composite_bearer_token("::"), ("", None, None))
        self.assertEqual(parse_composite_bearer_token(None), ("", None, None))
        self.assertEqual(parse_composite_bearer_token("Bearer "), ("", None, None))

    def test_parse_composite_alias(self):
        res1 = parse_composite_bearer_token("sk-gw-123:APP:AGENT")
        res2 = parse_composite_token("sk-gw-123:APP:AGENT")
        self.assertEqual(res1, res2)

    def test_hash_api_key(self):
        h1 = hash_api_key("sk-gw-key-1")
        self.assertEqual(len(h1), 64)
        self.assertEqual(h1, hash_api_key("sk-gw-key-1"))
        self.assertNotEqual(hash_api_key("sk-gw-key-1"), hash_api_key("sk-gw-key-2"))
        self.assertNotEqual(hash_api_key("sk-gw-KEY"), hash_api_key("sk-gw-key"))


if __name__ == "__main__":
    unittest.main()
