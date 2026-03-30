import base64
from urllib.parse import urlparse
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

    @staticmethod
    def _to_spaces_key(value: str) -> str:
        """
        Convert a DB video path or API storage URL into a Spaces key.
        """
        raw = (value or "").strip()
        if not raw:
            raise MediaHandlerClientError("Empty video path is not allowed for stitching")
        if raw.startswith("data:"):
            raise MediaHandlerClientError("Data URLs are not supported for stitching")

        marker = "/api/storage/"
        marker_idx = raw.find(marker)
        if marker_idx >= 0:
            key = raw[marker_idx + len(marker):].split("?")[0].strip()
            if key:
                return key
            raise MediaHandlerClientError("Invalid /api/storage URL for stitching")

        lowered = raw.lower()
        if lowered.startswith("http://") or lowered.startswith("https://"):
            parsed = urlparse(raw)
            key_from_path = (parsed.path or "").lstrip("/")
            if key_from_path and not key_from_path.endswith("/"):
                return key_from_path
            raise MediaHandlerClientError(
                "Only storage keys or /api/storage URLs can be stitched"
            )

        return raw

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
        spaces_inputs = [{"spaces_key": self._to_spaces_key(item)} for item in video_urls]
        payload = {
            "inputs": spaces_inputs,
        }
        response = self._post_json("/api/ffmpeg/concat_spaces", payload)
        if not response.content:
            return {"success": True}

        content_type = (response.headers.get("content-type") or "").lower()
        if "application/json" in content_type:
            try:
                data = response.json()
                if isinstance(data, dict):
                    return data
            except Exception:
                pass
            return {"success": True}

        if content_type.startswith("video/"):
            return {
                "success": True,
                "content_type": content_type,
                "output_bytes": response.content,
            }

        try:
            data = response.json()
            if isinstance(data, dict):
                return data
        except Exception:
            pass
        return {"success": True}
