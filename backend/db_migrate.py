"""Additive schema evolution: create_all 只建缺失表，不加缺失列；此模块补齐。"""
from sqlalchemy import inspect, text

from db import Base, engine
import models.entities  # noqa: F401  ensure metadata is populated


def ensure_columns(bind=None) -> None:
    bind = bind or engine
    insp = inspect(bind)
    with bind.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                if not col.nullable and col.server_default is None and col.default is None:
                    raise RuntimeError(
                        f"ensure_columns 只支持可空或带默认值的新列: "
                        f"{table.name}.{col.name} 是 NOT NULL 且无默认值，需要手写迁移")
                col_type = col.type.compile(bind.dialect)
                conn.execute(text(
                    f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col_type}'))
