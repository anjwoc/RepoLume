"""
Unit tests for api/routes/code.py — CodeEntities dataclass, regex extraction,
graphify output parsing.

No live MCP servers, no LLM calls, no running backend required.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from textwrap import dedent

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.routes.code import (
    CodeEntities,
    _parse_graphify_output,
    _extract_via_regex,
)


# ─── CodeEntities dataclass ───────────────────────────────────────────────────

class TestCodeEntities:
    def test_to_dict_includes_all_fields(self):
        e = CodeEntities(db_tables=["users", "orders"], source="regex")
        d = e.to_dict()
        assert d["db_tables"] == ["users", "orders"]
        assert d["source"] == "regex"
        assert "stored_procs" in d
        assert "kafka_topics" in d

    def test_counts_returns_per_category_lengths(self):
        e = CodeEntities(
            db_tables=["a", "b", "c"],
            stored_procs=["sp1"],
            kafka_topics=["t1", "t2"],
            api_endpoints=["/v1/users"],
            service_names=["OrderService"],
        )
        c = e.counts()
        assert c["tables"] == 3
        assert c["procs"] == 1
        assert c["topics"] == 2
        assert c["endpoints"] == 1
        assert c["services"] == 1

    def test_default_source_is_regex(self):
        e = CodeEntities()
        assert e.source == "regex"

    def test_codegraph_source_preserved(self):
        e = CodeEntities(source="codegraph")
        assert e.to_dict()["source"] == "codegraph"


# ─── _parse_graphify_output ───────────────────────────────────────────────────

class TestParseGraphifyOutput:
    def test_parses_plain_symbol_lines(self):
        raw = "UserService\nOrderRepository\nPaymentProcessor"
        result = _parse_graphify_output("service_names", raw)
        assert "UserService" in result
        assert "OrderRepository" in result

    def test_parses_json_node_lines(self):
        raw = '{"name": "OrderService", "file": "src/order.py", "line": 10}'
        result = _parse_graphify_output("service_names", raw)
        assert "OrderService" in result

    def test_skips_comment_lines(self):
        raw = "# This is a comment\n// another comment\nUsersTable"
        result = _parse_graphify_output("db_tables", raw)
        assert "UsersTable" in result
        assert "# This is a comment" not in result

    def test_skips_empty_lines(self):
        raw = "\n\n\nOrderService\n\n"
        result = _parse_graphify_output("service_names", raw)
        assert "OrderService" in result
        assert "" not in result

    def test_deduplicates_results(self):
        raw = "users\nusers\norders\nusers"
        result = _parse_graphify_output("db_tables", raw)
        assert result.count("users") == 1

    def test_colon_separator_takes_first_token(self):
        raw = "UserService: src/service.py:42"
        result = _parse_graphify_output("service_names", raw)
        assert "UserService" in result

    def test_returns_sorted_list(self):
        raw = "zebra\nalpha\nmiddle"
        result = _parse_graphify_output("service_names", raw)
        assert result == sorted(result)

    def test_empty_input_returns_empty_list(self):
        assert _parse_graphify_output("db_tables", "") == []

    def test_single_char_tokens_skipped(self):
        raw = "a\nb\nusers"
        result = _parse_graphify_output("db_tables", raw)
        assert "a" not in result
        assert "users" in result


# ─── _extract_via_regex ───────────────────────────────────────────────────────

def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


class TestRegexExtraction:
    """Runs _extract_via_regex against real temp files — no mocking."""

    def test_extracts_sql_table_names_from_python(self, tmp_path):
        f = tmp_path / "service.py"
        f.write_text(dedent("""
            def get_users():
                return db.execute("SELECT * FROM users WHERE active = 1")

            def create_order():
                db.execute("INSERT INTO orders (user_id, total) VALUES (?, ?)", ...)
        """))
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        assert "users" in entities.db_tables
        assert "orders" in entities.db_tables

    def test_extracts_kafka_topics(self, tmp_path):
        f = tmp_path / "events.py"
        f.write_text(dedent("""
            KAFKA_TOPIC = "order-created"
            producer.send("payment-processed", data)
        """))
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        assert "order-created" in entities.kafka_topics or "payment-processed" in entities.kafka_topics

    def test_extracts_fastapi_routes(self, tmp_path):
        f = tmp_path / "routes.py"
        f.write_text(dedent("""
            @app.get("/api/users")
            async def list_users(): pass

            @app.post("/api/orders")
            async def create_order(): pass
        """))
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        assert "/api/users" in entities.api_endpoints or "/api/orders" in entities.api_endpoints

    def test_extracts_spring_request_mapping(self, tmp_path):
        f = tmp_path / "Controller.java"
        f.write_text(dedent("""
            @GetMapping("/orders/{id}")
            public OrderDto getOrder(@PathVariable Long id) { return service.get(id); }
        """))
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        assert "/orders/{id}" in entities.api_endpoints

    def test_extracts_service_class_names(self, tmp_path):
        f = tmp_path / "services.py"
        f.write_text(dedent("""
            class OrderService:
                def process(self): pass

            class PaymentService:
                def charge(self): pass
        """))
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        assert "OrderService" in entities.service_names or "PaymentService" in entities.service_names

    def test_sql_keywords_not_included_as_tables(self, tmp_path):
        f = tmp_path / "query.py"
        f.write_text(dedent("""
            db.execute("SELECT id FROM users WHERE active = true AND role = 'admin'")
        """))
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        skip_words = {"select", "where", "from", "and", "true", "false"}
        for t in entities.db_tables:
            assert t.lower() not in skip_words, f"keyword '{t}' incorrectly added as table"

    def test_extracts_env_references(self, tmp_path):
        f = tmp_path / "config.py"
        f.write_text(dedent("""
            DB_HOST = os.environ.get("DATABASE_HOST", "localhost")
            API_KEY = os.getenv("OPENAI_API_KEY")
        """))
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        assert "DATABASE_HOST" in entities.env_references or "OPENAI_API_KEY" in entities.env_references

    def test_empty_directory_returns_empty_entities(self, tmp_path):
        entities = _run(_extract_via_regex(str(tmp_path), [], None))
        assert entities.db_tables == []
        assert entities.stored_procs == []
        assert entities.source == "regex"

    def test_non_source_files_skipped(self, tmp_path):
        # .txt file should not be processed
        f = tmp_path / "notes.txt"
        f.write_text("SELECT * FROM secrets")
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        # .txt is not in _SOURCE_EXTENSIONS, so this file is skipped
        assert "secrets" not in entities.db_tables

    def test_stored_proc_extraction(self, tmp_path):
        f = tmp_path / "repo.py"
        f.write_text(dedent("""
            cursor.callproc("sp_get_order", [order_id])
            cursor.callproc("sp_update_inventory", [item_id, qty])
        """))
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        assert any("sp_" in p for p in entities.stored_procs)

    def test_source_field_is_regex(self, tmp_path):
        f = tmp_path / "app.py"
        f.write_text("x = 1")
        entities = _run(_extract_via_regex(str(tmp_path), [str(f)], None))
        assert entities.source == "regex"
