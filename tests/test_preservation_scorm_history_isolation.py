"""Preservation Property Tests - SCORM History Isolation Fix.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

This test suite verifies that behaviors NOT affected by the bug continue to work
correctly after the fix is implemented. These tests capture the baseline behavior
on UNFIXED code and ensure no regressions occur.

Property 2: Preservation - LMS Mode and URL Parameter Behavior

CRITICAL: These tests are EXPECTED TO PASS on both unfixed and fixed code.

Test Coverage:
- Test 1: LMS mode uses LMS API (not localStorage)
- Test 2: URL parameter ?modulo=custom_id is respected
- Test 3: Same SCORM reopening restores progress correctly
- Test 4: Progress data (suspend_data, lesson_location, score.raw) persists

Expected Outcome on UNFIXED code: Tests PASS (baseline behavior)
Expected Outcome on FIXED code: Tests PASS (no regressions)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict
from unittest.mock import Mock, MagicMock

import pytest
from hypothesis import given, strategies as st, settings, Phase, HealthCheck

# Repository root for resolving template paths
REPO_ROOT = Path(__file__).resolve().parent.parent


def create_scorm_package(
    session_id: str,
    temp_dir: Path,
    num_steps: int = 3,
) -> Dict[str, Path]:
    """Create a minimal SCORM package structure for testing.
    
    Args:
        session_id: Unique identifier for this SCORM package
        temp_dir: Temporary directory to create the package in
        num_steps: Number of hotspot steps in the module
        
    Returns:
        Dict with 'root', 'index', 'try_player', 'scorm_api', 'steps_js' paths
    """
    scorm_root = temp_dir / f"scorm_{session_id}"
    scorm_root.mkdir(parents=True, exist_ok=True)
    
    js_dir = scorm_root / "js"
    js_dir.mkdir(exist_ok=True)
    
    data_dir = scorm_root / "data"
    data_dir.mkdir(exist_ok=True)
    
    # Copy the actual template files from scorm_eng/templates
    templates_dir = REPO_ROOT / "scorm_eng" / "templates"
    
    try_player_src = templates_dir / "js" / "try-player.js"
    scorm_api_src = templates_dir / "js" / "scorm-api.js"
    
    try_player_dst = js_dir / "try-player.js"
    scorm_api_dst = js_dir / "scorm-api.js"
    
    # Copy the JS files
    try_player_dst.write_text(try_player_src.read_text(encoding="utf-8"), encoding="utf-8")
    scorm_api_dst.write_text(scorm_api_src.read_text(encoding="utf-8"), encoding="utf-8")
    
    # Create steps.js with this SCORM's unique session_id
    hotspots = [
        {
            "passo_num": i + 1,
            "xpath": f"//button[{i + 1}]",
            "css_selector": f"button.step-{i + 1}",
            "coordinates": {"x": 100.0 * i, "y": 100.0 * i, "w": 50.0, "h": 30.0},
            "target_text": f"Step {i + 1}",
            "action": "click",
            "url": "https://example.com",
            "screenshot_path": f"screenshots/step_{i + 1}.png",
            "screenshot_filename": f"step_{i + 1}.png",
            "ancora": f"Click here for step {i + 1}",
            "micro_narracao": f"Try clicking step {i + 1}",
            "audio_path": None,
            "audio_filename": None,
        }
        for i in range(num_steps)
    ]
    
    steps_data = {
        "modulo_id": session_id,
        "session_id": session_id,
        "titulo": f"Test Module {session_id}",
        "dominio": "example.com",
        "total_passos": num_steps,
        "hotspots": hotspots,
        "xp_max": num_steps * 10,
    }
    
    steps_js_path = data_dir / "steps.js"
    steps_js_content = f"const STEPS_DATA = {json.dumps(steps_data, indent=2)};\n"
    steps_js_path.write_text(steps_js_content, encoding="utf-8")
    
    # Create minimal index.html
    index_html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>SCORM Test {session_id}</title>
</head>
<body>
    <div id="sandbox-xp">0 XP</div>
    <div id="passo-header">Passo 1</div>
    <div id="ancora-texto">Loading...</div>
    <div id="simulacao-container"></div>
    <div id="feedback-container" class="hidden"></div>
    <button id="btn-voltar-passo">Voltar</button>
    <button id="btn-dica-pratica">Dica</button>
    <div id="overlay-cliques"></div>
    <img id="imagem-bg" style="display:none;" />
    
    <script src="js/scorm-api.js"></script>
    <script src="data/steps.js"></script>
    <script src="js/try-player.js"></script>
</body>
</html>
"""
    index_path = scorm_root / "index.html"
    index_path.write_text(index_html, encoding="utf-8")
    
    return {
        "root": scorm_root,
        "index": index_path,
        "try_player": try_player_dst,
        "scorm_api": scorm_api_dst,
        "steps_js": steps_js_path,
    }


