"""Env-guard contract: redis_url_problem catches the #1 setup mistake (pasting
Upstash's https:// REST URL into the native Redis slot); the normalizers
tolerate the #2 and #3 — secrets pasted with wrapping quotes, and SUPABASE_URL
pasted as the REST endpoint instead of the bare project origin."""
import os

from sim_worker.__main__ import (
    _strip_wrapping_quotes,
    normalize_supabase_url,
    redis_url_problem,
)


def test_accepts_native_rediss_url():
    assert redis_url_problem("rediss://default:pw@host.upstash.io:6379") is None


def test_accepts_plain_redis_and_unix():
    assert redis_url_problem("redis://localhost:6379") is None
    assert redis_url_problem("unix:///var/run/redis.sock") is None


def test_rejects_rest_https_url_with_helpful_hint():
    msg = redis_url_problem("https://host.upstash.io")
    assert msg is not None
    assert "REST" in msg and "rediss://" in msg


def test_rejects_empty():
    assert redis_url_problem("") is not None
    assert redis_url_problem(None) is not None


def test_rejects_schemeless():
    assert redis_url_problem("host.upstash.io:6379") is not None


def test_strip_wrapping_quotes_env(monkeypatch):
    monkeypatch.setenv("T_QUOTED", '"rediss://default:pw@host.upstash.io:6379"')
    _strip_wrapping_quotes("T_QUOTED")
    assert os.environ["T_QUOTED"] == "rediss://default:pw@host.upstash.io:6379"
    # A quoted-then-stripped URL must pass the scheme guard.
    assert redis_url_problem(os.environ["T_QUOTED"]) is None


def test_strip_wrapping_quotes_leaves_clean_values(monkeypatch):
    monkeypatch.setenv("T_PLAIN", "plain-value")
    _strip_wrapping_quotes("T_PLAIN")
    assert os.environ["T_PLAIN"] == "plain-value"
    monkeypatch.setenv("T_LONE", '"')
    _strip_wrapping_quotes("T_LONE")
    assert os.environ["T_LONE"] == '"'


def test_normalize_supabase_url_strips_rest_suffix():
    assert (
        normalize_supabase_url("https://ref.supabase.co/rest/v1")
        == "https://ref.supabase.co"
    )
    assert (
        normalize_supabase_url("https://ref.supabase.co/rest/v1/")
        == "https://ref.supabase.co"
    )
    assert (
        normalize_supabase_url("https://ref.supabase.co/realtime/v1")
        == "https://ref.supabase.co"
    )


def test_normalize_supabase_url_keeps_bare_origin():
    assert (
        normalize_supabase_url("https://ref.supabase.co")
        == "https://ref.supabase.co"
    )
    assert (
        normalize_supabase_url("https://ref.supabase.co/")
        == "https://ref.supabase.co"
    )
