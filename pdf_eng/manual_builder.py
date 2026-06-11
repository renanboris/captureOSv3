import logging
import io
import os
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Image, Spacer, Table, KeepTogether, Flowable, PageBreak
from reportlab.platypus.tables import TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constantes de layout e identidade visual
# ---------------------------------------------------------------------------

# Dimensões de página
APOSTILA_PAGESIZE = A4                   # 595.28 x 841.89 pt — retrato
PLAYBOOK_PAGESIZE = landscape(A4)        # 841.89 x 595.28 pt — paisagem

# Margens (usadas em ambos os layouts)
MARGIN = 2 * cm

# Limites de logo
LOGO_COVER_MAX_W = 5 * cm   # largura máxima da logo na capa
LOGO_COVER_MAX_H = 5 * cm   # altura máxima da logo na capa (proporção preservada)
LOGO_HEADER_MAX_H = 1 * cm  # altura máxima da logo no cabeçalho (largura calculada proporcionalmente)

# Cor principal da identidade visual
COR_PRINCIPAL = HexColor("#00998F")

# Layouts válidos
VALID_LAYOUTS = {"apostila", "playbook"}


# ---------------------------------------------------------------------------
# Funções puras auxiliares
# ---------------------------------------------------------------------------

def _scale_image(orig_w: float, orig_h: float, max_w: float, max_h: float) -> tuple:
    """
    Escala proporcional scale-down only — nunca amplia a imagem.

    Retorna (w, h) que cabem dentro de (max_w, max_h) preservando a proporção
    original. Se a imagem já couber nos limites, retorna as dimensões originais.
    """
    if orig_w <= 0 or orig_h <= 0:
        return (orig_w, orig_h)

    scale = min(max_w / orig_w, max_h / orig_h, 1.0)
    return (orig_w * scale, orig_h * scale)


def _validate_layout(layout: str) -> str:
    """
    Retorna o layout normalizado.

    Se o valor não estiver em VALID_LAYOUTS, loga um aviso e retorna "apostila"
    como fallback.
    """
    if layout not in VALID_LAYOUTS:
        logger.warning(f"Layout inválido '{layout}', usando 'apostila'")
        return "apostila"
    return layout


def _filter_step(passo: dict) -> bool:
    """
    Retorna True se o passo deve ser ignorado (sem conteúdo útil).

    - Passos especiais (0 e 999): ignorados quando `ancora` é vazio/nulo.
    - Passos regulares: ignorados quando tanto `ancora` quanto `micro_narracao`
      estão vazios ou compostos apenas de espaços.
    """
    num = passo.get("passo", 0)
    if _is_special_step(passo):
        ancora = (passo.get("ancora") or "").strip()
        return not ancora
    else:
        ancora = (passo.get("ancora") or "").strip()
        micro = (passo.get("micro_narracao") or "").strip()
        return not ancora and not micro


def _is_special_step(passo: dict) -> bool:
    """Retorna True para passo 0 (introdução) ou 999 (conclusão)."""
    num = passo.get("passo", 0)
    return num in (0, 999)


def _load_logo(logo_path: str | None, max_w: float, max_h: float) -> "Image | None":
    """
    Carrega a logo a partir de *logo_path*, redimensiona para caber dentro de
    (max_w, max_h) preservando a proporção e retorna um objeto
    ``reportlab.platypus.Image`` pronto para uso no documento.

    Comportamento por caso:
    - ``logo_path`` é ``None``            → retorna ``None`` silenciosamente.
    - Arquivo não encontrado              → loga warning + retorna ``None``.
    - Formato não suportado / ilegível    → loga warning com descrição + retorna ``None``.
    - Sucesso                             → retorna ``Image`` com as dimensões calculadas.
    """
    if logo_path is None:
        return None

    if not os.path.exists(logo_path):
        logger.warning(f"Logo não encontrada: {logo_path}")
        return None

    try:
        from PIL import Image as PILImage, UnidentifiedImageError

        pil_img = PILImage.open(logo_path)
        pil_img.verify()  # detecta arquivos corrompidos / formato não suportado
        # Após verify() o objeto é inutilizável; precisamos reabrir
        pil_img = PILImage.open(logo_path)
        orig_w, orig_h = pil_img.size
    except Exception as e:
        logger.warning(f"Logo não pôde ser carregada ({logo_path}): {type(e).__name__}: {e}")
        return None

    w, h = _scale_image(float(orig_w), float(orig_h), max_w, max_h)
    return Image(logo_path, width=w, height=h)