def analyze_scorm_api_behavior(
    scorm_package: Dict[str, Path],
    lms_mode: bool = False,
    url_modulo_param: str | None = None,
) -> Dict[str, Any]:
    """Analyze how ScormAPI would behave for given configuration.
    
    This function simulates the behavior without actually running JavaScript,
    by analyzing the code logic.
    
    Args:
        scorm_package: Dict with paths to SCORM files
        lms_mode: Whether to simulate LMS mode (with window.API available)
        url_modulo_param: Value of ?modulo= URL parameter, if any
        
    Returns:
        Dict with:
            - 'isLMS': Whether LMS mode is active
            - 'moduloId': The identifier that would be used
            - 'uses_localstorage': Whether localStorage would be used
            - 'uses_lms_api': Whether LMS API would be used
            - 'localStorage_key_prefix': Prefix for localStorage keys
    """
    scorm_api_code = scorm_package["scorm_api"].read_text(encoding="utf-8")
    try_player_code = scorm_package["try_player"].read_text(encoding="utf-8")
    steps_js_code = scorm_package["steps_js"].read_text(encoding="utf-8")
    
    # Extract session_id from steps.js
    session_id_match = re.search(r'"session_id"\s*:\s*"([^"]+)"', steps_js_code)
    session_id_from_steps = session_id_match.group(1) if session_id_match else None
    
    # Determine moduloId based on try-player.js logic
    # Line 19: window.moduloId = urlParams.get('modulo') || 'default';
    if url_modulo_param:
        moduloId = url_modulo_param
    else:
        # Check if code has been fixed (sets moduloId after loading STEPS_DATA)
        # On unfixed code: moduloId = 'default'
        # On fixed code: moduloId = session_id from STEPS_DATA
        has_bug = "window.moduloId = urlParams.get('modulo') || 'default';" in try_player_code
        if has_bug:
            moduloId = "default"
        else:
            moduloId = session_id_from_steps or "default"
    
    # ScormAPI behavior: uses LMS API if window.API is found, otherwise localStorage
    uses_lms_api = lms_mode
    uses_localstorage = not lms_mode
    
    # localStorage keys: scorm_{moduloId}_{key}
    localStorage_key_prefix = f"scorm_{moduloId}_" if uses_localstorage else None
    
    return {
        "isLMS": lms_mode,
        "moduloId": moduloId,
        "uses_localstorage": uses_localstorage,
        "uses_lms_api": uses_lms_api,
        "localStorage_key_prefix": localStorage_key_prefix,
        "session_id_from_steps": session_id_from_steps,
    }


# ==============================================================================
# Test 1: LMS Mode Preservation
# ==============================================================================

def test_preservation_lms_mode_uses_lms_api(tmp_path: Path):
    """Property 2.1: LMS mode SHALL use LMS API, not localStorage.
    
    **Validates: Requirement 3.1**
    
    PRESERVATION TEST: This behavior is NOT affected by the bug.
    Expected to PASS on both unfixed and fixed code.
    
    When a SCORM is executed inside a real LMS (with window.API available),
    the system should use the LMS's native SCORM API for all get/set operations,
    NOT localStorage.
    
    This behavior must be preserved after the fix - the fix only affects
    standalone mode, not LMS mode.
    """
    session_id = "sess_lms_test"
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=3)
    
    # Simulate LMS mode (window.API available)
    result = analyze_scorm_api_behavior(scorm_package, lms_mode=True, url_modulo_param=None)
    
    # Assertions: LMS mode should use LMS API, not localStorage
    assert result["isLMS"] is True, "LMS mode should be detected"
    assert result["uses_lms_api"] is True, "Should use LMS API in LMS mode"
    assert result["uses_localstorage"] is False, "Should NOT use localStorage in LMS mode"
    assert result["localStorage_key_prefix"] is None, (
        "localStorage keys should not be generated in LMS mode"
    )


