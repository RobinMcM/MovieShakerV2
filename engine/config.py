import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


def _load_env_files() -> None:
    # Support both engine/.env and root .env in local/dev workflows.
    env_dir = Path(__file__).resolve().parent
    load_dotenv(env_dir / ".env")
    load_dotenv(env_dir.parent / ".env")


def _split_csv_env(name: str) -> list[str]:
    value = os.getenv(name, "").strip()
    if not value:
        return []
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


@dataclass(frozen=True)
class Settings:
    app_env: str
    api_port: int
    web_port: int
    api_base_url: str
    website_domain: str
    supertokens_connection_uri: str
    cors_origins: list[str]
    gateway_base_url: str
    gateway_internal_api_key: str
    gateway_timeout_seconds: float
    gateway_connect_timeout_seconds: float
    gateway_read_timeout_seconds: float
    gateway_verify_tls: bool
    media_handler_base_url: str
    media_handler_internal_api_key: str
    media_handler_timeout_seconds: float
    media_handler_verify_tls: bool
    sql_echo: bool

    @property
    def is_production(self) -> bool:
        return self.app_env in {"prod", "production"}


def load_settings() -> Settings:
    _load_env_files()

    app_env = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).strip().lower()
    api_port = int(os.getenv("API_PORT", "8000"))
    web_port = int(os.getenv("WEB_PORT", "5173"))
    api_base_url = os.getenv("API_BASE_URL", f"http://localhost:{api_port}").rstrip("/")
    website_domain = os.getenv(
        "WEBSITE_DOMAIN",
        os.getenv("WEB_HOST", f"http://localhost:{web_port}"),
    ).rstrip("/")

    default_production_origins = [
        "https://movieshaker.com",
        "https://www.movieshaker.com",
        "https://ooocreatives.com",
        "https://afilminabox.com",
        "https://reelinvesting.com",
        "https://dolphin-app-9dvbj.ondigitalocean.app",
    ]
    dev_origins = [
        f"http://localhost:{web_port}",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://localhost:3001",
    ]
    env_origins = _split_csv_env("CORS_ORIGINS")
    if app_env in {"prod", "production"}:
        cors_origins = _dedupe(default_production_origins + env_origins + [website_domain])
    else:
        cors_origins = _dedupe(dev_origins + default_production_origins + env_origins + [website_domain])
    gateway_verify_tls = _env_bool(
        "GATEWAY_VERIFY_TLS",
        default=(app_env in {"prod", "production"}),
    )
    media_handler_verify_tls = _env_bool(
        "MEDIA_HANDLER_VERIFY_TLS",
        default=(app_env in {"prod", "production"}),
    )
    sql_echo = os.getenv("SQL_ECHO", "false").strip().lower() in {"1", "true", "yes"}

    return Settings(
        app_env=app_env,
        api_port=api_port,
        web_port=web_port,
        api_base_url=api_base_url,
        website_domain=website_domain,
        supertokens_connection_uri=os.getenv("SUPERTOKENS_CONNECTION_URI", "http://supertokens:3567"),
        cors_origins=cors_origins,
        gateway_base_url=os.getenv("GATEWAY_BASE_URL", "https://models.rapidmvp.io").rstrip("/"),
        gateway_internal_api_key=os.getenv("GATEWAY_INTERNAL_API_KEY", "").strip(),
        gateway_timeout_seconds=float(os.getenv("GATEWAY_TIMEOUT_SECONDS", "45")),
        gateway_connect_timeout_seconds=float(os.getenv("GATEWAY_CONNECT_TIMEOUT_SECONDS", "8")),
        gateway_read_timeout_seconds=float(os.getenv("GATEWAY_READ_TIMEOUT_SECONDS", "45")),
        gateway_verify_tls=gateway_verify_tls,
        media_handler_base_url=os.getenv("MEDIA_HANDLER_BASE_URL", "").rstrip("/"),
        media_handler_internal_api_key=os.getenv("MEDIA_HANDLER_INTERNAL_API_KEY", "").strip(),
        media_handler_timeout_seconds=float(os.getenv("MEDIA_HANDLER_TIMEOUT_SECONDS", "60")),
        media_handler_verify_tls=media_handler_verify_tls,
        sql_echo=sql_echo,
    )
