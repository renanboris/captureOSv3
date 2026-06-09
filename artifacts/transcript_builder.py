import logging

logger = logging.getLogger(__name__)

def gerar_transcricao(roteiro: list, output_path: str) -> bool:
    """Gera transcrição completa do tutorial em texto plano com timestamps."""
    try:
        linhas = []
        for passo in roteiro:
            num = passo.get("passo")
            ts = passo.get("timestamp", 0)
            ancora = passo.get("ancora", "").strip()
            micro = passo.get("micro_narracao", "").strip()
            
            if num == 0:
                if ancora:
                    linhas.append(f"[INTRODUÇÃO]\n{ancora}\n")
            elif num == 999:
                if ancora:
                    linhas.append(f"\n[CONCLUSÃO]\n{ancora}\n")
            else:
                texto = f"{ancora} {micro}".strip()
                # Pular passos sem conteúdo textual
                if not texto:
                    continue
                tempo = f"{int(ts/1000//60):02d}:{int(ts/1000%60):02d}" if ts else "--:--"
                linhas.append(f"[{tempo}] Passo {num}: {texto}")

        with open(output_path, "w", encoding="utf-8") as f:
            f.write("\n".join(linhas))
        return True
    except Exception as e:
        logger.error(f"Erro ao gerar transcrição: {e}")
        return False
