"""
Script file storage: local STORAGE_ROOT or DigitalOcean Spaces (when DO_* env vars are set).
Path convention: {user_id}/{project_id}/{script_id}/script.pdf
"""
import json
import logging
import mimetypes
import os
import shutil
from pathlib import Path
from typing import BinaryIO, Optional, Tuple

logger = logging.getLogger(__name__)

STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "./storage")).resolve()
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB

# DigitalOcean Spaces (S3-compatible)
DO_SPACES_ENDPOINT = os.getenv("DO_SPACES_ENDPOINT", "").strip()
DO_SPACES_REGION = os.getenv("DO_SPACES_REGION", "").strip()
DO_SPACES_BUCKET = os.getenv("DO_SPACES_BUCKET", "").strip()
DO_SPACES_ACCESS_KEY_ID = os.getenv("DO_SPACES_ACCESS_KEY_ID", "").strip()
DO_SPACES_SECRET_ACCESS_KEY = os.getenv("DO_SPACES_SECRET_ACCESS_KEY", "").strip()


def uses_spaces() -> bool:
    """True if DO Spaces is configured (all required env vars set)."""
    return bool(
        DO_SPACES_ENDPOINT
        and DO_SPACES_REGION
        and DO_SPACES_BUCKET
        and DO_SPACES_ACCESS_KEY_ID
        and DO_SPACES_SECRET_ACCESS_KEY
    )


def _spaces_client():
    """Lazy boto3 S3 client for DO Spaces."""
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=DO_SPACES_ENDPOINT,
        region_name=DO_SPACES_REGION,
        aws_access_key_id=DO_SPACES_ACCESS_KEY_ID,
        aws_secret_access_key=DO_SPACES_SECRET_ACCESS_KEY,
        config=Config(signature_version="s3v4"),
    )


def _content_type_from_path(path: str, spaces_content_type: str) -> str:
    """
    Resolve a MIME type for a storage object.
    Prefers the ContentType stored in Spaces unless it is absent or the generic
    'binary/octet-stream' sentinel that Spaces sometimes returns instead of the
    real type.  Falls back to mimetypes.guess_type, then a hard-coded table.
    """
    if spaces_content_type and spaces_content_type != "binary/octet-stream":
        return spaces_content_type
    mime, _ = mimetypes.guess_type(path)
    if mime:
        return mime
    ext = path.lower().rsplit(".", 1)[-1] if "." in path else ""
    defaults = {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
        "pdf": "application/pdf",
        "json": "application/json",
    }
    return defaults.get(ext, "application/octet-stream")


def script_dir(user_id: str, project_id: str, script_id: str) -> Path:
    """Directory for one script's files (local only)."""
    return STORAGE_ROOT / user_id / str(project_id) / str(script_id)


def script_pdf_path(user_id: str, project_id: str, script_id: str) -> Path:
    return script_dir(user_id, project_id, script_id) / "script.pdf"


def script_json_path(user_id: str, project_id: str, script_id: str) -> Path:
    return script_dir(user_id, project_id, script_id) / "script.json"


def relative_file_path(user_id: str, project_id: str, script_id: str, filename: str) -> str:
    """Relative path string for DB (e.g. user_id/project_id/script_id/script.pdf). Same key used in Spaces."""
    return f"{user_id}/{project_id}/{script_id}/{filename}"


