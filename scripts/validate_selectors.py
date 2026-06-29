#!/usr/bin/env python3
import json
import glob
import logging
import asyncio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def run_validation():
    """
    Camada 4 da Spec: Script de Monitoramento Ativo (Self-Healing).
    Lê os roteiros gerados e verifica se os seletores persistentes no Radar V3
    (capturados) ainda fariam sentido estruturalmente no momento.
    Num cenário real, rodaria via cronjob disparando head-less browser para a URL de destino.
    Aqui validamos a consistência dos dados salvos no banco.
    """
    logger.info("Iniciando rotina de validação noturna de seletores estruturais...")
    roteiros_files = glob.glob("data/roteiros/*.json")
    
    warnings = 0
    checked = 0
    
    for filepath in roteiros_files:
        if filepath.endswith(".jsonl"): continue
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
                roteiro = data.get("roteiro", [])
                
            for passo in roteiro:
                simlink_data = passo.get("_simlink", {})
                if simlink_data:
                    checked += 1
                    # Valida se existe bounding_box estrutural
                    bbox = simlink_data.get("bounding_box")
                    if not bbox or not isinstance(bbox, dict):
                        warnings += 1
                        logger.warning(f"Passo {passo.get('passo')} do {filepath} sem BBox válido.")
                        
        except Exception as e:
            logger.error(f"Falha ao validar {filepath}: {e}")
            
    logger.info(f"Validação concluída: {checked} hotspots estruturais verificados. {warnings} alertas.")

if __name__ == "__main__":
    asyncio.run(run_validation())
