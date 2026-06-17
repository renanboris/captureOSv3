import os
import time
import json
import logging
import threading
from typing import Optional, Dict, List
from dotenv import load_dotenv

# Carrega ambiente
load_dotenv()

# Logger
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Parâmetros Pinecone / OpenAI
OPENAI_EMBED_MODEL = "text-embedding-3-large"
TARGET_DIM = 3072
TOP_K = 3
SCORE_THRESHOLD = 0.45

# =========================================================
# INICIALIZAÇÃO DE CLIENTES (Tolerante a Falhas)
# =========================================================
client_openai = None
pinecone_index = None

try:
    oa_key = os.getenv("OPENAI_API_KEY")
    if oa_key:
        from openai import OpenAI
        client_openai = OpenAI(api_key=oa_key)
    else:
        logger.warning("OPENAI_API_KEY não configurada. RAG Desativado.")

    pc_key = os.getenv("PINECONE_API_KEY")
    idx_name = os.getenv("PINECONE_INDEX_NAME")
    if pc_key and idx_name:
        from pinecone import Pinecone
        pc = Pinecone(api_key=pc_key)
        pinecone_index = pc.Index(idx_name)
    else:
        logger.warning("Pinecone credentials ausentes. RAG Desativado.")
except Exception as e:
    logger.error(f"Erro na inicialização dos clientes RAG: {e}")

# =========================================================
# EMBEDDING
# =========================================================
def gerar_embedding(texto: str) -> List[float]:
    if not client_openai:
        raise Exception("OpenAI Client não inicializado")
    response = client_openai.embeddings.create(
        input=texto, model=OPENAI_EMBED_MODEL, dimensions=TARGET_DIM
    )
    return response.data[0].embedding

# =========================================================
# MULTI-NAMESPACE RAG (Paralelo)
# =========================================================
_ACTIVE_NAMESPACES: List[str] = []
_NAMESPACES_LOADED = False

def _load_active_namespaces() -> List[str]:
    global _ACTIVE_NAMESPACES, _NAMESPACES_LOADED
    if _NAMESPACES_LOADED:
        return _ACTIVE_NAMESPACES

    # Fallback conservador para evitar consultas lentas
    _FALLBACK_NAMESPACES = ["senior_default", "manual_do_usuario", "faq", "erp", "hcm", "bpm"]

    if not pinecone_index:
        _ACTIVE_NAMESPACES = _FALLBACK_NAMESPACES
        _NAMESPACES_LOADED = True
        return _ACTIVE_NAMESPACES

    try:
        stats = pinecone_index.describe_index_stats()
        namespaces = list(stats.get("namespaces", {}).keys())
        if namespaces:
            _ACTIVE_NAMESPACES = namespaces
        else:
            _ACTIVE_NAMESPACES = _FALLBACK_NAMESPACES
    except Exception as e:
        logger.warning(f"Falha ao descrever namespaces Pinecone: {e}")
        _ACTIVE_NAMESPACES = _FALLBACK_NAMESPACES

    _NAMESPACES_LOADED = True
    return _ACTIVE_NAMESPACES

def buscar_contexto_multi_namespace(prompt_usuario: str, namespace_alvo: Optional[str] = None) -> Optional[Dict]:
    """Busca contexto no Pinecone. Se namespace_alvo for fornecido, busca apenas nele."""
    if not pinecone_index or not client_openai:
        return None

    if namespace_alvo and namespace_alvo != "auto":
        namespaces = [namespace_alvo]
    else:
        namespaces = _load_active_namespaces()

    try:
        query_embedding = gerar_embedding(prompt_usuario)
    except Exception as e:
        logger.error(f"Falha ao gerar embedding RAG: {e}")
        return None

    melhor_resultado: Optional[Dict] = None
    melhor_score = 0.0
    lock = threading.Lock()

    def _buscar_namespace(ns: str) -> None:
        nonlocal melhor_resultado, melhor_score
        try:
            resultados = pinecone_index.query(
                vector=query_embedding,
                top_k=TOP_K,
                namespace=ns,
                include_metadata=True,
            )

            contextos = []
            score_ns = 0.0

            for match in resultados.matches:
                if match.score < SCORE_THRESHOLD:
                    continue
                md = match.metadata

                if md.get("aula"):
                    contexto = f"MANUAL: {md.get('aula')}\nINSTRUCAO: {md.get('texto')}"
                elif md.get("url"):
                    contexto = f"DOCUMENTACAO: {md.get('titulo', 'Sem título')}\nCONTEUDO: {md.get('text', '')}"
                else:
                    contexto = f"CONTEUDO: {md.get('text', md.get('texto', ''))}"

                if match.score > score_ns:
                    score_ns = match.score

                contextos.append(contexto)

            if not contextos:
                return

            resultado_ns = {
                "texto_rag": "\n---\n".join(contextos),
                "score": score_ns,
                "namespace": ns,
            }

            with lock:
                if score_ns > melhor_score:
                    melhor_score = score_ns
                    melhor_resultado = resultado_ns

        except Exception as e:
            pass # Silencia erros paralelos para não floodar logs

    # Executa buscas em paralelo
    threads = [threading.Thread(target=_buscar_namespace, args=(ns,)) for ns in namespaces]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=4.0)  # Tolerância rigorosa (V3 não pode travar)

    return melhor_resultado

# =========================================================
# UPLOAD MANUAL DE CONTEXTO
# =========================================================
def extrair_texto_documento(file_data_b64: str, filename: str) -> str:
    """Extrai o texto de um PDF ou TXT em base64"""
    import base64
    import io
    
    try:
        raw_bytes = base64.b64decode(file_data_b64)
        if filename.lower().endswith(".pdf"):
            from PyPDF2 import PdfReader
            pdf_file = io.BytesIO(raw_bytes)
            reader = PdfReader(pdf_file)
            texto = []
            for page in reader.pages:
                t = page.extract_text()
                if t: texto.append(t)
            return "\n".join(texto)
        else:
            return raw_bytes.decode("utf-8", errors="ignore")
    except Exception as e:
        logger.error(f"Falha ao extrair texto: {e}")
        return ""

def ingerir_documento_para_namespace(file_data_b64: str, filename: str, namespace: str) -> bool:
    """Extrai texto, gera embeddings e salva no Pinecone sob o namespace"""
    import hashlib
    
    if not pinecone_index:
        logger.error("Pinecone não inicializado, impossível vetorizar")
        return False
        
    texto_puro = extrair_texto_documento(file_data_b64, filename)
    if not texto_puro.strip():
        logger.warning(f"Documento vazio: {filename}")
        return False
        
    # Quebrar texto em chunks de ~1000 caracteres
    chunks = [texto_puro[i:i+1000] for i in range(0, len(texto_puro), 1000)]
    
    vectors_to_upsert = []
    doc_id = hashlib.md5(filename.encode()).hexdigest()[:10]
    
    for i, chunk in enumerate(chunks):
        embedding = gerar_embedding(chunk)
        chunk_id = f"doc_{doc_id}_chunk_{i}"
        
        vectors_to_upsert.append({
            "id": chunk_id,
            "values": embedding,
            "metadata": {
                "text": chunk,
                "titulo": filename,
                "fonte": "Upload Local Release Notes"
            }
        })
        
    try:
        pinecone_index.upsert(vectors=vectors_to_upsert, namespace=namespace)
        logger.info(f"Vetorizados {len(vectors_to_upsert)} chunks no namespace '{namespace}'")
        return True
    except Exception as e:
        logger.error(f"Erro ao upsert no Pinecone: {e}")
        return False
