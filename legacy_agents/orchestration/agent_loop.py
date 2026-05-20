import os
import json
import base64
import asyncio
import logging
from playwright.async_api import Page
from google import genai
from google.genai import types as genai_types

from contracts.state_models import ActionDecision, SemanticSnapshot
from capture.browser_probe import BrowserProbe
from capture.state_diff import StateDiffEngine
from data.knowledge_graph import KnowledgeGraph

logger = logging.getLogger(__name__)

class AutonomousWebAgent:
    def __init__(self, page: Page):
        self.page = page
        self.probe = BrowserProbe(page)
        self.diff_engine = StateDiffEngine()
        self.graph = KnowledgeGraph()
        
        api_key = os.getenv("GOOGLE_API_KEY", "")
        self.gemini_client = genai.Client(api_key=api_key) if api_key else None
        self.model_name = "gemini-2.5-flash"
        self.action_history = []

    async def execute_goal(self, user_goal: str):
        if not self.gemini_client:
            logger.error("GOOGLE_API_KEY is missing.")
            return

        logger.info(f"Iniciando objetivo: {user_goal}")
        
        for step in range(10): # limit to 10 steps max for safety
            logger.info(f"--- Passo {step+1} ---")
            
            # 1. OBSERVE
            snapshot, annotated_b64 = await self.probe.capture_semantic_snapshot()
            
            # 2. ORIENT
            path_hints = self.graph.find_path(snapshot, user_goal)
            
            # 3. DECIDE
            decision = await self._decide_next_action(user_goal, snapshot, annotated_b64, path_hints)
            if not decision:
                logger.error("Falha ao decidir a próxima ação.")
                break
                
            if decision.action == "done":
                logger.info(f"Objetivo alcançado! Motivo: {decision.reasoning}")
                break

            self.action_history.append(decision.model_dump())
            
            # 4. ACT
            await self._execute_action(decision)
            
            # Aguarda a tela renderizar
            await asyncio.sleep(2)
            
            # 5. VERIFY
            new_snapshot, _ = await self.probe.capture_semantic_snapshot()
            state_change = self.diff_engine.detect(snapshot, new_snapshot)
            
            # Salvar no grafo
            if state_change.changed:
                self.graph.add_transition(snapshot, new_snapshot, decision)
                
            logger.info(f"VERIFY: {state_change.change_summary}")

    async def _decide_next_action(self, goal: str, snapshot: SemanticSnapshot, img_b64: str, hints: list) -> ActionDecision:
        nodes_json = json.dumps([n.model_dump() for n in snapshot.nodes], indent=2)
        hints_str = "\n".join(hints) if hints else "Nenhuma dica disponível no grafo."
        history_str = json.dumps(self.action_history, indent=2)
        
        prompt = f"""Você é um Agente RPA navegando em um sistema corporativo web.
Seu objetivo é: {goal}.

A imagem anexa mostra a tela com os elementos interativos marcados com caixas vermelhas e seus IDs (SoM IDs).
O JSON abaixo descreve o que cada ID significa semânticamente na A11y Tree:
{nodes_json}

Dicas do Grafo de Conhecimento (ações passadas neste estado):
{hints_str}

Histórico das últimas ações que você tomou: 
{history_str}

Qual o próximo passo? Se o objetivo já foi alcançado, retorne "done" como ação.
Ações suportadas: 'click', 'type', 'done'.
Para 'type', insira o texto no campo 'reasoning' no formato: "[texto a digitar] - motivo" ou algo do tipo. Na v2 adicionaremos suporte nativo a args.
Responda APENAS com JSON no formato:
{{
  "action": "click|type|done",
  "som_id": "ID_DO_ELEMENTO_NA_IMAGEM",
  "reasoning": "Sua explicação lógica para esta decisão"
}}"""

        img_data = base64.b64decode(img_b64)
        
        try:
            response = await self.gemini_client.aio.models.generate_content(
                model=self.model_name,
                contents=[
                    genai_types.Part.from_text(text=prompt),
                    genai_types.Part.from_bytes(data=img_data, mime_type="image/jpeg"),
                ],
                config=genai_types.GenerateContentConfig(response_mime_type="application/json")
            )
            res_json = json.loads(response.text)
            return ActionDecision(**res_json)
        except Exception as e:
            logger.error(f"Erro no Gemini: {e}")
            return None

    async def _execute_action(self, decision: ActionDecision):
        logger.info(f"ACT: Executando {decision.action} no SoM ID {decision.som_id}. Motivo: {decision.reasoning}")
        if decision.action == "click" and decision.som_id:
            # Pela injeção SoM (vision/som_annotator.py), podemos encontrar a coordenada da box pelo ID ou usar um seletor nativo.
            # No modo autônomo puro, vamos recuperar a box chamando o window.get_som_boxes novamente (ou passando a coordenada no snapshot).
            # Para simplificar aqui, vamos avaliar na pagina para clicar via JS usando o ID.
            script = f"""
            (() => {{
                // Usar a mesma logica do SoM para achar o elemento interativo
                // Como não salvamos a box original (apenas a imagem), faremos um click via coordenadas ou atributos.
                // Idealmente, o data-som-id foi injetado. Se não, pegamos o N-ésimo.
                const els = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="menuitem"]');
                // Na versão simplificada: o JS do annotator gera na hora. 
                // Precisamos da coordenada da box que foi enviada pro agent.
                // ... Implementação real precisa mapear de volta a Box.
            }})()
            """
            # Hack provisorio pra POC: clica nas boxes q geramos
            boxes = await __import__('vision.som_annotator').som_annotator.get_som_boxes(self.page)
            target = next((b for b in boxes if str(b['idx']) == str(decision.som_id)), None)
            if target:
                cx = target['x'] + target['w'] / 2
                cy = target['y'] + target['h'] / 2
                await self.page.mouse.click(cx, cy)
            else:
                logger.warning(f"SoM ID {decision.som_id} não encontrado na tela atual.")

        elif decision.action == "type" and decision.som_id:
            boxes = await __import__('vision.som_annotator').som_annotator.get_som_boxes(self.page)
            target = next((b for b in boxes if str(b['idx']) == str(decision.som_id)), None)
            if target:
                cx = target['x'] + target['w'] / 2
                cy = target['y'] + target['h'] / 2
                await self.page.mouse.click(cx, cy)
                await self.page.keyboard.type(decision.reasoning.split("-")[0].strip()) # simplificação do input text
