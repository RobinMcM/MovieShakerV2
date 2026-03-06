import json
import sys
from pathlib import Path
from types import SimpleNamespace

# Allow importing engine modules when running from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import contact
import main
from config import load_settings


class DummySession:
    def __init__(self):
        self.items = []
        self.committed = False

    def add(self, item):
        self.items.append(item)

    def commit(self):
        self.committed = True


def _request(origin: str = "http://localhost:3000", ip: str = "127.0.0.1"):
    return SimpleNamespace(headers={"origin": origin}, client=SimpleNamespace(host=ip))


def test_load_settings_builds_cors_from_defaults_and_env(monkeypatch):
    monkeypatch.setenv("API_BASE_URL", "https://api.example.com")
    monkeypatch.setenv("WEBSITE_DOMAIN", "https://app.example.com")
    monkeypatch.setenv("CORS_ORIGINS", "https://extra.example.com, https://movieshaker.com")

    settings = load_settings()
    assert settings.api_base_url == "https://api.example.com"
    assert settings.website_domain == "https://app.example.com"
    assert "https://app.example.com" in settings.cors_origins
    assert "https://extra.example.com" in settings.cors_origins
    # Safe defaults stay present even when CORS_ORIGINS is provided.
    assert "https://movieshaker.com" in settings.cors_origins


def test_contact_submit_success_persists_submission():
    contact._submission_times.clear()
    db = DummySession()
    body = contact.ContactSubmitBody(
        name="Jane",
        email="jane@example.com",
        message="Hello from the test suite.",
        honeypot=None,
    )
    resp = contact.submit_contact(_request(), body, db)
    assert resp["success"] is True
    assert db.committed is True
    assert len(db.items) == 1
    assert db.items[0].email == "jane@example.com"


def test_contact_honeypot_returns_success_without_db_write():
    contact._submission_times.clear()
    db = DummySession()
    body = contact.ContactSubmitBody(
        name="Bot",
        email="bot@example.com",
        message="This should not be stored.",
        honeypot="filled-by-bot",
    )
    resp = contact.submit_contact(_request(), body, db)
    assert resp["success"] is True
    assert db.committed is False
    assert db.items == []


def test_contact_rate_limit_blocks_after_threshold():
    contact._submission_times.clear()
    ip = "10.1.2.3"
    for _ in range(contact.RATE_LIMIT_COUNT):
        assert contact._check_rate_limit(ip) is True
    assert contact._check_rate_limit(ip) is False


def test_global_exception_handler_does_not_leak_errors_in_production(monkeypatch):
    # Ensure production responses do not expose raw exceptions.
    monkeypatch.setattr(main, "settings", SimpleNamespace(is_production=True), raising=False)
    request = _request()
    response = main.global_exception_handler(request, RuntimeError("secret stack detail"))
    payload = json.loads(response.body.decode("utf-8"))
    assert payload["detail"] == "Internal server error"
    assert "secret stack detail" not in response.body.decode("utf-8")
