from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class SimlinkHotspot(BaseModel):
    """Zona clicável de um passo — baseada nos dados do _simlink capturado."""
    passo_num: int
    xpath: str
    css_selector: str
    coordinates: Dict[str, float]  # {x, y, w, h} — relativo ao screenshot
    target_text: str
    action: str  # "click" | "input" | "select"
    screenshot_path: str  # mudamos de b64 para path
    ancora: str  # texto narrado ao acertar
    micro_narracao: str  # dica exibida ao errar

class SimlinkModulo(BaseModel):
    """Módulo completo de simulação — gerado a partir de uma sessão CaptureOS."""
    modulo_id: str
    session_id: str
    titulo: str
    total_passos: int
    hotspots: List[SimlinkHotspot]
    video_url: str
    xp_max: int  # calculado: total_passos * 10 + bônus sequência perfeita
    criado_em: str
    lms_callback_url: Optional[str] = None  # URL do LMS para reportar conclusão
    lms_callback_token: Optional[str] = None