class _CoverPage(Flowable):
    """
    Flowable customizado que desenha a capa completa diretamente no canvas.

    Ocupa a altura total do frame disponível (toda a página útil), forçando
    uma quebra de página após si mesmo. O desenho é feito em coordenadas
    absolutas da página usando ``canv.translate`` para compensar o offset
    do frame do ReportLab.

    Layout da capa:
    - Barra decorativa superior em COR_PRINCIPAL
    - Título centralizado na região superior da capa
    - Logo (se disponível) abaixo do título, centralizada
    """

    # Dimensões fixas da capa (independentes do layout escolhido pelo doc)
    _PAGE_W, _PAGE_H = A4          # pontos

    # Barra superior
    _BAR_H = 1.2 * cm

    # Área do título: começa 3 cm abaixo do topo da página
    _TITLE_TOP  = _PAGE_H - 3 * cm   # coordenada Y do topo da área de título
    _TITLE_FONT = "Helvetica-Bold"
    _TITLE_SIZE = 24

    # Área da logo: centralizada verticalmente na metade superior da página
    _LOGO_Y_CENTER = _PAGE_H * 0.38   # centro Y da logo

    def __init__(self, titulo: str, logo_path: str | None):
        super().__init__()
        self.titulo = titulo
        self.logo_path = logo_path

    # --- Interface Flowable ---

    def wrap(self, availWidth, availHeight):
        """Reclama toda a altura disponível para forçar quebra de página após a capa."""
        # Guardar para uso no draw()
        self._avail_w = availWidth
        self._avail_h = availHeight
        return (availWidth, availHeight)

    def draw(self):
        """Desenha todos os elementos da capa em coordenadas absolutas de página."""
        canv = self.canv  # atributo injetado pelo reportlab antes de draw()

        # O ReportLab posiciona o flowable com a origem no canto inferior-esquerdo
        # do frame. Precisamos mover para o canto inferior-esquerdo da *página* para
        # usar coordenadas absolutas da capa A4.
        # O frame do SimpleDocTemplate tem origem em (leftMargin, bottomMargin).
        # Compensamos de volta para (0, 0) da página.
        x_offset = -MARGIN
        y_offset = -MARGIN

        canv.saveState()
        canv.translate(x_offset, y_offset)

        # 1. Barra decorativa superior
        canv.setFillColor(COR_PRINCIPAL)
        canv.rect(0, self._PAGE_H - self._BAR_H,
                  self._PAGE_W, self._BAR_H,
                  fill=1, stroke=0)

        # 2. Título centralizado na região superior
        canv.setFont(self._TITLE_FONT, self._TITLE_SIZE)
        canv.setFillColor(HexColor("#1a1a2e"))

        max_title_w = self._PAGE_W - 4 * cm
        title_y = self._TITLE_TOP - self._TITLE_SIZE  # baseline da primeira linha

        # Wrap simples: divide em linhas se necessário
        words = self.titulo.split()
        lines: list = []
        current = ""
        for word in words:
            test = (current + " " + word).strip()
            if canv.stringWidth(test, self._TITLE_FONT, self._TITLE_SIZE) <= max_title_w:
                current = test
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)

        line_gap = self._TITLE_SIZE * 1.3
        for i, line in enumerate(lines):
            line_w = canv.stringWidth(line, self._TITLE_FONT, self._TITLE_SIZE)
            x = (self._PAGE_W - line_w) / 2
            y = title_y - i * line_gap
            canv.drawString(x, y, line)

        canv.restoreState()

        # 3. Logo (se disponível)
        logo_img = _load_logo(self.logo_path, LOGO_COVER_MAX_W, LOGO_COVER_MAX_H)
        if logo_img is not None:
            logo_w = logo_img.drawWidth
            logo_h = logo_img.drawHeight
            logo_x = (self._PAGE_W - logo_w) / 2 + x_offset
            logo_y = self._LOGO_Y_CENTER - logo_h / 2 + y_offset
            canv.saveState()
            logo_img.drawOn(canv, logo_x, logo_y)
            canv.restoreState()


def _build_cover(titulo: str, logo_path: "str | None", styles) -> list:
    """
    Constrói os elementos da capa do PDF.

    Retorna uma lista contendo um único ``_CoverPage`` flowable, que ao ser
    renderizado ocupa exatamente uma página completa antes do conteúdo.

    Args:
        titulo:    Título do documento a exibir na capa.
        logo_path: Caminho para o arquivo de logo (PNG/JPEG) ou ``None``.
        styles:    Dicionário de estilos do reportlab (reservado para uso futuro).

    Returns:
        Lista com um elemento ``_CoverPage`` seguido de um ``PageBreak``.
    """
    return [_CoverPage(titulo, logo_path), PageBreak()]