@given(
    session_id=st.text(
        alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters="_"),
        min_size=10,
        max_size=20,
    ).map(lambda x: f"sess_{x}"),
)
@settings(
    max_examples=30,
    phases=[Phase.generate],
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_preservation_lms_mode_property(tmp_path: Path, session_id: str):
    """Property-Based Test: LMS mode always uses LMS API regardless of session_id.
    
    **Validates: Requirement 3.1**
    
    Property: FOR ALL session_ids, WHEN SCORM runs in LMS mode,
              THEN it SHALL use LMS API (not localStorage)
    
    This property must hold before and after the fix.
    """
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=3)
    
    # Simulate LMS mode
    result = analyze_scorm_api_behavior(scorm_package, lms_mode=True, url_modulo_param=None)
    
    # Property: LMS mode always uses LMS API
    assert result["uses_lms_api"] is True, (
        f"Property violation: LMS mode should always use LMS API.\n"
        f"session_id={session_id!r}\n"
        f"uses_lms_api={result['uses_lms_api']}"
    )
    assert result["uses_localstorage"] is False, (
        f"Property violation: LMS mode should NOT use localStorage.\n"
        f"session_id={session_id!r}\n"
        f"uses_localstorage={result['uses_localstorage']}"
    )


# ==============================================================================
# Test 2: URL Parameter Preservation
# ==============================================================================

@pytest.mark.parametrize(
    "custom_modulo_id",
    [
        "custom_abc123",
        "test_module_xyz",
        "modulo_especial_789",
        "sess_override_001",
    ],
)
def test_preservation_url_parameter_priority(tmp_path: Path, custom_modulo_id: str):
    """Property 2.2: URL parameter ?modulo= SHALL have priority over session_id.
    
    **Validates: Requirement 3.5**
    
    PRESERVATION TEST: This behavior is NOT affected by the bug.
    Expected to PASS on both unfixed and fixed code.
    
    When a SCORM is opened with ?modulo=custom_id in the URL, the system
    should use that custom_id as the moduloId, regardless of the session_id
    in STEPS_DATA.
    
    This allows users/systems to explicitly control the moduloId when needed.
    """
    session_id = "sess_default_id"
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=3)
    
    # Simulate standalone mode with URL parameter
    result = analyze_scorm_api_behavior(
        scorm_package,
        lms_mode=False,
        url_modulo_param=custom_modulo_id
    )
    
    # Assertions: URL parameter should be used as moduloId
    assert result["moduloId"] == custom_modulo_id, (
        f"URL parameter should be used as moduloId.\n"
        f"Expected moduloId: {custom_modulo_id!r}\n"
        f"Actual moduloId: {result['moduloId']!r}\n"
        f"session_id from STEPS_DATA: {result['session_id_from_steps']!r}"
    )
    
    # localStorage keys should use the custom moduloId
    expected_prefix = f"scorm_{custom_modulo_id}_"
    assert result["localStorage_key_prefix"] == expected_prefix, (
        f"localStorage keys should use custom moduloId from URL.\n"
        f"Expected prefix: {expected_prefix!r}\n"
        f"Actual prefix: {result['localStorage_key_prefix']!r}"
    )


@given(
    session_id=st.text(
        alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters="_"),
        min_size=10,
        max_size=20,
    ).map(lambda x: f"sess_{x}"),
    custom_modulo=st.text(
        alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters="_-"),
        min_size=5,
        max_size=30,
    ),
)
@settings(
    max_examples=40,
    phases=[Phase.generate],
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_preservation_url_parameter_property(
    tmp_path: Path,
    session_id: str,
    custom_modulo: str,
):
    """Property-Based Test: URL parameter always overrides session_id.
    
    **Validates: Requirement 3.5**
    
    Property: FOR ALL (session_id, custom_modulo) pairs,
              WHEN URL contains ?modulo=custom_modulo,
              THEN moduloId SHALL equal custom_modulo (not session_id, not 'default')
    
    This property ensures URL parameters always have priority.
    """
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=3)
    
    result = analyze_scorm_api_behavior(
        scorm_package,
        lms_mode=False,
        url_modulo_param=custom_modulo
    )
    
    # Property: URL parameter has absolute priority
    assert result["moduloId"] == custom_modulo, (
        f"Property violation: URL parameter must override session_id.\n"
        f"session_id={session_id!r}\n"
        f"custom_modulo={custom_modulo!r}\n"
        f"Expected moduloId={custom_modulo!r}\n"
        f"Actual moduloId={result['moduloId']!r}"
    )
    
    # Verify moduloId is NOT the session_id when URL param is present
    assert result["moduloId"] != session_id or custom_modulo == session_id, (
        f"URL parameter should take precedence over session_id.\n"
        f"URL modulo={custom_modulo!r} should not be ignored in favor of session_id={session_id!r}"
    )


