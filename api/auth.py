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

import json
import time
import threading
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config.settings import get_settings
from supabase import create_client


class InvalidTokenError(Exception):
    """Raised when a bearer token fails structural or cryptographic validation."""


_bearer_scheme = HTTPBearer(auto_error=False)

# Cache em memória para validação de tokens JWT do Supabase (TTL de 60 segundos)
_TOKEN_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
_CACHE_TTL_SECONDS = 60.0
_CACHE_LOCK = threading.Lock()


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_auth(
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

    token = credentials.credentials
    now = time.time()

    # 1. Primeiro check sem lock para alta performance (Fast Path)
    if token in _TOKEN_CACHE:
        cached_time, user_dict = _TOKEN_CACHE[token]
        if now - cached_time < _CACHE_TTL_SECONDS:
            return user_dict

    # 2. Se não está no cache, adquire o lock para evitar que chamadas paralelas batam no Supabase juntas (Cache Stampede Protection)
    with _CACHE_LOCK:
        # Duplo check após adquirir o lock (outro thread pode ter populado o cache enquanto esperávamos)
        if token in _TOKEN_CACHE:
            cached_time, user_dict = _TOKEN_CACHE[token]
            if now - cached_time < _CACHE_TTL_SECONDS:
                return user_dict

        settings = get_settings()
        # Tentar validação local via JWT Secret (para dev-tokens e tokens JWT válidos)
        try:
            import jwt
            payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], options={"verify_aud": False})
            user_dict = {
                "id": payload.get("sub"),
                "email": payload.get("email") or payload.get("user_metadata", {}).get("email", ""),
                "role": payload.get("role", "authenticated")
            }
            _log.debug(f"[AUTH DEBUG] Token JWT VÁLIDO (decodificado via secret local). user_id={user_dict['id']}")
            _TOKEN_CACHE[token] = (now, user_dict)
            return user_dict
        except Exception as jwt_err:
            _log.debug(f"[AUTH DEBUG] Validação local JWT falhou: {jwt_err}, tentando Supabase...")

        if not settings.supabase_url or not settings.supabase_key:
            _log.error("[AUTH DEBUG] Supabase URL/KEY ausentes no .env.")
            raise _unauthorized()
            
        try:
            supabase = create_client(settings.supabase_url, settings.supabase_key)
            # Use Supabase API to validate the token
            res = supabase.auth.get_user(token)
            if not res or not res.user:
                raise InvalidTokenError("Invalid or expired session token")
            
            user_dict = res.user.model_dump() if hasattr(res.user, 'model_dump') else dict(res.user)
            _log.debug(f"[AUTH DEBUG] Token Supabase VÁLIDO (chamada de rede). user_id={res.user.id}")
            
            # Salvar no cache
            _TOKEN_CACHE[token] = (now, user_dict)
            return user_dict
        except Exception as e:
            _log.error(f"[AUTH DEBUG] Token INVÁLIDO ou expirado no Supabase: {e}")
            raise _unauthorized()
