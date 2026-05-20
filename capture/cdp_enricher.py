import logging
from typing import Optional
from playwright.async_api import Page
from schemas import AXNode

logger = logging.getLogger(__name__)

async def enriquecer_com_ax(page: Page, x: int, y: int) -> Optional[AXNode]:
    """
    Consulta a AXTree via CDP para a coordenada (x, y) do clique.
    Retorna AXNode com role, name e states do elemento de acessibilidade.
    """
    cdp = None
    try:
        cdp = await page.context.new_cdp_session(page)
        
        # DOM.getNodeForLocation
        node_response = await cdp.send("DOM.getNodeForLocation", {
            "x": int(x),
            "y": int(y),
            "includeUserAgentShadowDOM": True
        })
        
        node_id = node_response.get("nodeId")
        if not node_id:
            logger.debug("CDP: nodeId não encontrado para localização.")
            return {}
            
        # Accessibility.queryAXTree
        ax_response = await cdp.send("Accessibility.queryAXTree", {
            "nodeId": node_id
        })
        
        nodes = ax_response.get("nodes", [])
        if not nodes:
            logger.debug("CDP: Nenhum nó de acessibilidade retornado.")
            return {}
            
        useless_roles = {"generic", "none", "presentation", "group", ""}
        
        for node in nodes:
            role = node.get("role", {}).get("value", "")
            if role not in useless_roles:
                name = node.get("name", {}).get("value", "")
                
                # Parse properties as states
                states = {}
                properties = node.get("properties", [])
                for prop in properties:
                    prop_name = prop.get("name")
                    prop_val = prop.get("value", {}).get("value")
                    if prop_name:
                        states[prop_name] = prop_val
                        
                return {
                    "ax_role": role,
                    "ax_name": name,
                    "ax_states": states
                }
                
        logger.debug("CDP: Nenhum AXNode útil encontrado após filtragem.")
        return {}
        
    except Exception as e:
        logger.warning(f"CDP Exception: {e}")
        return {}
    finally:
        if cdp:
            try:
                await cdp.detach()
            except Exception:
                pass