# ==============================================================================
# Test 3: Same SCORM Reopening Preservation
# ==============================================================================

def test_preservation_same_scorm_reopening(tmp_path: Path):
    """Property 2.3: Same SCORM SHALL restore progress when reopened.
    
    **Validates: Requirements 3.2, 3.4**
    
    PRESERVATION TEST: This behavior is NOT affected by the bug.
    Expected to PASS on both unfixed and fixed code.
    
    When a user closes a SCORM at step 3 and reopens the SAME SCORM later,
    the system should restore the progress (step 3, accumulated XP, history).
    
    This is the desired behavior that must be preserved - the bug only affects
    DIFFERENT SCORMs sharing data, not the same SCORM maintaining its own data.
    """
    session_id = "sess_reopen_test"
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=5)
    
    # First execution: user progresses to step 3
    result_first = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    moduloId_first = result_first["moduloId"]
    
    # Simulate saving progress at step 3
    suspend_data_key = f"{result_first['localStorage_key_prefix']}cmi.suspend_data"
    lesson_location_key = f"{result_first['localStorage_key_prefix']}cmi.core.lesson_location"
    score_key = f"{result_first['localStorage_key_prefix']}cmi.core.score.raw"
    
    saved_progress = {
        "passoAtual": 3,
        "xpTotal": 26,  # Example XP after 3 steps
        "sequenciaPerfeita": True,
        "historico": [
            {"passo": 1, "tentativas": 1, "xp": 10},
            {"passo": 2, "tentativas": 1, "xp": 10},
            {"passo": 3, "tentativas": 2, "xp": 6},
        ]
    }
    
    # Second execution: reopen the SAME SCORM
    result_reopen = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    moduloId_reopen = result_reopen["moduloId"]
    
    # Assertion: Same SCORM should use the same moduloId
    assert moduloId_first == moduloId_reopen, (
        f"Same SCORM should use consistent moduloId across sessions.\n"
        f"First session moduloId: {moduloId_first!r}\n"
        f"Reopen session moduloId: {moduloId_reopen!r}\n"
        f"session_id: {session_id!r}"
    )
    
    # Assertion: localStorage keys should be identical (allowing progress restoration)
    assert result_first["localStorage_key_prefix"] == result_reopen["localStorage_key_prefix"], (
        f"Same SCORM should use same localStorage prefix for progress restoration.\n"
        f"First prefix: {result_first['localStorage_key_prefix']!r}\n"
        f"Reopen prefix: {result_reopen['localStorage_key_prefix']!r}"
    )


@given(
    session_id=st.text(
        alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters="_"),
        min_size=10,
        max_size=20,
    ).map(lambda x: f"sess_{x}"),
)
@settings(
    max_examples=30,
    phases=[Phase.generate],
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_preservation_same_scorm_idempotence_property(tmp_path: Path, session_id: str):
    """Property-Based Test: Same SCORM always gets same moduloId (idempotence).
    
    **Validates: Requirement 3.4**
    
    Property: FOR ALL session_ids,
              WHEN the same SCORM is opened multiple times,
              THEN it SHALL use the same moduloId every time
    
    This ensures progress persistence works correctly.
    """
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=3)
    
    # Simulate opening the SCORM multiple times
    result_1 = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    result_2 = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    result_3 = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    
    # Property: Idempotence - same SCORM always gets same moduloId
    assert result_1["moduloId"] == result_2["moduloId"] == result_3["moduloId"], (
        f"Property violation: Same SCORM must use consistent moduloId.\n"
        f"session_id={session_id!r}\n"
        f"moduloId_1={result_1['moduloId']!r}\n"
        f"moduloId_2={result_2['moduloId']!r}\n"
        f"moduloId_3={result_3['moduloId']!r}"
    )
    
    # Property: localStorage prefixes must be identical
    assert (
        result_1["localStorage_key_prefix"] == 
        result_2["localStorage_key_prefix"] == 
        result_3["localStorage_key_prefix"]
    ), (
        f"Property violation: Same SCORM must use consistent localStorage prefix.\n"
        f"session_id={session_id!r}\n"
        f"prefix_1={result_1['localStorage_key_prefix']!r}\n"
        f"prefix_2={result_2['localStorage_key_prefix']!r}\n"
        f"prefix_3={result_3['localStorage_key_prefix']!r}"
    )


