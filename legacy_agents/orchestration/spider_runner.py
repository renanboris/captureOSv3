import asyncio
import logging
from playwright.async_api import async_playwright
from capture.browser_probe import BrowserProbe
from data.knowledge_graph import KnowledgeGraph
from contracts.state_models import ActionDecision

logger = logging.getLogger(__name__)

async def run_spider(start_url: str):
    logger.info("Iniciando Spider Runner...")
    graph = KnowledgeGraph()
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        probe = BrowserProbe(page)
        
        await page.goto(start_url)
        await asyncio.sleep(3) # wait for load
        
        # 1. Capture base state
        base_snapshot, _ = await probe.capture_semantic_snapshot()
        logger.info(f"Estado base salvo. {len(base_snapshot.nodes)} nós semânticos encontrados.")
        
        # Find all link-like nodes (e.g. menu items)
        clickable_nodes = [n for n in base_snapshot.nodes if n.role in ('menuitem', 'link') or n.tag == 'a']
        
        logger.info(f"Spider tentará descobrir {len(clickable_nodes)} caminhos possíveis.")
        
        # Simple depth-1 spider
        for idx, node in enumerate(clickable_nodes):
            if not node.som_id: 
                # Se não tem id, usa o fallback na lógica real
                pass
                
            logger.info(f"Spider clicando no nó: {node.text} (Tag: {node.tag})")
            
            # Executa o clique (simulado via texto)
            try:
                await page.evaluate(f"""
                () => {{
                    const els = Array.from(document.querySelectorAll('{node.tag}'));
                    const target = els.find(e => e.innerText.includes('{node.text}'));
                    if(target) target.click();
                }}
                """)
                await asyncio.sleep(3)
                
                new_snapshot, _ = await probe.capture_semantic_snapshot()
                
                decision = ActionDecision(action="click", som_id=node.som_id, reasoning=f"Spider Auto-Discovery: {node.text}")
                graph.add_transition(base_snapshot, new_snapshot, decision)
                
                # Volta pra home
                await page.goto(start_url)
                await asyncio.sleep(2)
                
            except Exception as e:
                logger.error(f"Erro ao spiderar nó {node.text}: {e}")
                
        logger.info("Spider Finalizado. Grafo populado.")
        await browser.close()
