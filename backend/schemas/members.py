from datetime import datetime

from pydantic import BaseModel, EmailStr


class MemberOut(BaseModel):
    user_id: str
    email: str
    display_name: str
    role: str
    created_at: datetime


class MemberAddIn(BaseModel):
    email: EmailStr
