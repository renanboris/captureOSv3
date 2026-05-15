"""
tests/unit/test_get_locator.py

Testa a função get_locator do poc_executor para todos os
prefixos de iframe_hint que o radar_v3.js pode emitir:
  fp:name=   fp:id=   fp:title=   fp:src=   fp:index=
  'Pagina Principal' (sem iframe)
  string vazia (sem iframe)
"""
import pytest
from unittest.mock import MagicMock, patch
from poc_executor import get_locator


def make_page_mock():
    """Cria um mock de Page com locator e frame_locator simulados."""
    page = MagicMock()
    page.locator.return_value = MagicMock(name="DirectLocator")
    
    frame_loc = MagicMock(name="FrameLocator")
    frame_loc.locator.return_value = MagicMock(name="FrameInnerLocator")
    frame_loc.nth.return_value = frame_loc  # frame_locator().nth() → FrameLocator
    page.frame_locator.return_value = frame_loc
    return page


class TestGetLocatorSemIframe:

    def test_sem_iframe_hint(self):
        """iframe_hint ausente → usa page.locator() diretamente."""
        page = make_page_mock()
        evento = {"iframe_hint": None}
        result = get_locator(page, evento, "button#salvar")
        page.locator.assert_called_once_with("button#salvar")
        assert result is page.locator.return_value

    def test_pagina_principal(self):
        """iframe_hint='Pagina Principal' → usa page.locator() diretamente."""
        page = make_page_mock()
        evento = {"iframe_hint": "Pagina Principal"}
        result = get_locator(page, evento, "[aria-label='OK']")
        page.locator.assert_called_once_with("[aria-label='OK']")
        assert result is page.locator.return_value

    def test_string_vazia(self):
        """iframe_hint='' → usa page.locator() diretamente."""
        page = make_page_mock()
        evento = {"iframe_hint": ""}
        get_locator(page, evento, "input[name='email']")
        page.locator.assert_called_once()


class TestGetLocatorComIframe:

    def test_fp_name(self):
        """fp:name=myframe → frame_locator("iframe[name='myframe']")."""
        page = make_page_mock()
        evento = {"iframe_hint": "fp:name=myframe"}
        get_locator(page, evento, ".ui-table")
        page.frame_locator.assert_called_once_with("iframe[name='myframe']")
        page.frame_locator.return_value.locator.assert_called_once_with(".ui-table")

    def test_fp_id(self):
        """fp:id=ged-frame → frame_locator("iframe[id='ged-frame']")."""
        page = make_page_mock()
        evento = {"iframe_hint": "fp:id=ged-frame"}
        get_locator(page, evento, "button")
        page.frame_locator.assert_called_once_with("iframe[id='ged-frame']")

    def test_fp_title(self):
        """fp:title=GED → frame_locator("iframe[title='GED']")."""
        page = make_page_mock()
        evento = {"iframe_hint": "fp:title=GED"}
        get_locator(page, evento, "tr")
        page.frame_locator.assert_called_once_with("iframe[title='GED']")

    def test_fp_src(self):
        """fp:src=ecm_ged → frame_locator("iframe[src*='ecm_ged']")."""
        page = make_page_mock()
        evento = {"iframe_hint": "fp:src=ecm_ged"}
        get_locator(page, evento, "td")
        page.frame_locator.assert_called_once_with("iframe[src*='ecm_ged']")

    def test_fp_index(self):
        """fp:index=2 → frame_locator("iframe").nth(2)."""
        page = make_page_mock()
        frame_loc = page.frame_locator.return_value
        evento = {"iframe_hint": "fp:index=2"}
        get_locator(page, evento, "input")
        page.frame_locator.assert_called_once_with("iframe")
        frame_loc.nth.assert_called_once_with(2)

    def test_fallback_desconhecido(self):
        """iframe_hint com prefixo desconhecido → fallback para page.locator()."""
        page = make_page_mock()
        evento = {"iframe_hint": "fp:unknown=xyz"}
        get_locator(page, evento, "span")
        # Nenhum frame_locator deve ser criado
        page.frame_locator.assert_not_called()
        page.locator.assert_called_once_with("span")

    def test_seletor_passado_corretamente(self):
        """O seletor passado deve ser repassado para o locator interno sem modificação."""
        page = make_page_mock()
        seletor = "tr:has-text(\"Financeiro\") >> text=\"Financeiro\""
        evento = {"iframe_hint": "fp:name=ged"}
        get_locator(page, evento, seletor)
        page.frame_locator.return_value.locator.assert_called_once_with(seletor)
