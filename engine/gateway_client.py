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

    def get_object_image_models(self) -> list[dict]:
        """
        Return usageflows image model choices for profile defaults.
        Preferred: dedicated gateway endpoint with allowlisted FAL image models.
        Fallback: filter generic /api/models response for known FAL-style ids.
        """
        try:
            status_code, data, _ = self._request_json(method="GET", path="/api/media/models")
            if status_code == 200 and isinstance(data, dict):
                models = data.get("models")
                if isinstance(models, list):
                    compact = []
                    for model in models:
                        model_id = model.get("id")
                        if not isinstance(model_id, str) or not model_id.strip():
                            continue
                        compact.append(
                            {
                                "id": model_id.strip(),
                                "name": model.get("name") or model_id.strip(),
                                "provider": model.get("provider") or "fal",
                                "media_type_support": model.get("media_type_support") or [],
                                "default_for_media_type": model.get("default_for_media_type"),
                            }
                        )
                    return compact
        except Exception:
            pass

        allowlist = {
            "fal-ai/flux/schnell",
            "fal-ai/flux/dev",
            "fal-ai/flux-pro",
            "fal-ai/flux-pro/v1.1-ultra",
            "fal-ai/flux-2-pro",
            "fal-ai/flux-lora",
            "fal-ai/nano-banana-2",
            "fal-ai/nano-banana-pro",
            "fal-ai/nano-banana",
            "fal-ai/imagen4/preview",
            "fal-ai/gpt-image-1.5",
            "fal-ai/gpt-image-1.5/edit",
            "fal-ai/recraft/v3/text-to-image",
            "fal-ai/ideogram/v3",
            "fal-ai/seedream-v45",
            "fal-ai/stable-diffusion-v35-medium",
            "xai/grok-imagine-image",
            "fal-ai/sana",
        }
        # Fallback for older gateway versions without /api/media/models.
        fallback = []
        for model in self.get_models():
            model_id = (model.get("id") or "").strip()
            if not model_id:
                continue
            if model_id in allowlist:
                fallback.append(
                    {
                        "id": model_id,
                        "name": model.get("name") or model_id,
                        "provider": model.get("provider") or "fal",
                        "media_type_support": ["image-generation"],
                        "default_for_media_type": None,
                    }
                )
        if fallback:
            return fallback

        # Final fallback: curated text-to-image models for profile dropdown.
        # Keep this list conservative and aligned to currently preferred models.
        return [
            {"id": "fal-ai/flux/schnell", "name": "FLUX Schnell", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": "image-generation"},
            {"id": "fal-ai/flux/dev", "name": "FLUX Dev", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/flux-pro", "name": "FLUX.1 Pro", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/flux-pro/v1.1-ultra", "name": "FLUX 1.1 Pro Ultra", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/flux-2-pro", "name": "FLUX.2 Pro", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/flux-lora", "name": "FLUX LoRA", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/nano-banana-2", "name": "Nano Banana 2", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/nano-banana-pro", "name": "Nano Banana Pro", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/nano-banana", "name": "Nano Banana", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/imagen4/preview", "name": "Imagen 4 Preview", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/gpt-image-1.5", "name": "GPT Image 1.5", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/gpt-image-1.5/edit", "name": "GPT Image 1.5 (Edit)", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/recraft/v3/text-to-image", "name": "Recraft V3", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/ideogram/v3", "name": "Ideogram V3", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/seedream-v45", "name": "Seedream 4.5", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/stable-diffusion-v35-medium", "name": "Stable Diffusion 3.5 Medium", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "xai/grok-imagine-image", "name": "Grok Imagine Image", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
            {"id": "fal-ai/sana", "name": "Sana", "provider": "fal", "media_type_support": ["image-generation"], "default_for_media_type": None},
        ]

    def get_visualize_video_models(self) -> list[dict]:
        """
        Return usageflows video model choices for profile defaults.
        Preferred: dedicated gateway endpoint with allowlisted FAL video models.
        Fallback: filter generic /api/models response for known video-capable ids.
        """
        try:
            status_code, data, _ = self._request_json(
                method="GET",
                path="/api/media/models?media_type=video-generation",
            )
            if status_code == 200 and isinstance(data, dict):
                models = data.get("models")
                if isinstance(models, list):
                    compact = []
                    for model in models:
                        model_id = model.get("id")
                        if not isinstance(model_id, str) or not model_id.strip():
                            continue
                        compact.append(
                            {
                                "id": model_id.strip(),
                                "name": model.get("name") or model_id.strip(),
                                "provider": model.get("provider") or "fal",
                                "media_type_support": model.get("media_type_support") or [],
                                "default_for_media_type": model.get("default_for_media_type"),
                            }
                        )
                    return compact
        except Exception:
            pass

        fallback = []
        for model in self.get_models():
            model_id = (model.get("id") or "").strip()
            if not model_id:
                continue
            lowered = model_id.lower()
            if "kling-video" in lowered or "runway" in lowered or "luma-dream-machine" in lowered:
                fallback.append(
                    {
                        "id": model_id,
                        "name": model.get("name") or model_id,
                        "provider": model.get("provider") or "fal",
                        "media_type_support": ["video-generation", "image-to-video"],
                        "default_for_media_type": None,
                    }
                )
        if fallback:
            return fallback

        return [
            {
                "id": "fal-ai/minimax/hailuo-02/standard/image-to-video",
                "name": "MiniMax Hailuo-02",
                "provider": "fal",
                "media_type_support": ["image-to-video"],
                "default_for_media_type": "image-to-video",
            },
            {
                "id": "fal-ai/veo3/image-to-video",
                "name": "Google Veo 3",
                "provider": "fal",
                "media_type_support": ["image-to-video"],
                "default_for_media_type": None,
            },
            {
                "id": "fal-ai/veo3.1/image-to-video",
                "name": "Google Veo 3.1",
                "provider": "fal",
                "media_type_support": ["image-to-video"],
                "default_for_media_type": None,
            },
            {
                "id": "wan/v2.6/image-to-video",
                "name": "Wan v2.6",
                "provider": "fal",
                "media_type_support": ["image-to-video"],
                "default_for_media_type": None,
            },
            {
                "id": "fal-ai/wan-i2v",
                "name": "Wan 2.1",
                "provider": "fal",
                "media_type_support": ["image-to-video"],
                "default_for_media_type": None,
            },
            {
                "id": "fal-ai/kling-video/v2.5/turbo-pro/image-to-video",
                "name": "Kling 2.5 Turbo Pro",
                "provider": "fal",
                "media_type_support": ["image-to-video"],
                "default_for_media_type": None,
            },
            {
                "id": "fal-ai/kling-video/v3/pro/image-to-video",
                "name": "Kling 3.0 Pro",
                "provider": "fal",
                "media_type_support": ["image-to-video"],
                "default_for_media_type": None,
            },
            {
                "id": "xai/grok-imagine-video/image-to-video",
                "name": "Grok Imagine Video",
                "provider": "fal",
                "media_type_support": ["image-to-video"],
                "default_for_media_type": None,
            },
        ]

    def get_sound_music_models(self) -> list[dict]:
        """
        Return usageflows sound/music model choices for profile defaults.
        Preferred: dedicated gateway endpoint with allowlisted FAL audio models.
        Fallback: filter generic /api/models response for known audio ids.
        """
        try:
            status_code, data, _ = self._request_json(
                method="GET",
                path="/api/media/models?media_type=audio-generation",
            )
            if status_code == 200 and isinstance(data, dict):
                models = data.get("models")
                if isinstance(models, list):
                    compact = []
                    for model in models:
                        model_id = model.get("id")
                        if not isinstance(model_id, str) or not model_id.strip():
                            continue
                        compact.append(
                            {
                                "id": model_id.strip(),
                                "name": model.get("name") or model_id.strip(),
                                "provider": model.get("provider") or "fal",
                                "media_type_support": model.get("media_type_support") or [],
                                "default_for_media_type": model.get("default_for_media_type"),
                            }
                        )
                    return compact
        except Exception:
            pass

        fallback = []
        for model in self.get_models():
            model_id = (model.get("id") or "").strip()
            if not model_id:
                continue
            lowered = model_id.lower()
            if "stable-audio" in lowered or "audio" in lowered or "music" in lowered:
                fallback.append(
                    {
                        "id": model_id,
                        "name": model.get("name") or model_id,
                        "provider": model.get("provider") or "fal",
                        "media_type_support": ["audio-generation"],
                        "default_for_media_type": None,
                    }
                )
        if fallback:
            return fallback

        return [
            {
                "id": "fal-ai/stable-audio",
                "name": "Stable Audio",
                "provider": "fal",
                "media_type_support": ["audio-generation"],
                "default_for_media_type": "audio-generation",
            },
        ]

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

        status_code, response_json, detail = self._request_json(
            method="POST",
            path="/api/execute",
            json_body=body,
        )
        if status_code >= 400:
            raise GatewayClientError(f"Gateway execute failed ({status_code}): {detail}")
        if not isinstance(response_json, dict):
            raise GatewayClientError("Gateway execute failed: response is not valid JSON")
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
        return response_json

    def get_status(self, job_id: str) -> dict:
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
        Fetch final result payload for completed jobs.
        Gateways vary by route naming, so try common variants.
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
