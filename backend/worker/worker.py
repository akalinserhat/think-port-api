import asyncio
import json
import logging
import os
import redis.asyncio as redis
from worker.dtos import BrowserJobDTO, RedisStreamEventDTO, WarmSessionConfigDTO
from worker.dom_streamer_service import DomStreamerService
from worker.session_pool import BrowserSessionPool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browser_worker")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


async def seed_initial_warm_sessions(pool: BrowserSessionPool, provider: str, count: int = 2) -> None:
    """Başlangıçta belirtilen sayıda hazır (warm) tarayıcı oturumu oluşturur."""
    for idx in range(count):
        config = WarmSessionConfigDTO(
            session_id=f"sess-{provider}-{idx}",
            provider=provider,
            account_id=f"pool_account_{idx}@example.com",
            storage_state={},
        )
        await pool.create_warm_session_from_dto(config)


async def handle_single_job(
    pool: BrowserSessionPool,
    streamer: DomStreamerService,
    job: BrowserJobDTO,
) -> None:
    """Tek bir tarayıcı işini havuzdan oturum alarak yürütür ve oturumu serbest bırakır."""
    session = None
    try:
        session = await pool.acquire_session(job.provider)
        await streamer.execute_and_stream(session, job)
    except Exception as exc:
        logger.exception(f"Job {job.job_id} işlenirken hata oluştu: {exc}")
        await streamer.publish_event(
            f"stream:{job.job_id}",
            RedisStreamEventDTO(event="error", message=str(exc)),
        )
    finally:
        if session:
            await pool.release_session(session)


async def worker_loop(provider: str = "chatgpt-web") -> None:
    """Redis iş kuyruğunu dinleyen ve gelen görevleri paralel dağıtan ana işçi döngüsü."""
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    streamer = DomStreamerService(redis_client)
    pool = BrowserSessionPool(max_sessions=5)
    await pool.start()

    await seed_initial_warm_sessions(pool, provider, count=2)
    asyncio.create_task(pool.keep_alive_loop(interval_sec=300))

    queue_key = f"queue:browser_jobs:{provider}"
    logger.info(f"Worker kuyruğu dinliyor: {queue_key}")

    while True:
        item = await redis_client.blpop(queue_key, timeout=30)
        if not item:
            continue

        _, raw_job = item
        job = BrowserJobDTO.from_raw_dict(json.loads(raw_job))
        asyncio.create_task(handle_single_job(pool, streamer, job))


if __name__ == "__main__":
    asyncio.run(worker_loop("chatgpt-web"))
