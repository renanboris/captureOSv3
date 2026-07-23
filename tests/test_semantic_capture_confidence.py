import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

def test_radar_v3_contains_eh_id_posicional():
    radar_content = (REPO_ROOT / "extension" / "content_scripts" / "radar_v3.js").read_text(encoding="utf-8")
    assert "function ehIdPosicional(id)" in radar_content
    assert "function extrairSegmentoAncora(text)" in radar_content
    assert "function isUrlMatch(expectedUrl)" in radar_content

def test_positional_id_regex():
    # Helper to test the python equivalent regex logic from radar_v3.js
    pos_id_pattern = r'[-_](item[-_]?)?\d+$|^(menu|item|row|col|list)[-_]?\d+$'
    
    assert re.search(pos_id_pattern, "apps-menu-item-0", re.IGNORECASE) is not None
    assert re.search(pos_id_pattern, "grid_row_12", re.IGNORECASE) is not None
    assert re.search(pos_id_pattern, "item_5", re.IGNORECASE) is not None
    assert re.search(pos_id_pattern, "btn_submit", re.IGNORECASE) is None
    assert re.search(pos_id_pattern, "save_button", re.IGNORECASE) is None

def test_segment_extraction():
    multiline_text = "Abrir submenu Gestão de Pátio\nGestão de Pátio\nGrupo de menus Gestão de Pátio"
    first_line = multiline_text.split('\n')[0].strip()
    assert first_line == "Abrir submenu Gestão de Pátio"
    assert len(first_line) < 50
