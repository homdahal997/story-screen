"""Core infrastructure: settings, Mongo, auth, object storage, media tokens."""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

import bcrypt
import jwt
import requests
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import InvalidTokenError
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.getenv("DB_NAME", "frame_studio")
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ISSUER = os.getenv("JWT_ISSUER", "frame-studio")
TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "43200"))
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
REPLICATE_API_TOKEN = os.getenv("REPLICATE_API_TOKEN", "").strip()
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()

# Public base URL used to build externally reachable media links (for the app
# and for Replicate to fetch start images). Supervisor sets APP_URL.
APP_URL = (os.environ.get("APP_URL") or "").strip().rstrip("/") or \
    "https://302d42b6-c702-4373-86a0-9317c7a8e8ed.preview.emergentagent.com"

# ---------------------------------------------------------------------------
# Mongo
# ---------------------------------------------------------------------------
_client = AsyncIOMotorClient(MONGO_URL)
db = _client[DB_NAME]


async def init_indexes():
    await db.users.create_index("email", unique=True)
    await db.projects.create_index("owner_id")
    await db.episodes.create_index([("project_id", 1), ("episode_number", 1)])


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex


def new_seed() -> int:
    import random
    return random.randint(100000, 999999)


# ---------------------------------------------------------------------------
# Passwords + JWT
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("ascii"))
    except (ValueError, UnicodeError):
        return False


DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt(rounds=12)).decode("ascii")


def make_access_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iss": JWT_ISSUER,
        "scope": "access",
        "iat": now,
        "exp": now + timedelta(minutes=TOKEN_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def make_media_token(path: str, hours: int = 12) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "path": path,
        "scope": "media",
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": now + timedelta(hours=hours),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_media_token(token: str, path: str) -> bool:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], issuer=JWT_ISSUER,
                             options={"require": ["exp", "path", "scope"]})
    except InvalidTokenError:
        return False
    return payload.get("scope") == "media" and payload.get("path") == path


def media_url(path: str) -> str:
    return f"{APP_URL}/api/files/{path}?token={make_media_token(path)}"


bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer)],
) -> dict:
    unauthenticated = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired session",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthenticated
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"],
                             issuer=JWT_ISSUER, options={"require": ["exp", "sub", "iss"]})
        if payload.get("scope") != "access":
            raise InvalidTokenError("wrong scope")
        user_id = payload["sub"]
    except (InvalidTokenError, KeyError, TypeError):
        raise unauthenticated
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise unauthenticated
    return user


CurrentUser = Annotated[dict, Depends(get_current_user)]

# ---------------------------------------------------------------------------
# Emergent Object Storage
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or \
    "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "frame-studio"
_storage_key: Optional[str] = None


def _init_storage() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put_object(path: str, data: bytes, content_type: str) -> dict:
    global _storage_key
    key = _init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type},
                        data=data, timeout=180)
    if resp.status_code == 503:  # stale key, reset + retry once
        _storage_key = None
        key = _init_storage()
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key, "Content-Type": content_type},
                            data=data, timeout=180)
    resp.raise_for_status()
    return resp.json()


def _get_object(path: str) -> tuple[bytes, str]:
    global _storage_key
    key = _init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key}, timeout=120)
    if resp.status_code == 503:
        _storage_key = None
        key = _init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}",
                            headers={"X-Storage-Key": key}, timeout=120)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def store_bytes(user_id: str, data: bytes, ext: str, content_type: str) -> str:
    """Upload bytes to object storage; return the storage path."""
    path = f"{APP_NAME}/uploads/{user_id}/{new_id()}.{ext}"
    await run_in_threadpool(_put_object, path, data, content_type)
    return path


async def load_bytes(path: str) -> tuple[bytes, str]:
    return await run_in_threadpool(_get_object, path)