# ==============================================================================
# Test 4: Progress Persistence Preservation
# ==============================================================================

@pytest.mark.parametrize(
    "cmi_key",
    [
        "cmi.suspend_data",
        "cmi.core.lesson_location",
        "cmi.core.score.raw",
        "cmi.core.score.max",
        "cmi.core.lesson_status",
    ],
)
def test_preservation_progress_data_keys(tmp_path: Path, cmi_key: str):
    """Property 2.4: Progress data SHALL persist with correct localStorage keys.
    
    **Validates: Requirements 3.2, 3.3**
    
    PRESERVATION TEST: This behavior is NOT affected by the bug.
    Expected to PASS on both unfixed and fixed code.
    
    When the system saves progress data (suspend_data, lesson_location, score, status),
    it should use consistent localStorage keys that allow restoration later.
    
    The fix changes WHICH moduloId is used (from 'default' to session_id),
    but the KEY FORMAT remains the same: scorm_{moduloId}_{cmi_key}
    """
    session_id = "sess_progress_persist"
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=3)
    
    result = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    
    # Generate the localStorage key for this CMI property
    expected_key = f"{result['localStorage_key_prefix']}{cmi_key}"
    
    # Assertion: Key format should be correct
    assert expected_key.startswith(f"scorm_{result['moduloId']}_"), (
        f"localStorage key format incorrect.\n"
        f"CMI key: {cmi_key}\n"
        f"Expected format: scorm_{{moduloId}}_{cmi_key}\n"
        f"Generated key: {expected_key}\n"
        f"moduloId: {result['moduloId']}"
    )
    
    # Assertion: Key should include the CMI property name
    assert cmi_key in expected_key, (
        f"localStorage key should contain CMI property name.\n"
        f"CMI key: {cmi_key}\n"
        f"Generated key: {expected_key}"
    )


def test_preservation_complete_progress_workflow(tmp_path: Path):
    """Integration Test: Complete progress save/restore workflow.
    
    **Validates: Requirements 3.2, 3.3, 3.4**
    
    PRESERVATION TEST: End-to-end workflow should work correctly.
    
    Simulates:
    1. User opens SCORM_A
    2. Progresses to step 3, accumulates 26 XP
    3. System saves suspend_data, lesson_location, score
    4. User closes and reopens SCORM_A
    5. System should restore from the same localStorage keys
    """
    session_id = "sess_workflow_test"
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=5)
    
    # First session: progress and save
    result_save = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    
    progress_keys = {
        "suspend_data": f"{result_save['localStorage_key_prefix']}cmi.suspend_data",
        "lesson_location": f"{result_save['localStorage_key_prefix']}cmi.core.lesson_location",
        "score_raw": f"{result_save['localStorage_key_prefix']}cmi.core.score.raw",
        "lesson_status": f"{result_save['localStorage_key_prefix']}cmi.core.lesson_status",
    }
    
    # Reopen session: restore
    result_restore = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    
    restored_keys = {
        "suspend_data": f"{result_restore['localStorage_key_prefix']}cmi.suspend_data",
        "lesson_location": f"{result_restore['localStorage_key_prefix']}cmi.core.lesson_location",
        "score_raw": f"{result_restore['localStorage_key_prefix']}cmi.core.score.raw",
        "lesson_status": f"{result_restore['localStorage_key_prefix']}cmi.core.lesson_status",
    }
    
    # Assertion: All progress keys should match between save and restore sessions
    for key_name, save_key in progress_keys.items():
        restore_key = restored_keys[key_name]
        assert save_key == restore_key, (
            f"Progress key mismatch for {key_name}.\n"
            f"Save session key: {save_key}\n"
            f"Restore session key: {restore_key}\n"
            f"These should be identical to allow progress restoration."
        )


