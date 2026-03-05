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
