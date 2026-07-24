import os
import asyncio
import logging
from typing import Dict, List, Callable, Awaitable
from api.status_manager import update_status

logger = logging.getLogger("uvicorn.error")

# Configuração via env var (fallback 2)
MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_PIPELINE_JOBS", "2"))

class QueueManager:
    def __init__(self, max_concurrent: int = MAX_CONCURRENT_JOBS):
        self.max_concurrent = max_concurrent
        self.queue: List[Dict] = []
        self.running_jobs: Dict[str, asyncio.Task] = {}
        self.lock = asyncio.Lock()
        logger.info(f"[QueueManager] Inicializado com limite de {self.max_concurrent} jobs simultâneos (Fila em memória).")

    async def enqueue(self, session_id: str, job_func: Callable[[], Awaitable[None]]):
        async with self.lock:
            # Se já está rodando ou na fila, ignora duplicação
            if session_id in self.running_jobs or any(j["session_id"] == session_id for j in self.queue):
                logger.info(f"[QueueManager] Sessão {session_id} já está enfileirada ou em execução.")
                return

            if len(self.running_jobs) < self.max_concurrent:
                # Executa imediatamente
                task = asyncio.create_task(self._run_job(session_id, job_func))
                self.running_jobs[session_id] = task
                logger.info(f"[QueueManager] Sessão {session_id} iniciou processamento imediato (Rodando: {len(self.running_jobs)}/{self.max_concurrent}).")
            else:
                # Enfileira
                position = len(self.queue) + 1
                self.queue.append({"session_id": session_id, "job_func": job_func})
                update_status(session_id, "queued", f"Aguardando na fila de processamento (Posição {position})...")
                logger.info(f"[QueueManager] Sessão {session_id} colocada na fila na Posição {position}.")

    async def _run_job(self, session_id: str, job_func: Callable[[], Awaitable[None]]):
        try:
            await job_func()
        except Exception as e:
            logger.error(f"[QueueManager] Erro no job da sessão {session_id}: {e}", exc_info=True)
            update_status(session_id, "failed", f"Erro no processamento da fila: {str(e)}")
        finally:
            async with self.lock:
                self.running_jobs.pop(session_id, None)
                logger.info(f"[QueueManager] Sessão {session_id} finalizada. Verificando próxima da fila...")
                await self._process_next()

    async def _process_next(self):
        # Chamado após um job terminar (deve ser chamado dentro do lock)
        while self.queue and len(self.running_jobs) < self.max_concurrent:
            next_job = self.queue.pop(0)
            sid = next_job["session_id"]
            func = next_job["job_func"]
            
            task = asyncio.create_task(self._run_job(sid, func))
            self.running_jobs[sid] = task
            logger.info(f"[QueueManager] Próxima sessão {sid} removida da fila e iniciada!")

        # Atualiza a posição informada no status das sessões restantes na fila
        for idx, item in enumerate(self.queue):
            pos = idx + 1
            update_status(item["session_id"], "queued", f"Aguardando na fila de processamento (Posição {pos})...")

    def get_queue_info(self, session_id: str) -> dict:
        if session_id in self.running_jobs:
            return {"in_queue": False, "is_running": True, "position": 0}
        for idx, item in enumerate(self.queue):
            if item["session_id"] == session_id:
                return {"in_queue": True, "is_running": False, "position": idx + 1, "total_queue": len(self.queue)}
        return {"in_queue": False, "is_running": False, "position": 0}

    async def remove_session(self, session_id: str):
        async with self.lock:
            if session_id in self.running_jobs:
                task = self.running_jobs.pop(session_id, None)
                if task and not task.done():
                    task.cancel()
            self.queue = [j for j in self.queue if j["session_id"] != session_id]

# Instância global do Gerenciador de Fila
job_queue = QueueManager()
