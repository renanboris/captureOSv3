import asyncio
import json
import os
import re
import base64
import sys
import datetime
import logging
from typing import Tuple, List, Optional
from playwright.async_api import async_playwright, Page, TimeoutError as PlaywrightTimeoutError, Error as PlaywrightError
from google import genai
from google.genai import types as genai_types

from schemas import EventoCapturado, ResultadoExecucao, SoMBox
from som_annotator import get_som_boxes
from auth import realizar_login_senior

from dotenv import load_dotenv
load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
POC_OUTPUT_DIR = os.getenv("POC_OUTPUT_DIR", "poc/output")

gemini_client = genai.Client(api_key=GOOGLE_API_KEY) if GOOGLE_API_KEY else None
MODELO_GEMINI = "gemini-2.5-flash"

MAX_TENTATIVAS = 4

def get_locator(page: Page, evento: dict, seletor: str):
    """Resolve o localizador correto considerando o contexto de iframe do evento."""
    iframe_hint = evento.get('iframe_hint', '')
    if not iframe_hint or iframe_hint == 'Pagina Principal':
        return page.locator(seletor)

    # fp:name=<value>
    name_match = re.search(r'fp:name=([^,]+)', iframe_hint)
    if name_match:
        return page.frame_locator(f"iframe[name='{name_match.group(1)}']").locator(seletor)

    # fp:id=<value>
    id_match = re.search(r'fp:id=([^,]+)', iframe_hint)
    if id_match:
        return page.frame_locator(f"iframe[id='{id_match.group(1)}']").locator(seletor)

    # fp:title=<value>
    title_match = re.search(r'fp:title=([^,]+)', iframe_hint)
    if title_match:
        return page.frame_locator(f"iframe[title='{title_match.group(1)}']").locator(seletor)

    # fp:src=<partial path>
    src_match = re.search(r'fp:src=([^,]+)', iframe_hint)
    if src_match:
        return page.frame_locator(f"iframe[src*='{src_match.group(1)}']").locator(seletor)

    # fp:index=<N>
    idx_match = re.search(r'fp:index=(\d+)', iframe_hint)
    if idx_match:
        return page.frame_locator(f"iframe").nth(int(idx_match.group(1))).locator(seletor)

    return page.locator(seletor)

async def verificar_pre_condicao(page: Page, evento: dict) -> Tuple[bool, str]:
    # Atalho DOM: se o evento tem seletor e o elemento JÁ EXISTE no DOM,
    # não precisamos do Gemini para confirmar "está pronto" — a presença
    # do elemento É a pré-condição real. Isso evita falsos negativos em
    # telas SPA que estão renderizando o menu lateral assincronamente.
    seletor = evento.get('seletor', '')
    if seletor and evento.get('acao') not in ('navegar', 'scroll'):
        try:
            count = await get_locator(page, evento, seletor).count()
            if count > 0:
                return True, f"Elemento '{seletor}' encontrado no DOM (pré-condição DOM satisfeita)"
        except Exception:
            pass

    if not gemini_client:
        return True, "API Key ausente, assumindo pronto"
        
    try:
        raw_bytes = await page.screenshot(type="jpeg", quality=80)
        screenshot_atual = base64.b64encode(raw_bytes).decode('utf-8')
        
        prompt = f"""Você verá duas imagens: REFERÊNCIA (como a tela estava durante a gravação) e ATUAL (como a tela está agora).
        
O próximo passo é: '{evento.get('intencao_semantica', evento.get('acao'))}'

A tela atual está em condições de executar esse passo?
Responda APENAS com JSON:
{{
  "pronto": true ou false,
  "motivo": "explicação em uma linha",
  "diferenca_critica": "o que impede a ação, se houver, ou null"
}}"""

        ref_img_data = base64.b64decode(evento['screenshot_raw_b64'])

        response = await gemini_client.aio.models.generate_content(
            model=MODELO_GEMINI,
            contents=[
                genai_types.Part.from_text(text=prompt),
                genai_types.Part.from_bytes(data=ref_img_data, mime_type="image/jpeg"),
                genai_types.Part.from_bytes(data=base64.b64decode(screenshot_atual), mime_type="image/jpeg"),
            ],
            config=genai_types.GenerateContentConfig(response_mime_type="application/json")
        )
        
        res_json = json.loads(response.text)
        pronto = res_json.get("pronto", True)
        return pronto, res_json.get("motivo", "")
    except Exception as e:
        logger.warning(f"[PRE] Falha ao verificar pré-condição: {e}")
        return True, "Falha na verificação, assumindo pronto"

