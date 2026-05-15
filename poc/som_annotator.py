import io
import logging
from typing import List, Optional
from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import Page
from schemas import SoMBox

logger = logging.getLogger(__name__)

async def get_som_boxes(page: Page) -> List[SoMBox]:
    """
    Consulta o DOM para obter bounding boxes de todos os elementos interativos visíveis.
    """
    script = """
    () => {
        const SELECTORS = [
            'button:not([disabled])',
            'a[href]',
            'input:not([type="hidden"]):not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[role="button"]:not([aria-disabled="true"])',
            '[role="menuitem"]',
            '[role="tab"]',
            '[role="checkbox"]',
            '[role="combobox"]',
            '[role="option"]',
            'p-button button',
            'p-dropdown .ui-dropdown-label',
            'p-checkbox .ui-chkbox-box',
            '.ui-inputswitch-slider'
        ];
        
        const elements = document.querySelectorAll(SELECTORS.join(', '));
        const boxes = [];
        
        elements.forEach(el => {
            // Check if descendant of aria-hidden
            let cur = el;
            let isHidden = false;
            while(cur) {
                if(cur.getAttribute && cur.getAttribute('aria-hidden') === 'true') {
                    isHidden = true;
                    break;
                }
                cur = cur.parentElement;
            }
            if (isHidden) return;
            
            const rect = el.getBoundingClientRect();
            if (rect.width >= 8 && rect.height >= 8 && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= window.innerWidth + 20) {
                boxes.push({
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                    role: el.tagName.toLowerCase(),
                    label: (el.getAttribute('aria-label') || el.innerText || '').substring(0, 30).trim()
                });
            }
        });
        
        return boxes;
    }
    """
    try:
        raw_boxes = await page.evaluate(script)
        # Sort by y, then x
        raw_boxes.sort(key=lambda b: (b['y'], b['x']))
        
        # Take max 80 and assign idx
        som_boxes = []
        for idx, b in enumerate(raw_boxes[:80]):
            som_boxes.append({
                "idx": idx,
                "x": b["x"],
                "y": b["y"],
                "w": b["w"],
                "h": b["h"],
                "role": b["role"],
                "label": b["label"]
            })
        return som_boxes
    except Exception as e:
        logger.warning(f"Erro em get_som_boxes: {e}")
        return []

def anotar_imagem(screenshot_bytes: bytes, boxes: List[SoMBox]) -> bytes:
    """
    Desenha bounding boxes numeradas na imagem usando PIL.
    """
    try:
        img = Image.open(io.BytesIO(screenshot_bytes))
        img = img.convert("RGB")
        draw = ImageDraw.Draw(img)
        
        try:
            # Fallback for font if default is too small or unavailable
            font = ImageFont.load_default()
        except:
            font = None

        red_color = "#FF3B30"
        
        for box in boxes:
            x, y, w, h = box["x"], box["y"], box["w"], box["h"]
            idx = str(box["idx"])
            
            # Draw rectangle
            draw.rectangle([x, y, x + w, y + h], outline=red_color, width=2)
            
            # Draw badge
            # Calculate text size for badge width
            # load_default doesn't have getbbox in old PIL, fallback to getsize if needed
            # For modern Pillow (>=10), getbbox is used.
            if hasattr(font, 'getbbox'):
                bbox = font.getbbox(idx)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
            else:
                tw, th = 8 * len(idx), 11 # rough estimate
            
            badge_w = max(20, tw + 4)
            badge_h = max(14, th + 4)
            
            # Badge background
            draw.rectangle([x, y, x + badge_w, y + badge_h], fill=red_color)
            
            # Badge text
            draw.text((x + 2, y + 1), idx, fill="white", font=font)
            
        out_bytes = io.BytesIO()
        img.save(out_bytes, format="JPEG", quality=82)
        return out_bytes.getvalue()
    except Exception as e:
        logger.warning(f"Erro ao anotar imagem: {e}")
        return screenshot_bytes

def identificar_box_clicada(boxes: List[SoMBox], x: int, y: int) -> Optional[int]:
    """
    Dado o (x, y) do clique e a lista de boxes, retorna o idx da box.
    Em caso de overlap, retorna a menor (mais específica).
    """
    contains = []
    for box in boxes:
        bx, by, bw, bh = box["x"], box["y"], box["w"], box["h"]
        if bx <= x <= bx + bw and by <= y <= by + bh:
            contains.append(box)
            
    if not contains:
        return None
        
    # Sort by area (w * h) ascending to get the most specific
    contains.sort(key=lambda b: b["w"] * b["h"])
    return contains[0]["idx"]
