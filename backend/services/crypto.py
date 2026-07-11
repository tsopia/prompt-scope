"""第三方 provider api_key 落库加密（encryption at rest）。

威胁模型：防的是数据库文件/备份/dump/SQL 注入泄露；宿主机或进程环境被攻破不在防护范围内
（此时攻击者可直接读取环境变量或密钥文件，与明文等价）——这一点在此如实说明，不做过度承诺。

我们自己的接入 ApiKey 是 sha256 单向哈希（正确、不可逆，不需要也不应该解密），与本模块无关，
本模块只处理第三方 provider（如 DeepSeek）的可逆密钥，因为出站调用需要用到明文 key。
"""
import logging
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

_ENC_PREFIX = "enc:"
_ENV_KEY = "PROMPTSCOPE_ENCRYPTION_KEY"
_KEY_FILE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db", ".encryption_key")


def _load_or_create_key_file() -> bytes:
    if os.path.exists(_KEY_FILE_PATH):
        with open(_KEY_FILE_PATH, "rb") as f:
            return f.read().strip()
    key = Fernet.generate_key()
    os.makedirs(os.path.dirname(_KEY_FILE_PATH), exist_ok=True)
    fd = os.open(_KEY_FILE_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    logging.warning(
        "%s 未设置，已自动生成加密密钥文件 %s；生产环境请显式设置该环境变量，"
        "密钥文件与数据库同机存放不提供额外防护", _ENV_KEY, _KEY_FILE_PATH)
    return key


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    env_key = os.environ.get(_ENV_KEY)
    if env_key:
        return Fernet(env_key.encode())
    return Fernet(_load_or_create_key_file())


def encrypt_secret(raw: str) -> str:
    """加密落库；空字符串（表示未设置）原样透传。"""
    if not raw:
        return raw
    return _ENC_PREFIX + _fernet().encrypt(raw.encode()).decode()


def decrypt_secret(stored: str) -> str:
    """解密读出；非 enc: 前缀视为迁移窗口期内的历史明文，原样返回；空字符串原样透传。"""
    if not stored:
        return stored
    if not stored.startswith(_ENC_PREFIX):
        return stored
    token = stored[len(_ENC_PREFIX):]
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise RuntimeError(
            f"provider api_key 解密失败：{_ENV_KEY} 与加密时使用的密钥不一致") from e


def is_encrypted(stored: str) -> bool:
    return bool(stored) and stored.startswith(_ENC_PREFIX)


def migrate_plaintext_provider_keys(db) -> int:
    """启动期迁移：扫描历史明文 provider.api_key 并原地加密。天然幂等
    （已加密的行 is_encrypted() 为真，直接跳过）。"""
    from models.entities import ModelProvider

    count = 0
    for p in db.query(ModelProvider).all():
        if p.api_key and not is_encrypted(p.api_key):
            p.api_key = encrypt_secret(p.api_key)
            count += 1
    if count:
        db.commit()
    return count
