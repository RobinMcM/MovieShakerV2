import base64
from typing import Any, Optional

import httpx


class MediaHandlerClientError(Exception):
    pass


class MediaHandlerClient:
    def __init__(self, base_url: str, api_key: str, timeout_seconds: float = 60, verify_tls: bool = False):
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = (api_key or "").strip()
        self.timeout_seconds = timeout_seconds
        self.verify_tls = verify_tls

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise MediaHandlerClientError("Media-handler API key is missing")
        return {
            "Content-Type": "application/json",
            "X-Internal-API-Key": self.api_key,
        }

    def health(self) -> bool:
        if not self.base_url:
            return False
        try:
            with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
                response = client.get(f"{self.base_url}/health")
                if response.status_code != 200:
                    return False
                body = response.json()
                return body.get("status") == "healthy"
        except Exception:
            return False

    def _post_json(self, path: str, body: dict[str, Any]) -> httpx.Response:
        if not self.base_url:
            raise MediaHandlerClientError("Media-handler base URL is not configured")
        with httpx.Client(timeout=self.timeout_seconds, verify=self.verify_tls) as client:
            response = client.post(
                f"{self.base_url}{path}",
                json=body,
                headers=self._headers(),
            )
        if response.status_code >= 400:
            detail = response.text
            try:
                payload = response.json()
                detail = payload.get("message") or payload.get("detail") or detail
            except Exception:
                pass
            raise MediaHandlerClientError(f"Media-handler request failed: {detail}")
        return response

    @staticmethod
    def _extract_first_string(data: dict[str, Any], keys: tuple[str, ...]) -> Optional[str]:
        for key in keys:
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def extract_last_frame(self, video_url: str) -> dict[str, Optional[str]]:
        """
        Attempt to extract the final frame from a source video URL.
        Returns one of:
        - image_url (http or api/storage URL)
        - image_data_url (data:image/... base64)
        """
        if not video_url or not video_url.strip():
            raise MediaHandlerClientError("Source video URL is required")

        trimmed = video_url.strip()
        attempts: list[tuple[str, dict[str, Any]]] = [
            ("/api/ffmpeg/extract-last-frame", {"video_url": trimmed}),
            ("/api/ffmpeg/extract_frame", {"video_url": trimmed, "position": "last"}),
            ("/api/ffmpeg/last-frame", {"video_url": trimmed}),
        ]

        last_error: Optional[str] = None
        for path, payload in attempts:
            try:
                response = self._post_json(path, payload)
            except MediaHandlerClientError as exc:
                last_error = str(exc)
                continue

            content_type = (response.headers.get("content-type") or "").lower()
            if "application/json" in content_type:
                data = response.json() if response.content else {}
                if not isinstance(data, dict):
                    continue
                image_url = self._extract_first_string(data, ("image_url", "frame_url", "url", "output_url"))
                image_data_url = self._extract_first_string(data, ("image_data_url", "data_url"))
                if image_url or image_data_url:
                    return {"image_url": image_url, "image_data_url": image_data_url}
                continue

            if content_type.startswith("image/") and response.content:
                b64 = base64.b64encode(response.content).decode("ascii")
                return {"image_url": None, "image_data_url": f"data:{content_type};base64,{b64}"}

        raise MediaHandlerClientError(last_error or "Media-handler did not return a frame image")

    def stitch_videos(self, video_urls: list[str], aspect_ratio: str = "16:9") -> dict[str, Any]:
        if len(video_urls) < 2:
            raise MediaHandlerClientError("At least two videos are required for stitching")
        payload = {
            "video_urls": video_urls,
            "aspect_ratio": aspect_ratio,
        }
        response = self._post_json("/api/ffmpeg/concat_spaces", payload)
        if not response.content:
            return {"success": True}
        try:
            data = response.json()
            if isinstance(data, dict):
                return data
        except Exception:
            pass
        return {"success": True}