async def executar_acao(page: Page, evento: dict, estrategias_falhas: set) -> Tuple[bool, str]:
    acao = evento['acao']
    
    if acao == 'navegar':
        url_dest = evento.get('url_destino', '')
        if url_dest:
            # Em SPAs, navegações são consequência do clique anterior (History API).
            # Um page.goto() forçado causa full reload e destrói menus abertos.
            # Vamos apenas aguardar a transição natural do SPA.
            for _ in range(4):
                if url_dest.split('#')[0] == page.url.split('#')[0] or url_dest in page.url:
                    break
                await asyncio.sleep(1)
                
            # Só força o goto se realmente a página não navegou sozinha
            if url_dest not in page.url and page.url not in url_dest:
                try:
                    await page.goto(url_dest)
                except Exception:
                    pass
        return True, "url"
        
    if acao == 'scroll':
        y = evento.get('posicao', {}).get('y', 0)
        await page.evaluate(f"window.scrollTo(0, {y})")
        return True, "javascript"

    if acao == 'selecionar_dropdown':
        valor = evento.get('valor_input', '')
        if valor:
            try:
                sels = f'.ui-dropdown-item:has-text("{valor}"), .p-dropdown-item:has-text("{valor}")'
                await get_locator(page, evento, sels).first.click(timeout=3000)
                return True, "seletor_dropdown"
            except Exception as e:
                logger.warning(f"  Falha dropdown: {e}")
        return False, ""

    estrategia_usada = ""
    som_idx = evento.get("som_idx_clicado")
    
    # Estratégia 1: Seletor Semântico (muito mais robusto e preciso)
    seletor = evento.get('seletor')
    if seletor and "seletor" not in estrategias_falhas:
        try:
            logger.info(f"    [TENTANDO SELETOR] {seletor}")
            
            # Menus de contexto (CDK overlay) fecham se o DOM for interrogado lentamente.
            # Aguarda o container do menu estar visível antes de localizar o item.
            MENU_CONTAINERS = ['.ngx-contextmenu', '.p-contextmenu', '.p-menu', '[role="menu"]']
            is_menu_item = any(c in seletor for c in MENU_CONTAINERS)
            if is_menu_item:
                for container in MENU_CONTAINERS:
                    if container in seletor:
                        try:
                            loc_container = get_locator(page, evento, container)
                            await loc_container.wait_for(state='visible', timeout=3000)
                        except Exception:
                            pass
                        break
            
            loc = get_locator(page, evento, seletor).first
            if acao == 'duplo_clique':
                await loc.dblclick(timeout=5000)
            elif acao == 'clique_direito':
                await loc.click(button='right', timeout=5000)
            else:
                await loc.click(timeout=5000)
            estrategia_usada = "seletor"
        except (PlaywrightTimeoutError, PlaywrightError) as e:
            logger.warning(f"    [FALHA SELETOR] {type(e).__name__}: {seletor}")

    # Estratégia 2: SoM Vision (Fallback autônomo visual)
    async def try_click_box(boxes: List[SoMBox]) -> bool:
        target_box = None
        # 1. Match semântico
        if evento.get("ax_node"):
            ax_name = evento['ax_node'].get('ax_name')
            if ax_name:
                matches = [b for b in boxes if ax_name.lower() in b['label'].lower() or b['label'].lower() in ax_name.lower()]
                if matches:
                    target_box = matches[0]
                    
        # 2. Fallback idx
        if not target_box:
            target_box = next((b for b in boxes if b['idx'] == som_idx), None)
            
        if target_box:
            cx = target_box['x'] + target_box['w'] / 2
            cy = target_box['y'] + target_box['h'] / 2
            if acao == 'duplo_clique':
                await page.mouse.dblclick(cx, cy)
            elif acao == 'clique_direito':
                await page.mouse.click(cx, cy, button='right')
            else:
                await page.mouse.click(cx, cy)
            return True
        return False

    if not estrategia_usada and som_idx is not None and "som" not in estrategias_falhas:
        boxes = await get_som_boxes(page)
        if await try_click_box(boxes):
            estrategia_usada = "som"
            
    # Estratégia 3: Coordenada
    if not estrategia_usada and "coordenada" not in estrategias_falhas:
        pos = evento.get('posicao', {})
        x = pos.get('x', 0) + pos.get('w', 0) / 2
        y = pos.get('y', 0) + pos.get('h', 0) / 2
        if acao == 'duplo_clique':
            await page.mouse.dblclick(x, y)
        elif acao == 'clique_direito':
            await page.mouse.click(x, y, button='right')
        else:
            await page.mouse.click(x, y)
        estrategia_usada = "coordenada"
        logger.warning(f"  Aviso: usando coordenada absoluta - frágil")

    # Fix: retorna falha explícita se nenhuma estratégia funcionou
    if not estrategia_usada:
        logger.warning(f"  Nenhuma estratégia disponível para executar a ação.")
        return False, ""

    # Ações complementares após clique/localização
    if acao in ['preencher_campo', 'digitar_e_enter'] and estrategia_usada:
        valor = evento.get('valor_input', '')
        if estrategia_usada == "seletor":
            loc = get_locator(page, evento, evento['seletor']).first
            await loc.fill(valor)
            await loc.press("Tab")  # Dispara blur event no Angular
            if acao == 'digitar_e_enter':
                await loc.press("Enter")
        else:
            await page.keyboard.press("Control+A")
            await page.keyboard.press("Backspace")
            await page.keyboard.type(valor, delay=50)
            await page.keyboard.press("Tab")  # Dispara blur event no Angular
            if acao == 'digitar_e_enter':
                await page.keyboard.press("Enter")
            
    return True, estrategia_usada

