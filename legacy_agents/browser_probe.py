import os
import json
import base64
import asyncio
import logging
from typing import Optional, Tuple
from playwright.async_api import Page
from contracts.state_models import SemanticSnapshot, A11yNode, A11yNodeState
from vision.som_annotator import get_som_boxes, anotar_imagem

logger = logging.getLogger(__name__)

class BrowserProbe:
    def __init__(self, page: Page):
        self.page = page

    async def inject_a11y_extractor(self):
        """Injeta o extrator semântico na página."""
        extractor_path = os.path.join(os.path.dirname(__file__), "a11y_extractor.js")
        if os.path.exists(extractor_path):
            with open(extractor_path, "r", encoding="utf-8") as f:
                script = f.read()
            await self.page.add_init_script(script)
            await self.page.evaluate(script)
        else:
            logger.error("a11y_extractor.js não encontrado")

    async def capture_semantic_snapshot(self) -> Tuple[SemanticSnapshot, str]:
        """
        Retorna o modelo de A11y Tree e a imagem anotada com SoM (base64).
        """
        await self.inject_a11y_extractor()
        
        # 1. Obter arvore semantica via JS
        raw_snapshot = await self.page.evaluate("() => window.getSemanticSnapshot ? window.getSemanticSnapshot() : []")
        
        # 2. Obter bounding boxes (SoM)
        boxes = await get_som_boxes(self.page)
        
        # Associar indices das boxes aos nós baseados no DOM se possível
        # Na POC original, geramos o idx. O ideal seria o JS setar o atributo data-som-id.
        # Por enquanto, mantemos a lógica simples.
        
        nodes = []
        for raw in raw_snapshot:
            state_data = raw.get("state", {})
            nodes.append(A11yNode(
                som_id=raw.get("som_id"),
                tag=raw.get("tag", ""),
                role=raw.get("role", ""),
                text=raw.get("text", ""),
                state=A11yNodeState(
                    expanded=state_data.get("expanded"),
                    disabled=state_data.get("disabled", False),
                    checked=state_data.get("checked", False)
                )
            ))
            
        snapshot = SemanticSnapshot(
            url=self.page.url,
            title=await self.page.title(),
            nodes=nodes
        )
        
        # 3. Gerar imagem anotada
        raw_bytes = await self.page.screenshot(type="jpeg", quality=80)
        annotated_bytes = anotar_imagem(raw_bytes, boxes)
        annotated_b64 = base64.b64encode(annotated_bytes).decode('utf-8')
        
        return snapshot, annotated_b64