def ensure_script_dir(user_id: str, project_id: str, script_id: str) -> Path:
    d = script_dir(user_id, project_id, script_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_script_file(
    user_id: str, project_id: str, script_id: str, filename: str, content: BinaryIO, size: int
) -> None:
    if size > MAX_UPLOAD_BYTES:
        raise ValueError(f"File size exceeds {MAX_UPLOAD_BYTES} bytes")

    if uses_spaces():
        key = relative_file_path(user_id, project_id, script_id, filename)
        body = content.read() if hasattr(content, "read") else content
        client = _spaces_client()
        if filename.lower().endswith(".pdf"):
            content_type = "application/pdf"
        elif filename.lower().endswith(".json"):
            content_type = "application/json"
        else:
            content_type = "application/octet-stream"
        client.put_object(
            Bucket=DO_SPACES_BUCKET,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
        return

    d = ensure_script_dir(user_id, project_id, script_id)
    path = d / filename
    with open(path, "wb") as f:
        shutil.copyfileobj(content, f)


def get_script_file_path(relative_path: str) -> Path:
    """Resolve relative path to full local path. Use only when not using Spaces."""
    return STORAGE_ROOT / relative_path


def get_script_file_stream(relative_path: str) -> Optional[Tuple[bytes, str]]:
    """
    When using Spaces, return (body, content_type) for the object.
    Returns None if not using Spaces or object not found.
    """
    if not uses_spaces():
        return None
    try:
        client = _spaces_client()
        resp = client.get_object(Bucket=DO_SPACES_BUCKET, Key=relative_path)
        body = resp["Body"].read()
        content_type = _content_type_from_path(relative_path, resp.get("ContentType", ""))
        return (body, content_type)
    except Exception as exc:
        logger.error("get_script_file_stream failed for key %r: %s", relative_path, exc)
        return None


def get_storage_file(relative_path: str) -> Optional[Tuple[bytes, str]]:
    """
    Return (body, content_type) for moodboard/object assets.
    For local: read from STORAGE_ROOT. For Spaces: use S3 get_object.
    """
    if not relative_path or ".." in relative_path:
        return None

    # Allowed storage-key patterns:
    # - Legacy: moodboard/{user_id}/..., objects/{user_id}/...
    # - Current: {user_id}/{project_id}/.../moodboard/... or .../objects/...
    is_legacy = relative_path.startswith(("moodboard/", "objects/"))
    is_project_scoped = ("/moodboard/" in relative_path) or ("/objects/" in relative_path)
    if not (is_legacy or is_project_scoped):
        return None
    if uses_spaces():
        return get_script_file_stream(relative_path)
    path = STORAGE_ROOT / relative_path
    if not path.is_file():
        return None
    try:
        body = path.read_bytes()
        ext = path.suffix.lower()
        if ext == ".png":
            content_type = "image/png"
        elif ext in (".jpg", ".jpeg"):
            content_type = "image/jpeg"
        elif ext in (".gif", ".webp"):
            content_type = f"image/{ext[1:]}"
        elif ext == ".mp4":
            content_type = "video/mp4"
        elif ext == ".webm":
            content_type = "video/webm"
        elif ext == ".mov":
            content_type = "video/quicktime"
        else:
            content_type = "application/octet-stream"
        return (body, content_type)
    except Exception:
        return None


def get_storage_access_url(relative_path: str, expires_seconds: int = 3600) -> Optional[str]:
    """
    Return a time-limited URL to access a storage object.
    For Spaces, returns a pre-signed GET URL.
    For local storage, returns None (no anonymous URL available).
    """
    if not relative_path or ".." in relative_path:
        return None
    is_legacy = relative_path.startswith(("moodboard/", "objects/"))
    is_project_scoped = ("/moodboard/" in relative_path) or ("/objects/" in relative_path)
    if not (is_legacy or is_project_scoped):
        return None
    if not uses_spaces():
        return None
    try:
        client = _spaces_client()
        return client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": DO_SPACES_BUCKET, "Key": relative_path},
            ExpiresIn=max(60, int(expires_seconds)),
        )
    except Exception:
        return None


def delete_storage_file(relative_path: str) -> bool:
    """
    Delete a storage object by relative key/path.
    Returns True if a delete call/remove was attempted successfully.
    """
    if not relative_path or ".." in relative_path:
        return False
    if uses_spaces():
        try:
            client = _spaces_client()
            client.delete_object(Bucket=DO_SPACES_BUCKET, Key=relative_path)
            return True
        except Exception:
            return False
    path = STORAGE_ROOT / relative_path
    if not path.exists() or not path.is_file():
        return False
    try:
        path.unlink()
        return True
    except Exception:
        return False


def delete_script_dir(user_id: str, project_id: str, script_id: str) -> None:
    if uses_spaces():
        prefix = f"{user_id}/{project_id}/{script_id}/"
        client = _spaces_client()
        try:
            paginator = client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=DO_SPACES_BUCKET, Prefix=prefix):
                for obj in page.get("Contents") or []:
                    client.delete_object(Bucket=DO_SPACES_BUCKET, Key=obj["Key"])
        except Exception:
            pass
        return

    d = script_dir(user_id, project_id, script_id)
    if d.exists():
        shutil.rmtree(d)