async def verificar_pos_condicao(page: Page, evento: dict, screenshot_pre: bytes) -> Tuple[bool, str]:
    if not gemini_client:
        return True, "API Key ausente, assumindo ok"
        
    try:
        raw_bytes = await page.screenshot(type="jpeg", quality=80)
        
        texto_esperado = evento.get('valor_input', '')
        acao = evento.get('acao', '')
        
        dica_texto = ""
        if acao in ['preencher_campo', 'digitar_e_enter'] and texto_esperado:
            dica_texto = f"\nATENÇÃO: VERIFIQUE RIGOROSAMENTE se o texto exato '{texto_esperado}' está visível e preenchido no campo."
        elif acao in ['clique', 'duplo_clique']:
            dica_texto = f"\nATENÇÃO: VERIFIQUE RIGOROSAMENTE se a tela reagiu CORRETAMENTE à intenção. Se a intenção era abrir um módulo ou menu, verifique se ele REALMENTE abriu. Se a tela mudou para um lugar incorreto ou inesperado, a ação FALHOU (false)."
            
        prompt = f"""Você é o juiz de sucesso de um robô de automação web.
Avalie o estado da tela DEPOIS da ação em comparação com ANTES.

DADOS DA AÇÃO:
- Intenção semântica registrada: '{evento.get('intencao_semantica', evento.get('acao'))}'
- Ação técnica executada: '{evento.get('acao')}' no elemento '{evento.get('texto_encontrado') or evento.get('seletor')}'{dica_texto}

REGRAS DE SUCESSO (Retorne efeito_detectado = true se atender a QUALQUER UMA das condições abaixo):
1. A intenção semântica original foi perfeitamente cumprida.
2. A intenção original não foi perfeitamente cumprida, MAS a ação técnica (ex: clique) teve um resultado lógico e útil na interface (ex: abriu um menu de contexto, mudou de tela para o contexto esperado). A intenção pode ter sido anotada de forma incorreta ou generalista, então foque no resultado da ação técnica.
3. Se a ação técnica era de 'navegar' e as telas Antes e Depois são idênticas, assuma que a página já estava no destino correto (Navegação NO-OP). Considere SUCESSO.

REGRAS DE FALHA (Retorne efeito_detectado = false):
1. A tela permaneceu estritamente idêntica (NENHUMA mudança visual) E a ação exigia uma mudança (como um clique num botão).
2. A ação gerou uma mensagem de erro na tela ou levou a um estado indesejado (ex: página em branco, 404, loop infinito).

Responda APENAS com JSON:
{{
  "efeito_detectado": true ou false,
  "descricao": "justificativa baseada nas regras acima",
  "erro_visivel": "mensagem de erro na tela se houver, ou null"
}}"""

        response = await gemini_client.aio.models.generate_content(
            model=MODELO_GEMINI,
            contents=[
                genai_types.Part.from_text(text=prompt),
                genai_types.Part.from_bytes(data=screenshot_pre, mime_type="image/jpeg"),
                genai_types.Part.from_bytes(data=raw_bytes, mime_type="image/jpeg"),
            ],
            config=genai_types.GenerateContentConfig(response_mime_type="application/json")
        )
        
        res_json = json.loads(response.text)
        efeito = res_json.get("efeito_detectado", True)
        return efeito, res_json.get("descricao", "")
    except Exception as e:
        logger.warning(f"[POS] Falha ao verificar pós-condição: {e}")
        return True, "Falha na verificação, assumindo ok"

