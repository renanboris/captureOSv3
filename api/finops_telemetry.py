import time
import json
import logging
import os
from typing import Dict

logger = logging.getLogger("finops")
logger.setLevel(logging.INFO)

class FinOpsTracker:
    _jobs: Dict[str, dict] = {}

    @classmethod
    def start_job(cls, session_id: str):
        if session_id not in cls._jobs:
            cls._jobs[session_id] = {
                "session_id": session_id,
                "start_time": time.time(),
                "tokens": {
                    "gemini": {"input": 0, "output": 0},
                    "openai": {"input": 0, "output": 0},
                    "minimax": {"input": 0, "output": 0},
                },
                "video_duration_sec": 0.0,
                "pipeline_type": "express",
            }

    @classmethod
    def add_tokens(cls, session_id: str, provider: str, input_tokens: int, output_tokens: int):
        if session_id in cls._jobs and provider in cls._jobs[session_id]["tokens"]:
            cls._jobs[session_id]["tokens"][provider]["input"] += input_tokens
            cls._jobs[session_id]["tokens"][provider]["output"] += output_tokens

    @classmethod
    def set_video_duration(cls, session_id: str, duration_sec: float):
        if session_id in cls._jobs:
            cls._jobs[session_id]["video_duration_sec"] = duration_sec

    @classmethod
    def finish_job(cls, session_id: str, pipeline_type: str = "express"):
        if session_id not in cls._jobs:
            return

        job = cls._jobs.pop(session_id)
        job["end_time"] = time.time()
        job["execution_time_sec"] = round(job["end_time"] - job["start_time"], 2)
        job["pipeline_type"] = pipeline_type

        # Cálculo estimado de custos (valores em USD baseados em tabelas públicas)
        cost = 0.0
        
        # Gemini 1.5 Flash (aprox $0.075/1M in, $0.30/1M out)
        g_in = job["tokens"]["gemini"]["input"]
        g_out = job["tokens"]["gemini"]["output"]
        cost += (g_in / 1_000_000) * 0.075 + (g_out / 1_000_000) * 0.30

        # OpenAI GPT-4o-mini (aprox $0.15/1M in, $0.60/1M out)
        o_in = job["tokens"]["openai"]["input"]
        o_out = job["tokens"]["openai"]["output"]
        cost += (o_in / 1_000_000) * 0.15 + (o_out / 1_000_000) * 0.60

        # MiniMax (aprox similar ou dependendo da tabela) - Mock: $0.10/1M
        m_in = job["tokens"]["minimax"]["input"]
        m_out = job["tokens"]["minimax"]["output"]
        cost += (m_in / 1_000_000) * 0.10 + (m_out / 1_000_000) * 0.10

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