# Moodboard image storage (project-scoped):
# {user_id}/{project_id}/scene/{scene_id}/moodboard/{tram_line_id}/{filename}
def moodboard_relative_path(
    user_id: str,
    project_id: str,
    scene_id: str,
    tram_line_id: str,
    filename: str,
) -> str:
    return f"{user_id}/{project_id}/scene/{scene_id}/moodboard/{tram_line_id}/{filename}"


def save_moodboard_image(
    user_id: str,
    project_id: str,
    scene_id: str,
    tram_line_id: str,
    filename: str,
    content: BinaryIO,
    size: int,
) -> str:
    """Save moodboard image to storage. Returns relative path (key) for DB."""
    if size > MAX_UPLOAD_BYTES:
        raise ValueError(f"File size exceeds {MAX_UPLOAD_BYTES} bytes")
    key = moodboard_relative_path(user_id, project_id, scene_id, tram_line_id, filename)
    if uses_spaces():
        body = content.read() if hasattr(content, "read") else content
        content_type = _content_type_from_path(filename, "")
        client = _spaces_client()
        client.put_object(
            Bucket=DO_SPACES_BUCKET,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
        return key
    d = STORAGE_ROOT / user_id / str(project_id) / "scene" / str(scene_id) / "moodboard" / tram_line_id
    d.mkdir(parents=True, exist_ok=True)
    path = d / filename
    with open(path, "wb") as f:
        shutil.copyfileobj(content, f)
    return key


def moodboard_video_relative_path(
    user_id: str,
    project_id: str,
    scene_id: str,
    tram_line_id: str,
    filename: str,
) -> str:
    """Project-scoped moodboard video key."""
    return f"{user_id}/{project_id}/scene/{scene_id}/moodboard/{tram_line_id}/videos/{filename}"


def save_moodboard_video(
    user_id: str,
    project_id: str,
    scene_id: str,
    tram_line_id: str,
    filename: str,
    content: BinaryIO,
    size: int,
) -> str:
    """Save moodboard video to storage. Returns relative path (key) for DB."""
    if size > MAX_UPLOAD_BYTES:
        raise ValueError(f"File size exceeds {MAX_UPLOAD_BYTES} bytes")
    key = moodboard_video_relative_path(user_id, project_id, scene_id, tram_line_id, filename)
    if uses_spaces():
        body = content.read() if hasattr(content, "read") else content
        lowered = filename.lower()
        if lowered.endswith(".mp4"):
            content_type = "video/mp4"
        elif lowered.endswith(".webm"):
            content_type = "video/webm"
        elif lowered.endswith(".mov"):
            content_type = "video/quicktime"
        else:
            content_type = "application/octet-stream"
        client = _spaces_client()
        client.put_object(
            Bucket=DO_SPACES_BUCKET,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
        return key
    d = STORAGE_ROOT / user_id / str(project_id) / "scene" / str(scene_id) / "moodboard" / tram_line_id / "videos"
    d.mkdir(parents=True, exist_ok=True)
    path = d / filename
    with open(path, "wb") as f:
        shutil.copyfileobj(content, f)
    return key


# Character/object image storage (project-scoped):
# {user_id}/{project_id}/objects/{character_id}.{ext}
# Scene-type assets use: {user_id}/{project_id}/objects/scenes/{character_id}.{ext}
def character_image_relative_path(
    user_id: str, project_id: str, character_id: str, filename: str, is_scene: bool = False
) -> str:
    if is_scene:
        return f"{user_id}/{project_id}/objects/scenes/{filename}"
    return f"{user_id}/{project_id}/objects/{filename}"


# ---------------------------------------------------------------------------
# Rushes storage — {user_id}/{project_id}/rushes/originals/{filename}
#                   {user_id}/{project_id}/rushes/extracts/{filename}
# No size limit (raw camera footage can be many GB).
# ---------------------------------------------------------------------------

def rushes_original_key(user_id: str, project_id: str, filename: str) -> str:
    return f"{user_id}/{project_id}/rushes/originals/{filename}"


def rushes_extract_key(user_id: str, project_id: str, filename: str) -> str:
    return f"{user_id}/{project_id}/rushes/extracts/{filename}"


def rushes_insert_key(user_id: str, project_id: str, filename: str) -> str:
    return f"{user_id}/{project_id}/rushes/inserts/{filename}"


def upload_rushes_file(key: str, file_obj, content_type: str) -> None:
    """Stream-upload a rushes clip to Spaces (boto3 multipart, no size limit)."""
    if uses_spaces():
        client = _spaces_client()
        client.upload_fileobj(
            file_obj,
            DO_SPACES_BUCKET,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        return
    dest = STORAGE_ROOT / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file_obj, f)


def list_rushes_clips(user_id: str, project_id: str) -> list[dict]:
    """Return metadata for all clips under {user_id}/{project_id}/rushes/."""
    prefix = f"{user_id}/{project_id}/rushes/"
    if uses_spaces():
        client = _spaces_client()
        paginator = client.get_paginator("list_objects_v2")
        clips: list[dict] = []
        for page in paginator.paginate(Bucket=DO_SPACES_BUCKET, Prefix=prefix):
            for obj in page.get("Contents") or []:
                k = obj["Key"]
                filename = k.split("/")[-1]
                if not filename or filename.endswith(".json") or "/rushes/inserts/" in k:
                    continue
                modified = obj.get("LastModified")
                clips.append({
                    "key": k,
                    "filename": filename,
                    "size": obj.get("Size", 0),
                    "last_modified": modified.isoformat() if modified else "",
                    "is_extract": "/rushes/extracts/" in k,
                })
        clips.sort(key=lambda c: c["last_modified"], reverse=True)
        return clips
    # local dev fallback
    prefix_path = STORAGE_ROOT / user_id / str(project_id) / "rushes"
    if not prefix_path.exists():
        return []
    clips = []
    for path in sorted(prefix_path.rglob("*")):
        if path.is_file() and not path.name.endswith(".json") and "rushes/inserts" not in str(path):
            k = str(path.relative_to(STORAGE_ROOT)).replace("\\", "/")
            clips.append({
                "key": k,
                "filename": path.name,
                "size": path.stat().st_size,
                "last_modified": "",
                "is_extract": "rushes/extracts" in k,
            })
    return clips


def list_rushes_inserts(user_id: str, project_id: str) -> list[dict]:
    """Return metadata for all images under {user_id}/{project_id}/rushes/inserts/."""
    prefix = f"{user_id}/{project_id}/rushes/inserts/"
    if uses_spaces():
        client = _spaces_client()
        paginator = client.get_paginator("list_objects_v2")
        inserts: list[dict] = []
        for page in paginator.paginate(Bucket=DO_SPACES_BUCKET, Prefix=prefix):
            for obj in page.get("Contents") or []:
                k = obj["Key"]
                filename = k.split("/")[-1]
                if not filename:
                    continue
                modified = obj.get("LastModified")
                inserts.append({
                    "key": k,
                    "filename": filename,
                    "size": obj.get("Size", 0),
                    "last_modified": modified.isoformat() if modified else "",
                })
        inserts.sort(key=lambda i: i["last_modified"], reverse=True)
        return inserts
    # local dev fallback
    prefix_path = STORAGE_ROOT / user_id / str(project_id) / "rushes" / "inserts"
    if not prefix_path.exists():
        return []
    inserts = []
    for path in sorted(prefix_path.rglob("*")):
        if path.is_file():
            k = str(path.relative_to(STORAGE_ROOT)).replace("\\", "/")
            inserts.append({
                "key": k,
                "filename": path.name,
                "size": path.stat().st_size,
                "last_modified": "",
            })
    return inserts


def generate_rushes_url(key: str, expires_seconds: int = 3600) -> Optional[str]:
    """Presigned GET URL for a rushes clip. None if Spaces not configured."""
    if not key or ".." in key or not uses_spaces():
        return None
    try:
        client = _spaces_client()
        return client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": DO_SPACES_BUCKET, "Key": key},
            ExpiresIn=max(60, int(expires_seconds)),
        )
    except Exception:
        return None


def delete_rushes_file(key: str) -> bool:
    """Delete a rushes clip by its Spaces key."""
    if not key or ".." in key:
        return False
    if uses_spaces():
        try:
            client = _spaces_client()
            client.delete_object(Bucket=DO_SPACES_BUCKET, Key=key)
            return True
        except Exception:
            return False
    path = STORAGE_ROOT / key
    if not path.is_file():
        return False
    try:
        path.unlink()
        return True
    except Exception:
        return False


def selects_key(user_id: str, project_id: str) -> str:
    return f"{user_id}/{project_id}/rushes/selects.json"


def read_selects(user_id: str, project_id: str) -> list[dict]:
    key = selects_key(user_id, project_id)
    if uses_spaces():
        try:
            client = _spaces_client()
            resp = client.get_object(Bucket=DO_SPACES_BUCKET, Key=key)
            return json.loads(resp["Body"].read())
        except Exception:
            return []
    path = STORAGE_ROOT / key
    if not path.is_file():
        return []
    try:
        return json.loads(path.read_text())
    except Exception:
        return []


def write_selects(user_id: str, project_id: str, selects: list[dict]) -> None:
    key = selects_key(user_id, project_id)
    body = json.dumps(selects, indent=2).encode()
    if uses_spaces():
        client = _spaces_client()
        client.put_object(
            Bucket=DO_SPACES_BUCKET, Key=key,
            Body=body, ContentType="application/json",
        )
        return
    path = STORAGE_ROOT / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)