async def executar_evento(page: Page, evento: dict) -> ResultadoExecucao:
    res = {
        "id_acao": evento['id_acao'],
        "status": "sucesso",
        "pre_condicao": "ok",
        "pos_condicao": "ok",
        "estrategia_usada": "",
        "tentativas": 1,
        "detalhe_erro": None
    }
    
    estrategias_falhas = set()
    for tentativa in range(1, MAX_TENTATIVAS + 1):
        res["tentativas"] = tentativa
        logger.info(f"► [EXEC] ID {evento['id_acao']} - {evento.get('intencao_semantica', evento.get('acao'))} (Tentativa {tentativa}/{MAX_TENTATIVAS})")
        
        # PRÉ-CONDIÇÃO
        pronto, pre_motivo = await verificar_pre_condicao(page, evento)
        if not pronto:
            res["pre_condicao"] = "tela_diferente"
            logger.warning(f"  [PRE] Não pronto: {pre_motivo}")
            if tentativa < MAX_TENTATIVAS:
                await asyncio.sleep(2)
                continue
            else:
                res["status"] = "escalado"
                res["detalhe_erro"] = "Pré-condição falhou repetidamente."
                break
                
        # Tira screenshot antes da ação para a pós-condição
        screenshot_pre = await page.screenshot(type="jpeg", quality=80)
        
        # AÇÃO
        sucesso_acao, estrategia = await executar_acao(page, evento, estrategias_falhas)
        res["estrategia_usada"] = estrategia
        
        # Aguarda a tela reagir à ação antes de capturar o estado final
        await asyncio.sleep(2.5)
        
        if not sucesso_acao:
            res["status"] = "falha"
            res["detalhe_erro"] = "Falha em todas as estratégias de ação."
            break
            
        # PÓS-CONDIÇÃO
        efeito, pos_desc = await verificar_pos_condicao(page, evento, screenshot_pre)
        
        if not efeito:
            res["pos_condicao"] = "sem_efeito"
            logger.warning(f"  [POS] Sem efeito: {pos_desc}")
            if estrategia:
                estrategias_falhas.add(estrategia)
            if tentativa < MAX_TENTATIVAS:
                continue
            else:
                res["status"] = "escalado"
                res["detalhe_erro"] = "Pós-condição falhou repetidamente."
                break
                
        # Sucesso
        res["status"] = "sucesso"
        break
        
    return res

async def executar(jsonl_path: str):
    if not os.path.exists(jsonl_path):
        logger.error(f"Arquivo não encontrado: {jsonl_path}")
        return
        
    eventos = []
    with open(jsonl_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                eventos.append(json.loads(line))
                
    if not eventos:
        logger.error("Nenhum evento no arquivo.")
        return
        
    os.makedirs(POC_OUTPUT_DIR, exist_ok=True)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, args=['--start-maximized'])
        context = await browser.new_context(no_viewport=True)
        page = await context.new_page()
        
        logger.info(f"Navegando para {eventos[0]['page_url']}")
        await page.goto(eventos[0]['page_url'])
        
        # Realiza o login bruto se aplicável
        await realizar_login_senior(page)
        
        print("\n" + "="*50)
        print("SESSÃO DE EXECUÇÃO INICIADA")
        print("O motor lidou com a autenticação (se necessário). Iniciando fluxo visual...")
        print("="*50 + "\n")
        
        resultados = []
        for evento in eventos:
            res = await executar_evento(page, evento)
            resultados.append(res)
            logger.info(f"■ [RESULTADO] {res['status']} via {res['estrategia_usada']}")
            if res['status'] == 'escalado':
                logger.error(f"Execução parada no evento {evento['id_acao']}: {res['detalhe_erro']}")
                break
                
        # Salvar output
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = os.path.join(POC_OUTPUT_DIR, f"execution_{timestamp}.jsonl")
        with open(output_file, 'w', encoding='utf-8') as f:
            for r in resultados:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                
        logger.info(f"Execução finalizada. Salvo em {output_file}")
        await browser.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python poc_executor.py <caminho_do_capture.jsonl>")
        sys.exit(1)
    asyncio.run(executar(sys.argv[1]))
