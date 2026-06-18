from apscheduler.schedulers.background import BackgroundScheduler
from services.candidate_service import sync_candidates_from_langfuse
import logging

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()


def start_sync_scheduler(interval_minutes: int = 5):
    """启动定时同步任务"""
    scheduler.add_job(
        lambda: sync_candidates_from_langfuse_sync(),
        'interval',
        minutes=interval_minutes,
        id='langfuse_sync',
        replace_existing=True
    )
    scheduler.start()
    logger.info(f"Sync scheduler started with interval {interval_minutes} minutes")


def sync_candidates_from_langfuse_sync():
    """同步包装函数（用于 APScheduler）"""
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        count = loop.run_until_complete(sync_candidates_from_langfuse())
        logger.info(f"Synced {count} candidates from Langfuse")
    except Exception as e:
        logger.error(f"Sync failed: {e}")


def stop_sync_scheduler():
    """停止定时同步任务"""
    scheduler.shutdown()
