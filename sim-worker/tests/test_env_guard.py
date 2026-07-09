"""redis_url_problem guards the #1 setup mistake: pasting Upstash's https://
REST URL into the worker's native Redis slot (which else crash-loops on boot)."""
from sim_worker.__main__ import redis_url_problem


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
