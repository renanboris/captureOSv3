from pydantic import BaseModel
from typing import List, Dict, Any

class PassoRoteiro(BaseModel):
    passo: int
    timestamp: int
    intencao_corporativa: str
    geometria_clique: Dict[str, int]
    tag_alvo: str
    texto_alvo: str

class MetadataRoteiro(BaseModel):
    session_id: str
    sistema: str = "Senior X"
    resolucao: Dict[str, int]

class RoteiroHandoff(BaseModel):
    metadata: MetadataRoteiro
    configuracao_gravacao: Dict[str, Any]
    passos: List[PassoRoteiro]
