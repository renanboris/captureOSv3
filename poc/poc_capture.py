import asyncio
import json
import base64
import os
import datetime
import logging
from typing import List, Dict, Any
from playwright.async_api import async_playwright, Page, Playwright
import google.generativeai as genai

from schemas import EventoCapturado, SoMBox
from cdp_enricher import enriquecer_com_ax
from som_annotator import get_som_boxes, anotar_imagem, identificar_box_clicada
from auth import realizar_login_senior

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# Configurações
POC_URL = os.getenv("POC_URL", "https://google.com")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
POC_OUTPUT_DIR = os.getenv("POC_OUTPUT_DIR", "poc/output")

if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

# Estado global
eventos_capturados: List[EventoCapturado] = []
id_acao_counter = 1
browser_context = None
active_page = None
captura_ativa = False

async def on_evento(source: Dict[str, Any], args: str):
    """Callback exposto para o Playwright (radar_v3.js)"""
    global id_acao_counter, active_page, captura_ativa
    
    if not captura_ativa:
        return
        
    try:
        dados = json.loads(args)
        logger.info(f"Recebido evento: {dados['acao']} - {dados.get('tag')} - {dados.get('texto_encontrado')}")
        
        page = active_page
        if not page:
            logger.warning("Nenhuma página ativa encontrada para capturar o contexto visual.")
            return

        # Tirar screenshot raw (JPEG)
        raw_bytes = await page.screenshot(type="jpeg", quality=80)
        screenshot_raw_b64 = base64.b64encode(raw_bytes).decode('utf-8')
        
        # Obter (x, y) do evento
        pos_str = dados.get("posicao_visual", "")
        # pos_str format: "x:10,y:20,w:100,h:50"
        pos_dict = {}
        if pos_str:
            parts = pos_str.split(',')
            for p in parts:
                k, v = p.split(':')
                pos_dict[k] = float(v)
                
        cx = int(pos_dict.get('x', 0) + pos_dict.get('w', 0) / 2)
        cy = int(pos_dict.get('y', 0) + pos_dict.get('h', 0) / 2)
        
        # Enriquecer via CDP
        ax_node = await enriquecer_com_ax(page, cx, cy)
        
        # Set-of-Mark (SoM)
        boxes = await get_som_boxes(page)
        som_total = len(boxes)
        
        # Anotar imagem
        annotated_bytes = anotar_imagem(raw_bytes, boxes)
        screenshot_som_b64 = base64.b64encode(annotated_bytes).decode('utf-8')
        
        # Identificar box clicada
        idx_clicado = identificar_box_clicada(boxes, cx, cy)
        
        # Montar EventoCapturado
        evento: EventoCapturado = {
            "id_acao": id_acao_counter,
            "acao": dados.get("acao", "clique"),
            "timestamp": datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z"),
            "tag": dados.get("tag", ""),
            "label": dados.get("texto_encontrado", ""),
            "seletor": dados.get("seletor", ""),
            "primeng_component": dados.get("primeng_component", ""),
            "iframe_hint": dados.get("iframe"),
            "modal_context": dados.get("modal_context"),
            "posicao": pos_dict,
            "html_hint": dados.get("html_snapshot", ""),
            "valor_input": dados.get("valor_input", ""),
            "ax_node": ax_node,
            "som_idx_clicado": idx_clicado,
            "som_total_boxes": som_total,
            "screenshot_som_b64": screenshot_som_b64,
            "screenshot_raw_b64": screenshot_raw_b64,
            "intencao_semantica": "",
            "contexto_tela": "",
            "tipo_elemento": "",
            "confianca": "",
            "page_title": await page.title(),
            "page_url": page.url
        }
        
        eventos_capturados.append(evento)
        id_acao_counter += 1
        logger.info(f"Evento {evento['id_acao']} salvo em memória.")
        
    except Exception as e:
        logger.error(f"Erro em on_evento: {e}")

