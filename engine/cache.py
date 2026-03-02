"""
Valkey-backed cache for the API. Uses VALKEY_URL when set; otherwise no-op (no cache).
Redis protocol URL works with Valkey (e.g. redis://valkey:6379/0).
"""
import json
import os
from typing import Any, Optional

_valkey_client: Optional[Any] = None


def _get_client():
    global _valkey_client
    if _valkey_client is not None:
        return _valkey_client
    url = os.getenv("VALKEY_URL")
    if not url:
        return None
    try:
        import valkey
        _valkey_client = valkey.from_url(url, decode_responses=True)
        _valkey_client.ping()
        return _valkey_client
    except Exception:
        return None


def cache_get(key: str) -> Optional[str]:
    """Get a value from cache. Returns None if cache disabled or key missing."""
    client = _get_client()
    if not client:
        return None
    try:
        return client.get(key)
    except Exception:
        return None


def cache_set(key: str, value: str, ttl_seconds: int = 60) -> None:
    """Set a value in cache with TTL. No-op if cache disabled."""
    client = _get_client()
    if not client:
        return
    try:
        client.setex(key, ttl_seconds, value)
    except Exception:
        pass


def cache_delete(key: str) -> None:
    """Delete a key from cache. No-op if cache disabled."""
    client = _get_client()
    if not client:
        return
    try:
        client.delete(key)
    except Exception:
        pass


# Default TTL for list/project caches (seconds)
PROJECTS_LIST_TTL = 60

# Script caches
SCRIPTS_LIST_TTL = 60
SCRIPTS_STATS_TTL = 300


def scripts_list_key(project_id: str) -> str:
    return f"scripts:list:{project_id}"


def scripts_stats_key(script_id: str) -> str:
    return f"scripts:stats:{script_id}"