def _build_apostila_elements(
    roteiro: list,
    styles: dict,
    logo_path: "str | None",
    logo_no_cabecalho: bool,
) -> list:
    """
    Constrói os elementos de conteúdo do layout Apostila (A4 retrato, vertical).

    Itera sobre os passos do roteiro, usando ``_filter_step`` para ignorar passos
    sem conteúdo. Os passos são renderizados em sequência vertical:

    - **Passo 0** (introdução): exibe ``ancora`` em largura total, sem screenshot
      nem label de número.
    - **Passo 999** (conclusão): exibe ``ancora`` em largura total, sem screenshot
      nem label de número.
    - **Passos regulares**: exibe label ``"Passo N"`` em COR_PRINCIPAL, seguido de
      ``ancora``, ``micro_narracao`` e screenshot redimensionado (se disponível).

    Args:
        roteiro:           Lista de dicionários com os passos do tutorial.
        styles:            Dicionário de estilos ReportLab (deve conter as chaves
                           ``"PassoNum"``, ``"Ancora"`` e ``"Narracao"``).
        logo_path:         Reservado para uso futuro (cabeçalho por página).
        logo_no_cabecalho: Reservado para uso futuro (ativa logo no cabeçalho).

    Returns:
        Lista de ``Flowable`` prontos para serem passados a ``doc.build()``.
    """
    elements: list = []

    # Largura útil: página A4 menos duas margens
    page_width = APOSTILA_PAGESIZE[0]
    max_img_w = page_width - 2 * MARGIN

    estilo_passo_num = styles.get("PassoNum")
    estilo_ancora = styles.get("Ancora")
    estilo_narracao = styles.get("Narracao")

    for passo in roteiro:
        # Ignorar passos sem conteúdo
        if _filter_step(passo):
            continue

        num = passo.get("passo", 0)

        if _is_special_step(passo):
            # Passo 0 (introdução) e passo 999 (conclusão):
            # exibe apenas a âncora em largura total, sem label nem screenshot.
            ancora = (passo.get("ancora") or "").strip()
            if ancora:
                elements.append(Paragraph(ancora, estilo_ancora))
                elements.append(Spacer(1, 0.3 * cm))
        else:
            # Passos regulares: label → âncora → narração → screenshot
            ancora = (passo.get("ancora") or "").strip()
            micro = (passo.get("micro_narracao") or "").strip()

            elements.append(Paragraph(f"Passo {num}", estilo_passo_num))

            if ancora:
                elements.append(Paragraph(ancora, estilo_ancora))
            if micro:
                elements.append(Paragraph(micro, estilo_narracao))

            # Screenshot (caminho local salvo em _simlink)
            simlink_data = passo.get("_simlink", {}) or {}
            screenshot_path = simlink_data.get("screenshot_path", "") or ""
            if screenshot_path and os.path.exists(screenshot_path):
                try:
                    from PIL import Image as PILImage
                    pil_img = PILImage.open(screenshot_path)
                    orig_w, orig_h = float(pil_img.width), float(pil_img.height)
                    img_w, img_h = _scale_image(orig_w, orig_h, max_img_w, orig_h)
                    elements.append(Image(screenshot_path, width=img_w, height=img_h))
                    elements.append(Spacer(1, 0.2 * cm))
                except Exception as e:
                    logger.warning(f"Screenshot do passo {num} não pôde ser inserido: {e}")

            elements.append(Spacer(1, 0.3 * cm))

    return elements


