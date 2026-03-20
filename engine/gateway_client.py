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

    def get_object_image_models(self) -> list[dict]:
        """
        Return usageflows image model choices for profile defaults.
        Preferred: dedicated gateway endpoint with allowlisted FAL image models.
        Fallback: filter generic /api/models response for known FAL-style ids.
        """
        try:
            with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
                response = client.get(
                    f"{self.base_url}/api/media/models",
                    headers=self._headers(),
                )
                if response.status_code == 200:
                    data = response.json()
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

        # Fallback for older gateway versions without /api/media/models.
        fallback = []
        for model in self.get_models():
            model_id = (model.get("id") or "").strip()
            if not model_id:
                continue
            lowered = model_id.lower()
            if lowered.startswith("fal-ai/") or "flux" in lowered or "kling" in lowered or "luma" in lowered:
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
            {
                "id": "fal-ai/flux/schnell",
                "name": "FLUX Schnell",
                "provider": "fal",
                "media_type_support": ["image-generation"],
                "default_for_media_type": "image-generation",
            },
            {
                "id": "fal-ai/flux/dev",
                "name": "FLUX Dev",
                "provider": "fal",
                "media_type_support": ["image-generation"],
                "default_for_media_type": None,
            },
            {
                "id": "fal-ai/flux-realism",
                "name": "FLUX Realism",
                "provider": "fal",
                "media_type_support": ["image-generation"],
                "default_for_media_type": None,
            },
        ]

    def get_visualize_video_models(self) -> list[dict]:
        """
        Return usageflows video model choices for profile defaults.
        Preferred: dedicated gateway endpoint with allowlisted FAL video models.
        Fallback: filter generic /api/models response for known video-capable ids.
        """
        try:
            with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
                response = client.get(
                    f"{self.base_url}/api/media/models?media_type=video-generation",
                    headers=self._headers(),
                )
                if response.status_code == 200:
                    data = response.json()
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
                "id": "fal-ai/minimax-hailuo-02/image-to-video",
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
            with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
                response = client.get(
                    f"{self.base_url}/api/media/models?media_type=audio-generation",
                    headers=self._headers(),
                )
                if response.status_code == 200:
                    data = response.json()
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
        with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
            response = client.post(
                f"{self.base_url}/api/execute",
                json=body,
                headers=self._headers(),
            )
        if response.status_code >= 400:
            detail = response.text
            try:
                response_body = response.json()
                detail = response_body.get("message") or response_body.get("detail") or detail
            except Exception:
                pass
            raise GatewayClientError(f"Gateway text generation failed: {detail}")
        return response.json()

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
