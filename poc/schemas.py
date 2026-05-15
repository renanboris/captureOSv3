from typing import TypedDict, Optional, Dict

class AXNode(TypedDict):
    ax_role: str
    ax_name: str
    ax_states: dict

class SoMBox(TypedDict):
    idx: int
    x: int
    y: int
    w: int
    h: int
    role: str
    label: str

class EventoCapturado(TypedDict):
    id_acao: int
    acao: str
    timestamp: str
    tag: str
    label: str
    seletor: str
    primeng_component: str
    iframe_hint: Optional[str]
    modal_context: Optional[dict]
    posicao: Dict[str, float]
    html_hint: str
    valor_input: str
    ax_node: Optional[AXNode]
    som_idx_clicado: Optional[int]
    som_total_boxes: int
    screenshot_som_b64: Optional[str]
    screenshot_raw_b64: Optional[str]
    intencao_semantica: str
    contexto_tela: str
    tipo_elemento: str
    confianca: str
    page_title: str
    page_url: str

class ResultadoExecucao(TypedDict):
    id_acao: int
    status: str
    pre_condicao: str
    pos_condicao: str
    estrategia_usada: str
    tentativas: int
    detalhe_erro: Optional[str]
