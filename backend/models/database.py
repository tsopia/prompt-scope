import sqlite3
import os
from datetime import datetime
from typing import Optional, List, Dict, Any

DB_PATH = os.getenv("DATABASE_URL", "sqlite:///./db/promptscope.db").replace("sqlite:///", "")


def get_db():
    """获取数据库连接"""
    # 确保目录存在
    os.makedirs(os.path.dirname(DB_PATH) if os.path.dirname(DB_PATH) else ".", exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """初始化数据库表"""
    conn = get_db()
    cursor = conn.cursor()

    # Candidates 缓存表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        experiment_id TEXT,
        input TEXT,
        prompt_id TEXT,
        prompt_version INTEGER,
        model TEXT,
        output TEXT,
        cost REAL,
        latency REAL,
        score REAL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Compare results 表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS compare_results (
        id TEXT PRIMARY KEY,
        candidate_a TEXT,
        candidate_b TEXT,
        replaceable BOOLEAN,
        score_a REAL,
        score_b REAL,
        cost_diff REAL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Sync status 表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sync_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_sync TIMESTAMP,
        count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'idle'
    )
    """)

    cursor.execute("INSERT OR IGNORE INTO sync_status (id) VALUES (1)")

    conn.commit()
    conn.close()


def save_candidates(candidates: List[Dict[str, Any]]):
    """保存 candidates 到数据库"""
    conn = get_db()
    cursor = conn.cursor()

    for c in candidates:
        cursor.execute("""
        INSERT OR REPLACE INTO candidates
        (id, experiment_id, input, prompt_id, prompt_version, model, output, cost, latency, score, input_tokens, output_tokens, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            c["id"], c["experiment_id"], c["input"], c["prompt_id"],
            c.get("prompt_version"), c["model"], c["output"],
            c["cost"], c["latency"], c.get("score"),
            c.get("input_tokens", 0), c.get("output_tokens", 0),
            c.get("status", "completed")
        ))

    conn.commit()
    conn.close()


def get_candidates() -> List[Dict[str, Any]]:
    """获取所有 candidates"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM candidates ORDER BY created_at DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def save_compare_result(result: Dict[str, Any]) -> str:
    """保存对比结果"""
    import uuid
    result_id = str(uuid.uuid4())
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO compare_results (id, candidate_a, candidate_b, replaceable, score_a, score_b, cost_diff, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        result_id, result["candidate_a"], result["candidate_b"],
        result["replaceable"], result["score_a"], result["score_b"],
        result["cost_diff"], result["reason"]
    ))
    conn.commit()
    conn.close()
    return result_id


def get_compare_result(candidate_a: str, candidate_b: str) -> Optional[Dict[str, Any]]:
    """获取对比结果（支持双向查询）"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT * FROM compare_results
    WHERE (candidate_a = ? AND candidate_b = ?) OR (candidate_a = ? AND candidate_b = ?)
    ORDER BY created_at DESC LIMIT 1
    """, (candidate_a, candidate_b, candidate_b, candidate_a))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def update_sync_status(count: int, status: str):
    """更新同步状态"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE sync_status SET last_sync = ?, count = ?, status = ? WHERE id = 1
    """, (datetime.now().isoformat(), count, status))
    conn.commit()
    conn.close()


def get_sync_status() -> Dict[str, Any]:
    """获取同步状态"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sync_status WHERE id = 1")
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else {"last_sync": None, "count": 0, "status": "idle"}
