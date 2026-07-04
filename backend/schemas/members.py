from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr


class MemberOut(BaseModel):
    user_id: str
    email: str
    display_name: str
    role: Literal["owner", "member"]
    created_at: datetime


class MemberAddIn(BaseModel):
    email: EmailStr
