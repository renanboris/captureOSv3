"""Authentication dependency for CaptureOS v3 data routes.

Production hardening (Task 14.2 / design Property 1, requirement 2.2). Every data
route requires a valid bearer JWT; a missing, malformed, badly-signed, or expired
credential yields ``401 Unauthorized`` *before* the route handler runs, so no
pipeline/IO side effect is ever triggered for an unauthenticated caller.

Tokens are HS256-signed against ``settings.jwt_secret``. This is the same scheme
Supabase uses to sign its access tokens (the project JWT secret backs
``supabase_url`` / ``supabase_anon_key``), and the scheme the test ``jwt_factory``
in ``tests/conftest.py`` mints. Verification is implemented with the Python
standard library so it adds no runtime dependency and stays byte-for-byte
consistent with the token shape used across the suite.

This module deliberately does NOT reuse ``capture/auth.py`` (the legacy Playwright
auto-login removed with the dead browser-automation code in task 13.2).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config.settings import get_settings


class InvalidTokenError(Exception):
    """Raised when a bearer token fails structural or cryptographic validation."""


def _b64url_decode(segment: str) -> bytes:
    """Base64url-decode a JWT segment, restoring any stripped ``=`` padding."""
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def decode_and_verify_jwt(token: str, secret: str) -> Dict[str, Any]:
    """Validate an HS256 JWT against ``secret`` and return its claims.

    Verifies token structure, the ``HS256`` algorithm, the HMAC-SHA256 signature,
    and the ``exp`` expiry. Raises :class:`InvalidTokenError` on any failure. The
    encoding mirrors ``tests/conftest.py``'s ``_encode_hs256`` so tokens minted by
    the ``jwt_factory`` fixture validate here.
    """
    if not token or token.count(".") != 2:
        raise InvalidTokenError("malformed token")

    header_b64, payload_b64, signature_b64 = token.split(".")
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")

    try:
        header = json.loads(_b64url_decode(header_b64))
        payload = json.loads(_b64url_decode(payload_b64))
        actual_sig = _b64url_decode(signature_b64)
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InvalidTokenError("undecodable token") from exc

    if not isinstance(header, dict) or header.get("alg") != "HS256":
        raise InvalidTokenError("unsupported or missing algorithm")

    if not isinstance(payload, dict):
        raise InvalidTokenError("invalid payload")

    expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected_sig, actual_sig):
        raise InvalidTokenError("signature mismatch")

    exp = payload.get("exp")
    if exp is not None:
        try:
            if int(time.time()) >= int(exp):
                raise InvalidTokenError("token expired")
        except (TypeError, ValueError) as exc:
            raise InvalidTokenError("invalid exp claim") from exc

    return payload


# ``auto_error=False`` so a *missing* Authorization header surfaces as ``None``
# here (instead of FastAPI's default ``403``), letting us return a uniform
# ``401`` for every flavour of "not authenticated".
_bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Dict[str, Any]:
    """FastAPI dependency enforcing a valid bearer JWT on data routes.

    Returns the decoded claims on success; raises ``401 Unauthorized`` for
    missing, malformed, wrongly-signed, or expired credentials.
    """
    import logging
    _log = logging.getLogger("uvicorn.error")

    if credentials is None:
        _log.error("[AUTH DEBUG] Nenhuma credencial recebida (header Authorization ausente).")
        raise _unauthorized()
    if (credentials.scheme or "").lower() != "bearer":
        _log.error(f"[AUTH DEBUG] Scheme inesperado: {credentials.scheme!r}")
        raise _unauthorized()

    secret = get_settings().jwt_secret or ""
    _log.error(f"[AUTH DEBUG] Token recebido (primeiros 30): {credentials.credentials[:30]!r}... | secret usado (primeiros 10): {secret[:10]!r}")
    try:
        claims = decode_and_verify_jwt(credentials.credentials, secret)
        _log.error(f"[AUTH DEBUG] Token VÁLIDO. sub={claims.get('sub')!r}")
        return claims
    except InvalidTokenError as e:
        _log.error(f"[AUTH DEBUG] Token INVÁLIDO: {e}")
        raise _unauthorized()
