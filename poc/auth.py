import os
import asyncio
import logging
from playwright.async_api import Page, TimeoutError as PlaywrightTimeoutError

# Configurar logger
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

async def realizar_login_senior(page: Page) -> bool:
    """
    Verifica se a tela atual possui formulário de login e realiza a autenticação bruta.
    Retorna True se realizou o login ou se não precisou. Retorna False se falhou miseravelmente.
    """
    senior_user = os.getenv("SENIOR_USER")
    senior_pass = os.getenv("SENIOR_PASS")
    
    if not senior_user or not senior_pass:
        logger.warning("Variáveis SENIOR_USER ou SENIOR_PASS não configuradas no .env. Pulando auto-login.")
        return True

    # Verifica se os inputs de login estão na tela (aumentado para 30s devido a redirecionamentos de SSO pesados)
    try:
        # Procurando o input de username com múltiplos fallbacks
        loc_user = page.locator("input[name='username'], input#username, input[type='email']").first
        await loc_user.wait_for(state="visible", timeout=30000)
    except PlaywrightTimeoutError:
        # Tirar um print para sabermos como a tela estava quando deu timeout
        os.makedirs("poc/scratch", exist_ok=True)
        await page.screenshot(path="poc/scratch/login_timeout.jpg", type="jpeg", quality=60)
        logger.info("Formulário de login não detectado (ou demorou mais de 30s). Veja poc/scratch/login_timeout.jpg. Prosseguindo...")
        return True
        
    logger.info("Iniciando auto-login para plataforma Senior X...")
    
    try:
        # Preencher email com um pequeno delay humano
        await page.wait_for_timeout(1000)
        await loc_user.fill(senior_user)
        await loc_user.press("Tab") # Dispara validações Angular
        
        # Pode ter um botão de "Próximo" ou ir direto para a senha.
        # Vamos tentar clicar no Próximo se existir e a senha não estiver visível.
        loc_pass = page.locator("input[type='password'], input[name='password']").first
        
        if not await loc_pass.is_visible():
            btn_proximo = page.locator("button:has-text('Próximo'), button:has-text('Avançar'), #next-button").first
            if await btn_proximo.is_visible():
                await btn_proximo.click()
                await page.wait_for_timeout(1000) # Aguardar animação/request
                
        # Tentar preencher a senha com delay
        await loc_pass.wait_for(state="visible", timeout=10000)
        await page.wait_for_timeout(1000)
        await loc_pass.fill(senior_pass)
        await loc_pass.press("Tab")
        
        # Clicar em autenticar
        await page.wait_for_timeout(500)
        btn_auth = page.locator("button:has-text('Autenticar'), button:has-text('Entrar'), button[type='submit']").first
        await btn_auth.click()
        
        # Esperar a navegação concluir (a URL deve mudar de /login para /senior-x etc)
        logger.info("Autenticação enviada. Aguardando carregamento do sistema (pode demorar)...")
        await page.wait_for_load_state("networkidle", timeout=15000)
        logger.info("Auto-login concluído com aparente sucesso!")
        return True
        
    except Exception as e:
        logger.error(f"Erro durante auto-login bruto: {e}")
        return False
