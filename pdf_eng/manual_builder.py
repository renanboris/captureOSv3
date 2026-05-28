import logging
import io
import os
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Image, Spacer, Table
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor

logger = logging.getLogger(__name__)

def gerar_pdf(roteiro: list, output_path: str, titulo: str = "Tutorial Gerado pelo CaptureOS") -> bool:
    """
    Gera apostila PDF com screenshots + texto de cada passo.
    Usa o roteiro enriquecido (com ancora + micro_narracao) e as imagens locais.
    """
    try:
        from PIL import Image as PILImage
        
        doc = SimpleDocTemplate(output_path, pagesize=A4,
                                leftMargin=2*cm, rightMargin=2*cm,
                                topMargin=2*cm, bottomMargin=2*cm)
        styles = getSampleStyleSheet()
        
        # Estilos customizados
        estilo_titulo = ParagraphStyle('Titulo', parent=styles['Heading1'],
                                       fontSize=18, textColor=HexColor('#1a1a2e'), spaceAfter=16)
        estilo_ancora = ParagraphStyle('Ancora', parent=styles['Normal'],
                                       fontSize=11, textColor=HexColor('#2d6a4f'),
                                       spaceBefore=8, spaceAfter=4, fontName='Helvetica-Bold')
        estilo_narracao = ParagraphStyle('Narracao', parent=styles['Normal'],
                                         fontSize=10, textColor=HexColor('#374151'),
                                         spaceAfter=10, leading=14)
        estilo_passo_num = ParagraphStyle('PassoNum', parent=styles['Normal'],
                                           fontSize=9, textColor=HexColor('#6b7280'),
                                           spaceBefore=12)

        elements = [Paragraph(titulo, estilo_titulo), Spacer(1, 0.3*cm)]

        for passo in roteiro:
            num = passo.get("passo", 0)
            if num in (0, 999):  # intro e conclusão sem screenshot
                ancora = passo.get("ancora", "")
                if ancora:
                    elements.append(Paragraph(ancora, estilo_ancora))
                continue

            elements.append(Paragraph(f"Passo {num}", estilo_passo_num))

            # Screenshot (caminho local salvo em _simlink)
            simlink_data = passo.get("_simlink", {})
            screenshot_path = simlink_data.get("screenshot_path", "")
            if screenshot_path and os.path.exists(screenshot_path):
                try:
                    pil_img = PILImage.open(screenshot_path)
                    max_w = 15 * cm
                    ratio = max_w / pil_img.width
                    img_h = pil_img.height * ratio
                    elements.append(Image(screenshot_path, width=max_w, height=img_h))
                    elements.append(Spacer(1, 0.2*cm))
                except Exception as e:
                    logger.warning(f"Screenshot do passo {num} não pôde ser inserido: {e}")

            ancora = passo.get("ancora", "")
            micro = passo.get("micro_narracao", "")
            if ancora:
                elements.append(Paragraph(ancora, estilo_ancora))
            if micro:
                elements.append(Paragraph(micro, estilo_narracao))

        doc.build(elements)
        logger.info(f"PDF gerado: {output_path}")
        return True

    except Exception as e:
        logger.error(f"Erro ao gerar PDF: {e}")
        return False
