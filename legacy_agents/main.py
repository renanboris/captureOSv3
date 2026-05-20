import sys
import asyncio
import argparse
from playwright.async_api import async_playwright

async def run_agent(url, goal):
    from orchestration.agent_loop import AutonomousWebAgent
    print(f"[*] Iniciando Agente Autônomo na URL: {url}")
    print(f"[*] Objetivo: {goal}")
    
    async with async_playwright() as p:
        # Launch visible browser for the POC
        browser = await p.chromium.launch(headless=False, args=['--start-maximized'])
        context = await browser.new_context(no_viewport=True)
        page = await context.new_page()
        
        await page.goto(url)
        # Give some time to load
        await asyncio.sleep(2)
        
        agent = AutonomousWebAgent(page)
        await agent.execute_goal(goal)
        
        print("\n[+] Execução finalizada.")
        await browser.close()

def main():
    parser = argparse.ArgumentParser(description="Capture OS v3 - Agente Web Autônomo")
    parser.add_argument("mode", choices=["spider", "agent"], help="Modo de operação: 'spider' para auto-descoberta ou 'agent' para atingir um objetivo.")
    parser.add_argument("--url", required=True, help="URL alvo inicial")
    parser.add_argument("--goal", help="Objetivo do usuário (Obrigatório no modo 'agent')")
    
    args = parser.parse_args()
    
    if args.mode == "spider":
        from orchestration.spider_runner import run_spider
        asyncio.run(run_spider(args.url))
    elif args.mode == "agent":
        if not args.goal:
            print("Erro: A flag --goal é obrigatória no modo 'agent'")
            sys.exit(1)
        asyncio.run(run_agent(args.url, args.goal))

if __name__ == "__main__":
    main()