async def enriquecer_com_gemini(evento: EventoCapturado):
    """Envia o evento para o Gemini Vision em background"""
    if not GOOGLE_API_KEY:
        logger.warning("GOOGLE_API_KEY não configurada. Pulando Gemini.")
        return
        
    try:
        model = genai.GenerativeModel('gemini-2.0-flash')
        
        prompt = f"""Você é um analista de UX documentando uso de sistema corporativo.

Contexto da ação:
- Ação: {evento['acao']}
- Label capturado pelo JS: '{evento['label']}'
- AX Role/Name: {evento.get('ax_node', {}).get('ax_role','')} / {evento.get('ax_node', {}).get('ax_name','')}
- Elemento SoM: box #{evento['som_idx_clicado']} de {evento['som_total_boxes']} interativos na tela
- Snapshot semântico: {evento['html_hint']}
- Página: {evento['page_title']} — {evento['page_url']}

A imagem enviada tem bounding boxes numeradas em vermelho sobre os elementos interativos.
O elemento clicado é o de número {evento['som_idx_clicado']}.

Responda com JSON:
{{
  "intencao_semantica": "O QUE o usuário quis fazer (orientado a resultado de negócio)",
  "contexto_tela": "Em qual módulo/tela do sistema o usuário está",
  "tipo_elemento": "button|input|dropdown|checkbox|link|tab|menu_item|icon",
  "confianca": "alta|media|baixa"
}}"""

        img_data = base64.b64decode(evento['screenshot_som_b64'])
        image_part = {
            "mime_type": "image/jpeg",
            "data": img_data
        }
        
        response = model.generate_content([prompt, image_part], generation_config={"response_mime_type": "application/json"})
        
        result = json.loads(response.text)
        if isinstance(result, list):
            result = result[0] if result else {}
            
        evento['intencao_semantica'] = result.get('intencao_semantica', '')
        evento['contexto_tela'] = result.get('contexto_tela', '')
        evento['tipo_elemento'] = result.get('tipo_elemento', '')
        evento['confianca'] = result.get('confianca', '')
        logger.info(f"Gemini processou evento {evento['id_acao']}")
        
    except Exception as e:
        logger.error(f"Erro no Gemini Vision para evento {evento['id_acao']}: {e}")

async def enriquecer_lote():
    """Enriquece os eventos capturados com o Gemini em paralelo"""
    if not eventos_capturados:
        return
        
    logger.info("Iniciando enriquecimento com Gemini Vision...")
    batch_size = 6
    for i in range(0, len(eventos_capturados), batch_size):
        lote = eventos_capturados[i:i+batch_size]
        tasks = [enriquecer_com_gemini(e) for e in lote]
        await asyncio.gather(*tasks)

async def injetar_radar(page: Page):
    try:
        radar_path = os.path.join(os.path.dirname(__file__), "radar_v3.js")
        with open(radar_path, "r", encoding="utf-8") as f:
            script_content = f.read()
        await page.add_init_script(script_content)
        await page.evaluate(script_content)
    except Exception as e:
        logger.error(f"Erro ao injetar radar: {e}")

async def main():
    global active_page, browser_context
    
    os.makedirs(POC_OUTPUT_DIR, exist_ok=True)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, args=['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process', '--start-maximized'])
        browser_context = await browser.new_context(viewport=None, bypass_csp=True, no_viewport=True)
        active_page = await browser_context.new_page()
        
        await browser_context.expose_binding("capturarElemento", on_evento)
        
        # Injetar script do radar ao navegar
        active_page.on('load', lambda page: asyncio.create_task(injetar_radar(page)))
        
        # Carregar página alvo
        logger.info(f"Navegando para {POC_URL}...")
        await active_page.goto(POC_URL)
        
        # Realiza o login bruto se aplicável
        await realizar_login_senior(active_page)
        
        global captura_ativa
        captura_ativa = True
        
        print("\n" + "="*50)
        print("SESSÃO DE CAPTURA INICIADA")
        print("1. O motor já lidou com a autenticação (se configurado no .env).")
        print("2. Navegue no sistema para gerar eventos.")
        print("3. Para encerrar, feche o navegador ou pressione Ctrl+C aqui.")
        print("="*50 + "\n")
        
        await injetar_radar(active_page)
        
        # Loop até fechar
        try:
            while True:
                if active_page.is_closed():
                    break
                await asyncio.sleep(3)
                # Healthcheck básico
                try:
                    is_injected = await active_page.evaluate("() => window.__radarInjetado === true")
                except Exception:
                    is_injected = False
                if not is_injected:
                    await injetar_radar(active_page)
        except KeyboardInterrupt:
            logger.info("Encerrando via Ctrl+C...")
            pass
            
        logger.info("Navegador fechado ou captura interrompida.")
        
        # Processar Gemini
        try:
            await enriquecer_lote()
        except (KeyboardInterrupt, asyncio.exceptions.CancelledError):
            logger.info("Enriquecimento interrompido pelo usuário. Salvando dados capturados até o momento...")
        
        # Salvar output
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = os.path.join(POC_OUTPUT_DIR, f"capture_{timestamp}.jsonl")
        
        with open(output_file, "w", encoding="utf-8") as f:
            for ev in eventos_capturados:
                f.write(json.dumps(ev, ensure_ascii=False) + "\n")
                
        # Resumo
        total = len(eventos_capturados)
        com_intencao = sum(1 for e in eventos_capturados if e.get('intencao_semantica'))
        print(f"\nResumo da Captura:")
        print(f"- {total} eventos capturados")
        print(f"- {com_intencao} enriquecidos via Gemini")
        print(f"- Salvo em: {output_file}")

if __name__ == "__main__":
    asyncio.run(main())
