import time
import json
import logging
import os
from typing import Dict

logger = logging.getLogger("finops")
logger.setLevel(logging.INFO)

# Preços de referência por 1M tokens (USD). Atualizar manualmente quando o
# provedor mudar tabela — não há verificação automática.
# Fonte: página de pricing oficial de cada provedor.
# Última verificação: 2026-07-07
GEMINI_FLASH_INPUT_PER_1M_USD = 0.075
GEMINI_FLASH_OUTPUT_PER_1M_USD = 0.30
OPENAI_GPT4O_MINI_INPUT_PER_1M_USD = 0.15
OPENAI_GPT4O_MINI_OUTPUT_PER_1M_USD = 0.60
# MINIMAX_*: valor não verificado com o provedor
MINIMAX_INPUT_PER_1M_USD = 0.10
MINIMAX_OUTPUT_PER_1M_USD = 0.10


class FinOpsTracker:
    _jobs: Dict[str, dict] = {}

    @classmethod
    def start_job(cls, session_id: str, user_id: str = None, org_id: str = None):
        cls.sweep_stale_jobs()
        if session_id not in cls._jobs:
            cls._jobs[session_id] = {
                "session_id": session_id,
                "user_id": user_id,
                "org_id": org_id,
                "start_time": time.time(),
                "tokens": {
                    "gemini": {"input": 0, "output": 0},
                    "openai": {"input": 0, "output": 0},
                    "minimax": {"input": 0, "output": 0},
                },
                "gemini_call_count": 0,
                "video_duration_sec": 0.0,
                "pipeline_type": "express",
            }

    @classmethod
    def add_tokens(cls, session_id: str, provider: str, input_tokens: int, output_tokens: int):
        if session_id in cls._jobs and provider in cls._jobs[session_id]["tokens"]:
            cls._jobs[session_id]["tokens"][provider]["input"] += input_tokens
            cls._jobs[session_id]["tokens"][provider]["output"] += output_tokens
            if provider == "gemini":
                cls._jobs[session_id]["gemini_call_count"] = cls._jobs[session_id].get("gemini_call_count", 0) + 1

    @classmethod
    def set_video_duration(cls, session_id: str, duration_sec: float):
        if session_id in cls._jobs:
            cls._jobs[session_id]["video_duration_sec"] = duration_sec

    @classmethod
    def sweep_stale_jobs(cls, max_age_seconds: int = 3600):
        now = time.time()
        stale_session_ids = []
        for session_id, job in list(cls._jobs.items()):
            start_time = job.get("start_time", now)
            if now - start_time > max_age_seconds:
                stale_session_ids.append(session_id)
        
        for session_id in stale_session_ids:
            logger.info(f"Sweeping stale job: {session_id}")
            cls.finish_job(session_id, pipeline_type="abandoned_or_error")

    @classmethod
    def finish_job(cls, session_id: str, pipeline_type: str = "express"):
        if session_id not in cls._jobs:
            return None

        job = cls._jobs.pop(session_id)
        job["end_time"] = time.time()
        job["execution_time_sec"] = round(job["end_time"] - job["start_time"], 2)
        job["pipeline_type"] = pipeline_type

        # Cálculo estimado de custos
        cost = 0.0
        
        # Gemini 1.5 Flash
        g_in = job["tokens"]["gemini"]["input"]
        g_out = job["tokens"]["gemini"]["output"]
        cost += (g_in / 1_000_000) * GEMINI_FLASH_INPUT_PER_1M_USD + (g_out / 1_000_000) * GEMINI_FLASH_OUTPUT_PER_1M_USD

        # OpenAI GPT-4o-mini
        o_in = job["tokens"]["openai"]["input"]
        o_out = job["tokens"]["openai"]["output"]
        cost += (o_in / 1_000_000) * OPENAI_GPT4O_MINI_INPUT_PER_1M_USD + (o_out / 1_000_000) * OPENAI_GPT4O_MINI_OUTPUT_PER_1M_USD

        # MiniMax
        m_in = job["tokens"]["minimax"]["input"]
        m_out = job["tokens"]["minimax"]["output"]
        cost += (m_in / 1_000_000) * MINIMAX_INPUT_PER_1M_USD + (m_out / 1_000_000) * MINIMAX_OUTPUT_PER_1M_USD

        # Confiabilidade do preço do MiniMax
        if m_in > 0 or m_out > 0:
            job["cost_confidence"] = "estimated_unverified"
        else:
            job["cost_confidence"] = "confirmed"

        usd_to_brl = float(os.getenv("USD_TO_BRL", "5.60"))
        job["estimated_api_cost_usd"] = cost
        job["estimated_api_cost_brl"] = round(cost * usd_to_brl, 4)
        job["total_tokens"] = g_in + g_out + o_in + o_out + m_in + m_out

        # Compute cost per minute
        if job["video_duration_sec"] > 0:
            minutes = job["video_duration_sec"] / 60.0
            job["api_cost_per_minute_usd"] = round(cost / minutes, 4)
            job["api_cost_per_minute_brl"] = round((cost * usd_to_brl) / minutes, 4)
        else:
            job["api_cost_per_minute_usd"] = 0.0
            job["api_cost_per_minute_brl"] = 0.0

        # Log estruturado no console
        logger.info(json.dumps({"finops_metric": job}, ensure_ascii=False))

        # Salvar em arquivo local (JSONL) para ingestão ou dashboards
        os.makedirs("data/finops", exist_ok=True)
        try:
            with open("data/finops/metrics.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(job, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"Erro ao salvar métrica finops: {e}")

        return job