def _build_playbook_elements(
    roteiro: list,
    styles: dict,
    logo_path: "str | None",
    logo_no_cabecalho: bool,
) -> list:
    """
    Constrói os elementos de conteúdo do layout Playbook (A4 paisagem, grade 2 colunas).

    Passos regulares são organizados em uma grade de 2 colunas, preenchida da
    esquerda para a direita e de cima para baixo. Passos especiais (0 e 999) são
    renderizados em largura total da página, fora da grade, na posição em que
    aparecem no roteiro.

    Args:
        roteiro:           Lista de dicionários com os passos do tutorial.
        styles:            Dicionário de estilos ReportLab (deve conter as chaves
                           ``"PassoNum"``, ``"Ancora"`` e ``"Narracao"``).
        logo_path:         Reservado para uso futuro (cabeçalho por página).
        logo_no_cabecalho: Reservado para uso futuro (ativa logo no cabeçalho).

    Returns:
        Lista de ``Flowable`` prontos para serem passados a ``doc.build()``.
    """
    elements: list = []

    # Largura útil de cada célula: metade da largura utilizável da página paisagem
    # menos padding interno de 0,5 cm entre as colunas.
    page_width = PLAYBOOK_PAGESIZE[0]
    max_img_w = (page_width - 2 * MARGIN) / 2 - 0.5 * cm

    # Largura total para elementos de largura inteira (passos especiais)
    full_width = page_width - 2 * MARGIN

    estilo_passo_num = styles.get("PassoNum")
    estilo_ancora = styles.get("Ancora")
    estilo_narracao = styles.get("Narracao")

    # Coleta de passos regulares em espera, prontos para serem emitidos em pares.
    # Quando um passo especial é encontrado, primeiro despejamos a grade pendente,
    # depois emitimos o passo especial em largura total, mantendo a ordem do roteiro.
    pending_regular: list = []

    def _flush_regular_grid() -> None:
        """Despeja os passos regulares acumulados como linhas de uma Table 2 colunas."""
        if not pending_regular:
            return

        col_w = (page_width - 2 * MARGIN) / 2

        rows = []
        for i in range(0, len(pending_regular), 2):
            left = pending_regular[i]
            right = pending_regular[i + 1] if i + 1 < len(pending_regular) else ""
            rows.append([left, right])

        tbl = Table(rows, colWidths=[col_w, col_w])
        tbl.setStyle(TableStyle([
            ("VALIGN",        (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING",   (0, 0), (-1, -1), 4),
            ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
            ("TOPPADDING",    (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(tbl)
        pending_regular.clear()

    for passo in roteiro:
        # Ignorar passos sem conteúdo
        if _filter_step(passo):
            continue

        num = passo.get("passo", 0)

        if _is_special_step(passo):
            # Antes do passo especial, emite a grade de regulares acumulados
            _flush_regular_grid()

            # Passo especial em largura total (sem label nem screenshot)
            ancora = (passo.get("ancora") or "").strip()
            if ancora:
                elements.append(Paragraph(ancora, estilo_ancora))
                elements.append(Spacer(1, 0.3 * cm))
        else:
            # Passo regular: monta um KeepTogether com label, ancora, narração e screenshot
            cell_elements: list = []

            ancora = (passo.get("ancora") or "").strip()
            micro = (passo.get("micro_narracao") or "").strip()

            cell_elements.append(Paragraph(f"Passo {num}", estilo_passo_num))

            if ancora:
                cell_elements.append(Paragraph(ancora, estilo_ancora))
            if micro:
                cell_elements.append(Paragraph(micro, estilo_narracao))

            # Screenshot redimensionado para caber na célula
            simlink_data = passo.get("_simlink", {}) or {}
            screenshot_path = simlink_data.get("screenshot_path", "") or ""
            if screenshot_path and os.path.exists(screenshot_path):
                try:
                    from PIL import Image as PILImage
                    pil_img = PILImage.open(screenshot_path)
                    orig_w, orig_h = float(pil_img.width), float(pil_img.height)
                    img_w, img_h = _scale_image(orig_w, orig_h, max_img_w, orig_h)
                    cell_elements.append(Image(screenshot_path, width=img_w, height=img_h))
                    cell_elements.append(Spacer(1, 0.2 * cm))
                except Exception as e:
                    logger.warning(f"Screenshot do passo {num} não pôde ser inserido: {e}")

            pending_regular.append(cell_elements)

    # Esvazia quaisquer passos regulares restantes ao final do roteiro
    _flush_regular_grid()

    return elements


def _make_header_callback(logo_path: "str | None"):
    """
    Retorna um callback ``onPage`` que desenha a logo no cabeçalho de cada página.

    O callback resultante é passado a ``SimpleDocTemplate.build()`` via
    ``onFirstPage`` e ``onLaterPages``. Caso ``logo_path`` seja ``None`` ou
    aponte para um arquivo inexistente / ilegível, o callback retorna
    silenciosamente sem desenhar nada.

    Args:
        logo_path: Caminho para o arquivo PNG/JPEG da logo, ou ``None``.

    Returns:
        Função ``_build_header_canvas(canvas, doc)`` pronta para uso como
        callback ``onPage`` do reportlab.
    """
    def _build_header_canvas(canvas, doc):
        # Tenta carregar a logo respeitando LOGO_HEADER_MAX_H como limite de
        # altura; a largura é calculada proporcionalmente por _scale_image.
        logo_img = _load_logo(logo_path, 10 * cm, LOGO_HEADER_MAX_H)
        if logo_img is None:
            return

        page_w = doc.pagesize[0]
        page_h = doc.pagesize[1]

        # Canto superior-direito, logo dentro da margem superior
        x = page_w - MARGIN - logo_img.drawWidth
        y = page_h - MARGIN / 2 - logo_img.drawHeight

        canvas.saveState()
        logo_img.drawOn(canvas, x, y)
        canvas.restoreState()

    return _build_header_canvas


def gerar_pdf(
    roteiro: list,
    output_path: str,
    titulo: str = "Tutorial Gerado pelo CaptureOS",
    *,
    layout: str = "apostila",
    logo_path: str | None = None,
    logo_no_cabecalho: bool = False,
) -> bool:
    """
    Gera apostila PDF com screenshots + texto de cada passo.
    Usa o roteiro enriquecido (com ancora + micro_narracao) e as imagens locais.

    Args:
        roteiro:          Lista de dicionários com os passos do tutorial.
        output_path:      Caminho do arquivo PDF de saída.
        titulo:           Título do documento (exibido na capa).
        layout:           "apostila" (padrão) ou "playbook". Valor inválido
                          faz fallback para "apostila" com aviso no log.
        logo_path:        Caminho para arquivo PNG/JPEG da logo. None = sem logo.
        logo_no_cabecalho: Se True e logo_path válido, exibe a logo no
                          cabeçalho de cada página de conteúdo.

    Returns:
        True  — PDF gravado com sucesso.
        False — titulo vazio, ou qualquer exceção durante a geração.
    """
    if not titulo.strip():
        logger.error("Título não pode ser vazio ou composto apenas de espaços em branco")
        return False

    try:
        # 1. Normalizar o layout (fallback para "apostila" se inválido)
        layout = _validate_layout(layout)

        # 2. Escolher o tamanho de página conforme o layout
        if layout == "playbook":
            pagesize = PLAYBOOK_PAGESIZE
        else:
            pagesize = APOSTILA_PAGESIZE

        # 3. Criar o documento com o pagesize e margens definidas
        doc = SimpleDocTemplate(
            output_path,
            pagesize=pagesize,
            leftMargin=MARGIN,
            rightMargin=MARGIN,
            topMargin=MARGIN,
            bottomMargin=MARGIN,
        )

        # 4. Construir o dicionário de estilos
        styles = getSampleStyleSheet()
        estilo_titulo = ParagraphStyle(
            'Titulo', parent=styles['Heading1'],
            fontSize=18, textColor=HexColor('#1a1a2e'), spaceAfter=16,
        )
        estilo_secao_titulo = ParagraphStyle(
            'SecaoTitulo', parent=styles['Heading2'],
            fontSize=14, textColor=COR_PRINCIPAL,
            spaceBefore=12, spaceAfter=8,
        )
        estilo_ancora = ParagraphStyle(
            'Ancora', parent=styles['Normal'],
            fontSize=11, textColor=COR_PRINCIPAL,
            spaceBefore=8, spaceAfter=4, fontName='Helvetica-Bold',
        )
        estilo_narracao = ParagraphStyle(
            'Narracao', parent=styles['Normal'],
            fontSize=10, textColor=HexColor('#374151'),
            spaceAfter=10, leading=14,
        )
        estilo_passo_num = ParagraphStyle(
            'PassoNum', parent=styles['Normal'],
            fontSize=9, textColor=COR_PRINCIPAL,
            spaceBefore=12,
        )

        # 5. Mapa de estilos para as funções de builder
        styles_map = {
            "PassoNum": estilo_passo_num,
            "Ancora": estilo_ancora,
            "Narracao": estilo_narracao,
        }

        # 6. Construir a lista de flowables: capa + elementos de conteúdo
        cover_elements = _build_cover(titulo, logo_path, styles_map)
        if layout == "playbook":
            content_elements = _build_playbook_elements(
                roteiro, styles_map, logo_path, logo_no_cabecalho
            )
        else:
            content_elements = _build_apostila_elements(
                roteiro, styles_map, logo_path, logo_no_cabecalho
            )
        elements = cover_elements + content_elements

        # 7. Compilar o documento; adicionar callbacks de cabeçalho se solicitado
        if logo_no_cabecalho:
            header_cb = _make_header_callback(logo_path)
            doc.build(elements, onFirstPage=header_cb, onLaterPages=header_cb)
        else:
            doc.build(elements)

        # 8. Registrar sucesso e retornar
        logger.info(f"PDF gerado: {output_path}")
        return True

    except Exception as e:
        logger.error(f"Erro ao gerar PDF: {type(e).__name__}: {e}")
        return False
