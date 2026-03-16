import httpx


class GatewayClientError(Exception):
    pass


class GatewayClient:
    def __init__(self, base_url: str, api_key: str, timeout_seconds: float = 45, verify_tls: bool = False):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.verify_tls = verify_tls

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise GatewayClientError("Gateway API key is missing")
        return {
            "Content-Type": "application/json",
            "X-Internal-API-Key": self.api_key,
        }

    def health(self) -> bool:
        try:
            with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
                response = client.get(f"{self.base_url}/health")
                if response.status_code != 200:
                    return False
                body = response.json()
                return body.get("status") == "healthy"
        except Exception:
            return False

    def get_models(self) -> list[dict]:
        try:
            with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
                response = client.get(
                    f"{self.base_url}/api/models",
                    headers=self._headers(),
                )
                if response.status_code != 200:
                    return []
                data = response.json()
                models = data.get("models")
                return models if isinstance(models, list) else []
        except Exception:
            return []

    def execute_fal(
        self,
        media_type: str,
        payload: dict,
        model: str | None = None,
        dry_run: bool = False,
    ) -> dict:
        body = {
            "provider": "fal",
            "media_type": media_type,
            "payload": payload,
            "dry_run": dry_run,
        }
        if model:
            body["model"] = model

        with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
            response = client.post(
                f"{self.base_url}/api/execute",
                json=body,
                headers=self._headers(),
            )

        if response.status_code >= 400:
            detail = response.text
            try:
                body = response.json()
                detail = body.get("message") or body.get("detail") or detail
            except Exception:
                pass
            raise GatewayClientError(f"Gateway execute failed: {detail}")

        return response.json()

    def execute_text(
        self,
        *,
        prompt: str,
        model: str | None = None,
        response_format: str = "text",
        dry_run: bool = False,
    ) -> dict:
        """
        Execute a text-generation request via the gateway.

        Uses the same /api/execute contract as media generation.
        Tries provider-less routing first, then common provider fallbacks.
        """
        if response_format not in {"text", "json"}:
            raise GatewayClientError("response_format must be 'text' or 'json'")

        payload = {"prompt": prompt, "response_format": response_format}
        if model:
            payload["model"] = model

        attempts = [
            {"media_type": "text-generation", "payload": payload, "dry_run": dry_run},
            {"provider": "openai", "media_type": "text-generation", "payload": payload, "dry_run": dry_run},
            {"provider": "anthropic", "media_type": "text-generation", "payload": payload, "dry_run": dry_run},
        ]
        last_detail = "Unknown gateway error"

        with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
            for body in attempts:
                response = client.post(
                    f"{self.base_url}/api/execute",
                    json=body,
                    headers=self._headers(),
                )
                if response.status_code < 400:
                    return response.json()
                detail = response.text
                try:
                    response_body = response.json()
                    detail = response_body.get("message") or response_body.get("detail") or detail
                except Exception:
                    pass
                last_detail = detail

        raise GatewayClientError(f"Gateway text generation failed: {last_detail}")

    def get_status(self, job_id: str) -> dict:
        with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
            response = client.get(
                f"{self.base_url}/api/status/{job_id}",
                headers=self._headers(),
            )
        if response.status_code >= 400:
            detail = response.text
            try:
                body = response.json()
                detail = body.get("message") or body.get("detail") or detail
            except Exception:
                pass
            raise GatewayClientError(f"Gateway status failed: {detail}")
        return response.json()
