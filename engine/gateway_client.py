import httpx


class GatewayClientError(Exception):
    pass


class GatewayClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout_seconds: float = 45,
        verify_tls: bool = False,
        connect_timeout_seconds: float | None = None,
        read_timeout_seconds: float | None = None,
        max_retries: int = 2,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_seconds = timeout_seconds
        self.verify_tls = verify_tls
        self.connect_timeout_seconds = (
            connect_timeout_seconds
            if connect_timeout_seconds is not None
            else min(10.0, max(1.0, timeout_seconds / 3.0))
        )
        self.read_timeout_seconds = (
            read_timeout_seconds
            if read_timeout_seconds is not None
            else max(5.0, timeout_seconds)
        )
        self.max_retries = max(0, max_retries)

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise GatewayClientError("Gateway API key is missing")
        return {
            "Content-Type": "application/json",
            "X-Internal-API-Key": self.api_key,
        }

    def _timeout(self) -> httpx.Timeout:
        return httpx.Timeout(
            timeout=self.read_timeout_seconds,
            connect=self.connect_timeout_seconds,
            read=self.read_timeout_seconds,
            write=self.read_timeout_seconds,
            pool=self.connect_timeout_seconds,
        )

    def _request_json(
        self,
        *,
        method: str,
        path: str,
        json_body: dict | None = None,
        require_auth: bool = True,
        retry_on_5xx: bool = True,
    ) -> tuple[int, dict | None, str]:
        url = f"{self.base_url}{path}"
        headers = self._headers() if require_auth else None
        attempts = self.max_retries + 1
        last_error = "Unknown gateway error"
        for attempt in range(1, attempts + 1):
            try:
                with httpx.Client(timeout=self._timeout(), verify=self.verify_tls) as client:
                    response = client.request(method, url, headers=headers, json=json_body)
            except httpx.RequestError as exc:
                last_error = f"{exc.__class__.__name__}: {exc}"
                if attempt < attempts:
                    continue
                raise GatewayClientError(
                    f"Gateway request failed ({method} {path}) after {attempts} attempts: {last_error}"
                )

            response_text = response.text or ""
            response_json = None
            if response_text:
                try:
                    response_json = response.json()
                except Exception:
                    response_json = None

            if response.status_code >= 500 and retry_on_5xx and attempt < attempts:
                continue

            detail = response_text
            if isinstance(response_json, dict):
                detail = (
                    response_json.get("message")
                    or response_json.get("detail")
                    or response_json.get("error")
                    or response_text
                )
            return response.status_code, response_json, detail

        raise GatewayClientError(f"Gateway request failed ({method} {path}): {last_error}")

    def health(self) -> bool:
        try:
            status_code, body, _ = self._request_json(
                method="GET",
                path="/health",
                require_auth=False,
                retry_on_5xx=False,
            )
            if status_code != 200 or not isinstance(body, dict):
                return False
            return body.get("status") == "healthy"
        except Exception:
            return False

    def get_models(self) -> list[dict]:
        try:
            status_code, data, _ = self._request_json(method="GET", path="/api/models")
            if status_code != 200 or not isinstance(data, dict):
                return []
            models = data.get("models")
            return models if isinstance(models, list) else []
        except Exception:
            return []

    def generate_image(
        self,
        prompt: str,
        model_key: str = "flux-2-klein",
        aspect_ratio: str = "1:1",
        dry_run: bool = False,
    ) -> dict:
        """
        Generate an image via the OpenRouter gateway synchronously.
        Returns {"ok": true, "image_b64": "...", "content_type": "image/png",
                 "model": "...", "model_key": "..."}.
        image_b64 is None when dry_run=True.
        """
        status_code, response_json, detail = self._request_json(
            method="POST",
            path="/api/image/generate",
            json_body={
                "prompt": prompt,
                "model_key": model_key,
                "aspect_ratio": aspect_ratio,
                "dry_run": dry_run,
            },
        )
        if status_code >= 400:
            raise GatewayClientError(f"Gateway image generate failed ({status_code}): {detail}")
        if not isinstance(response_json, dict):
            raise GatewayClientError("Gateway image generate failed: response is not valid JSON")
        return response_json

    def generate_video(
        self,
        prompt: str,
        model_key: str = "kling-v3-pro",
        source_image: str | None = None,
        duration: int | None = None,
        aspect_ratio: str = "16:9",
        dry_run: bool = False,
    ) -> dict:
        """
        Generate a video via the gateway synchronously.
        Returns {"ok": true, "video_url": "...", "content_type": "video/mp4",
                 "model": "...", "model_key": "..."}.
        """
        body: dict = {
            "model_key": model_key,
            "prompt": prompt,
            "aspect_ratio": aspect_ratio,
            "dry_run": dry_run,
        }
        if source_image:
            body["source_image"] = source_image
        if duration is not None:
            body["duration"] = duration
        status_code, response_json, detail = self._request_json(
            method="POST",
            path="/api/video/generate",
            json_body=body,
        )
        if status_code >= 400:
            raise GatewayClientError(f"Gateway video generate failed ({status_code}): {detail}")
        if not isinstance(response_json, dict):
            raise GatewayClientError("Gateway video generate failed: response is not valid JSON")
        return response_json

    def execute_text(
        self,
        *,
        model: str,
        messages: list[dict[str, str]],
        dry_run: bool = False,
    ) -> dict:
        """
        Execute a text-completion request via OpenRouter through gateway.
        Matches chatbot contract used against usageflows /api/execute.
        """
        if not model.strip():
            raise GatewayClientError("Model is required for text generation")
        if not isinstance(messages, list) or not messages:
            raise GatewayClientError("Messages are required for text generation")

        body = {
            "provider": "openrouter",
            "job_type": "text-completion",
            "payload": {
                "model": model,
                "messages": messages,
            },
            "dry_run": dry_run,
        }
        status_code, response_json, detail = self._request_json(
            method="POST",
            path="/api/execute",
            json_body=body,
        )
        if status_code >= 400:
            raise GatewayClientError(f"Gateway text generation failed ({status_code}): {detail}")
        if not isinstance(response_json, dict):
            raise GatewayClientError("Gateway text generation failed: response is not valid JSON")
        if response_json.get("status") == "error":
            raise GatewayClientError(f"Gateway returned error: {response_json.get('message', 'unknown error')}")
        return response_json

    def execute_team_task(
        self,
        *,
        team: str,
        task: str,
        prompt: str | None = None,
        messages: list[dict] | None = None,
        source: str | None = None,
        options: dict | None = None,
        dry_run: bool = False,
    ) -> dict:
        """
        Call /api/team/execute. The gateway resolves the model from the team
        registry and executes. Returns the full response dict including
        'resolved_model', 'endpoint', and 'result'.
        """
        body: dict = {"team": team, "task": task, "dry_run": dry_run}
        if prompt is not None:
            body["prompt"] = prompt
        if messages is not None:
            body["messages"] = messages
        if source is not None:
            body["source"] = source
        if options:
            body["options"] = options
        status_code, response_json, detail = self._request_json(
            method="POST",
            path="/api/team/execute",
            json_body=body,
        )
        if status_code >= 400:
            raise GatewayClientError(f"Gateway team execute failed ({status_code}): {detail}")
        if not isinstance(response_json, dict):
            raise GatewayClientError("Gateway team execute failed: response is not valid JSON")
        return response_json

    def execute_text_autonomous(
        self,
        *,
        team: str,
        task: str,
        messages: list[dict],
        options: dict | None = None,
        dry_run: bool = False,
    ) -> dict:
        """
        Execute a text task via the team registry. The gateway selects the
        model — no model ID is sent by the engine. Surfaces 'usage' at the
        top level so extract_credit_cost() works without changes.
        """
        response = self.execute_team_task(
            team=team,
            task=task,
            messages=messages,
            options=options,
            dry_run=dry_run,
        )
        result = response.get("result")
        if isinstance(result, dict) and "usage" in result and "usage" not in response:
            response["usage"] = result["usage"]
        return response

    def execute_media_autonomous(
        self,
        *,
        team: str,
        task: str,
        prompt: str,
        source: str | None = None,
        options: dict | None = None,
        dry_run: bool = False,
    ) -> dict:
        """
        Execute an image or video task via the team registry. The gateway
        selects the model based on the team's ranked model list.
        Returns {"ok": true, "result": {"image_b64"|"video_url": ..., ...}}.
        """
        return self.execute_team_task(
            team=team,
            task=task,
            prompt=prompt,
            source=source,
            options=options,
            dry_run=dry_run,
        )

    def route_team(self, *, team: str, task: str) -> dict:
        """
        Resolve (team, task) → model without executing.
        Returns {"ok": true, "team": ..., "resolved_model": ..., "endpoint": ...}.
        """
        body = {"team": team, "task": task}
        status_code, response_json, detail = self._request_json(
            method="POST",
            path="/api/team/route",
            json_body=body,
        )
        if status_code >= 400:
            raise GatewayClientError(f"Gateway team route failed ({status_code}): {detail}")
        if not isinstance(response_json, dict):
            raise GatewayClientError("Gateway team route failed: response is not valid JSON")
        return response_json

    def get_status(self, job_id: str) -> dict:
        # Legacy compat: used by video status polling for historical rows with task_id.
        status_code, response_json, detail = self._request_json(
            method="GET",
            path=f"/api/status/{job_id}",
        )
        if status_code >= 400:
            raise GatewayClientError(f"Gateway status failed ({status_code}): {detail}")
        if not isinstance(response_json, dict):
            raise GatewayClientError("Gateway status failed: response is not valid JSON")
        return response_json

    def get_result(self, job_id: str) -> dict:
        """
        Legacy compat: fetch result payload for historical rows with task_id.
        Tries common gateway result endpoint variants.
        """
        endpoints = (
            f"/api/result/{job_id}",
            f"/api/results/{job_id}",
            f"/api/status/{job_id}?include_result=true",
            f"/api/status/{job_id}?result=true",
        )
        last_detail = "Unknown gateway result error"
        for endpoint in endpoints:
            status_code, response_json, detail = self._request_json(method="GET", path=endpoint)
            if status_code < 400:
                if isinstance(response_json, dict):
                    return response_json
                raise GatewayClientError("Gateway result response is not valid JSON")
            last_detail = detail or last_detail
        raise GatewayClientError(f"Gateway result failed: {last_detail}")
