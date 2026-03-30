from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from jose import JWTError, jwt
from pydantic import BaseModel

from app.config import settings
from app.dependencies import require_auth

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    if body.username != settings.auth_username or body.password != settings.auth_password:
        print(body.username, settings.auth_username)
        print(body.password, settings.auth_password)
        raise HTTPException(status_code=401, detail="Invalid username or password")

    expire = datetime.utcnow() + timedelta(hours=settings.jwt_expire_hours)
    token = jwt.encode(
        {"sub": body.username, "exp": expire},
        settings.jwt_secret,
        algorithm="HS256",
    )
    return TokenResponse(access_token=token)


@router.get("/auth/me")
async def me(username: str = Depends(require_auth)):
    return {"username": username}