def audio_peaks_key(user_id: str, project_id: str) -> str:
    return f"{user_id}/{project_id}/rushes/audio_peaks.json"


def read_audio_peaks(user_id: str, project_id: str) -> dict:
    key = audio_peaks_key(user_id, project_id)
    if uses_spaces():
        try:
            client = _spaces_client()
            resp = client.get_object(Bucket=DO_SPACES_BUCKET, Key=key)
            return json.loads(resp["Body"].read())
        except Exception:
            return {}
    path = STORAGE_ROOT / key
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def write_audio_peaks(user_id: str, project_id: str, peaks_map: dict) -> None:
    key = audio_peaks_key(user_id, project_id)
    body = json.dumps(peaks_map).encode()
    if uses_spaces():
        client = _spaces_client()
        client.put_object(
            Bucket=DO_SPACES_BUCKET, Key=key,
            Body=body, ContentType="application/json",
        )
        return
    path = STORAGE_ROOT / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)


def save_character_image(
    user_id: str,
    project_id: str,
    character_id: str,
    filename: str,
    content: BinaryIO,
    size: int,
    is_scene: bool = False,
) -> str:
    """Save character/object image. Returns relative path (key) for DB character_image_url."""
    if size > MAX_UPLOAD_BYTES:
        raise ValueError(f"File size exceeds {MAX_UPLOAD_BYTES} bytes")
    key = character_image_relative_path(user_id, project_id, character_id, filename, is_scene)
    if uses_spaces():
        body = content.read() if hasattr(content, "read") else content
        content_type = _content_type_from_path(filename, "")
        client = _spaces_client()
        client.put_object(
            Bucket=DO_SPACES_BUCKET,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
        return key
    d = (
        STORAGE_ROOT / user_id / str(project_id) / "objects" / "scenes"
        if is_scene
        else STORAGE_ROOT / user_id / str(project_id) / "objects"
    )
    d.mkdir(parents=True, exist_ok=True)
    path = d / filename
    with open(path, "wb") as f:
        shutil.copyfileobj(content, f)
    return key
