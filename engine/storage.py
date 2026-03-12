"""
Script file storage: local STORAGE_ROOT or DigitalOcean Spaces (when DO_* env vars are set).
Path convention: {user_id}/{project_id}/{script_id}/script.pdf
"""
import os
import shutil
from pathlib import Path
from typing import BinaryIO, Optional, Tuple

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
        content_type = resp.get("ContentType") or "application/pdf"
        return (body, content_type)
    except Exception:
        return None


def get_storage_file(relative_path: str) -> Optional[Tuple[bytes, str]]:
    """
    Return (body, content_type) for moodboard/ or objects/ keys.
    For local: read from STORAGE_ROOT. For Spaces: use S3 get_object.
    """
    if not relative_path or ".." in relative_path:
        return None
    if not relative_path.startswith(("moodboard/", "objects/")):
        return None
    if uses_spaces():
        return get_script_file_stream(relative_path)
    path = STORAGE_ROOT / relative_path
    if not path.is_file():
        return None
    try:
        body = path.read_bytes()
        ext = path.suffix.lower()
        content_type = "image/png" if ext == ".png" else "image/jpeg"
        if ext in (".gif", ".webp"):
            content_type = f"image/{ext[1:]}"
        return (body, content_type)
    except Exception:
        return None


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


# Moodboard image storage: moodboard/{user_id}/{tram_line_id}/{filename}
def moodboard_relative_path(user_id: str, tram_line_id: str, filename: str) -> str:
    return f"moodboard/{user_id}/{tram_line_id}/{filename}"


def save_moodboard_image(
    user_id: str, tram_line_id: str, filename: str, content: BinaryIO, size: int
) -> str:
    """Save moodboard image to storage. Returns relative path (key) for DB."""
    if size > MAX_UPLOAD_BYTES:
        raise ValueError(f"File size exceeds {MAX_UPLOAD_BYTES} bytes")
    key = moodboard_relative_path(user_id, tram_line_id, filename)
    if uses_spaces():
        body = content.read() if hasattr(content, "read") else content
        content_type = "image/png" if filename.lower().endswith(".png") else "image/jpeg"
        if not filename.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
            content_type = "application/octet-stream"
        client = _spaces_client()
        client.put_object(
            Bucket=DO_SPACES_BUCKET,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
        return key
    d = STORAGE_ROOT / "moodboard" / user_id / tram_line_id
    d.mkdir(parents=True, exist_ok=True)
    path = d / filename
    with open(path, "wb") as f:
        shutil.copyfileobj(content, f)
    return key


# Character/object image storage: objects/{user_id}/{objects|scenes}/{character_id}.{ext}
def character_image_relative_path(user_id: str, character_id: str, filename: str, is_scene: bool = False) -> str:
    subdir = "scenes" if is_scene else "objects"
    return f"objects/{user_id}/{subdir}/{filename}"


def save_character_image(
    user_id: str, character_id: str, filename: str, content: BinaryIO, size: int, is_scene: bool = False
) -> str:
    """Save character/object image. Returns relative path (key) for DB character_image_url."""
    if size > MAX_UPLOAD_BYTES:
        raise ValueError(f"File size exceeds {MAX_UPLOAD_BYTES} bytes")
    key = character_image_relative_path(user_id, character_id, filename, is_scene)
    if uses_spaces():
        body = content.read() if hasattr(content, "read") else content
        content_type = "image/png" if filename.lower().endswith(".png") else "image/jpeg"
        if not filename.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
            content_type = "application/octet-stream"
        client = _spaces_client()
        client.put_object(
            Bucket=DO_SPACES_BUCKET,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
        return key
    subdir = "scenes" if is_scene else "objects"
    d = STORAGE_ROOT / "objects" / user_id / subdir
    d.mkdir(parents=True, exist_ok=True)
    path = d / filename
    with open(path, "wb") as f:
        shutil.copyfileobj(content, f)
    return key