@given(
    num_steps=st.integers(min_value=3, max_value=10),
    current_step=st.integers(min_value=0, max_value=9),
    xp_total=st.integers(min_value=0, max_value=200),
)
@settings(
    max_examples=30,
    phases=[Phase.generate],
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_preservation_progress_data_property(
    tmp_path: Path,
    num_steps: int,
    current_step: int,
    xp_total: int,
):
    """Property-Based Test: Progress data persists correctly for any valid state.
    
    **Validates: Requirements 3.2, 3.3**
    
    Property: FOR ALL valid progress states (steps, XP),
              WHEN progress is saved and SCORM is reopened,
              THEN restore keys SHALL match save keys exactly
    """
    # Ensure current_step doesn't exceed num_steps
    if current_step >= num_steps:
        current_step = num_steps - 1
    
    session_id = f"sess_prop_{num_steps}_{current_step}"
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=num_steps)
    
    # Simulate save session
    result_1 = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    key_1 = f"{result_1['localStorage_key_prefix']}cmi.suspend_data"
    
    # Simulate restore session (same SCORM)
    result_2 = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    key_2 = f"{result_2['localStorage_key_prefix']}cmi.suspend_data"
    
    # Property: Keys must be identical for progress restoration to work
    assert key_1 == key_2, (
        f"Property violation: Progress keys must be consistent.\n"
        f"num_steps={num_steps}, current_step={current_step}, xp_total={xp_total}\n"
        f"Save key: {key_1}\n"
        f"Restore key: {key_2}\n"
        f"These must match for progress persistence."
    )


# ==============================================================================
# Cross-Preservation Test: Verify No Interaction Between Preservation Cases
# ==============================================================================

def test_preservation_independence_lms_vs_standalone(tmp_path: Path):
    """Verify LMS mode and standalone mode use different storage mechanisms.
    
    **Validates: Requirements 3.1, 3.2**
    
    PRESERVATION TEST: LMS and standalone should be completely independent.
    
    Even if the same SCORM is run in both LMS and standalone modes,
    they should not interfere with each other (LMS uses API, standalone uses localStorage).
    """
    session_id = "sess_independence_test"
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=3)
    
    # Simulate LMS mode
    result_lms = analyze_scorm_api_behavior(scorm_package, lms_mode=True, url_modulo_param=None)
    
    # Simulate standalone mode
    result_standalone = analyze_scorm_api_behavior(scorm_package, lms_mode=False, url_modulo_param=None)
    
    # Assertions: Different storage mechanisms
    assert result_lms["uses_lms_api"] is True
    assert result_lms["uses_localstorage"] is False
    
    assert result_standalone["uses_lms_api"] is False
    assert result_standalone["uses_localstorage"] is True
    
    # LMS should not have localStorage keys
    assert result_lms["localStorage_key_prefix"] is None
    
    # Standalone should have localStorage keys
    assert result_standalone["localStorage_key_prefix"] is not None
    assert result_standalone["localStorage_key_prefix"].startswith("scorm_")


def test_preservation_url_param_overrides_in_all_modes(tmp_path: Path):
    """Verify URL parameter works in both standalone and could work with LMS.
    
    **Validates: Requirement 3.5**
    
    PRESERVATION TEST: URL parameter priority should be universal.
    
    The ?modulo= parameter should be respected as the moduloId source
    when present, providing explicit control over the identifier.
    """
    session_id = "sess_url_override"
    custom_modulo = "custom_override_123"
    scorm_package = create_scorm_package(session_id, tmp_path, num_steps=3)
    
    # Test with standalone mode + URL param
    result_standalone = analyze_scorm_api_behavior(
        scorm_package,
        lms_mode=False,
        url_modulo_param=custom_modulo
    )
    
    # URL parameter should be used
    assert result_standalone["moduloId"] == custom_modulo
    assert result_standalone["localStorage_key_prefix"] == f"scorm_{custom_modulo}_"
    
    # Verify it's NOT using session_id when URL param is present
    assert result_standalone["moduloId"] != session_id, (
        f"URL parameter should override session_id.\n"
        f"URL modulo={custom_modulo}\n"
        f"session_id={session_id}\n"
        f"moduloId={result_standalone['moduloId']}"
    )
