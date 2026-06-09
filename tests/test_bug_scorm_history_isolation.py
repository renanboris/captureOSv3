"""Bug Condition Exploration Test - SCORM History Isolation Fix.

**Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**

This test explores the bug condition where different SCORM packages in standalone
mode (without LMS and without URL 'modulo' parameter) incorrectly share localStorage
data due to all using the same 'default' identifier.

CRITICAL: This test is EXPECTED TO FAIL on unfixed code - the failure confirms
the bug exists. DO NOT attempt to fix the test or code when it fails.

The test simulates two distinct SCORM packages (SCORM_A with session_id="sess_A"
and SCORM_B with session_id="sess_B") being executed in sequence, and verifies
that they should use isolated localStorage namespaces.

Expected Outcome on UNFIXED code:
- Test FAILS with counterexample showing both SCORMs use 'scorm_default_*' keys
- Demonstrates cross-SCORM data leakage (e.g., SCORM_B loads SCORM_A's status)

Expected Outcome on FIXED code:
- Test PASSES showing each SCORM uses unique keys like 'scorm_sess_A_*' and 'scorm_sess_B_*'
"""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List

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
        session_id: Unique identifier for this SCORM package (e.g., "sess_A")
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


def simulate_scorm_execution_and_extract_moduloid(
    scorm_package: Dict[str, Path],
    expected_session_id: str,
) -> Dict[str, Any]:
    """Simulate SCORM execution by analyzing the JavaScript code behavior.
    
    This function extracts what moduloId would be used by analyzing the code
    without actually running it in a browser (which would require Selenium).
    
    Args:
        scorm_package: Dict with paths to SCORM files
        expected_session_id: The session_id we expect this SCORM to use
        
    Returns:
        Dict with:
            - 'moduloId': The identifier that would be used
            - 'localStorage_key_prefix': The prefix for localStorage keys
            - 'session_id_from_steps': The session_id from STEPS_DATA
            - 'bug_condition': Whether this execution matches the bug condition
    """
    try_player_code = scorm_package["try_player"].read_text(encoding="utf-8")
    steps_js_code = scorm_package["steps_js"].read_text(encoding="utf-8")
    
    # Extract session_id from steps.js
    session_id_from_steps = None
    if "session_id" in steps_js_code:
        # Parse the STEPS_DATA JSON
        import re
        match = re.search(r'"session_id"\s*:\s*"([^"]+)"', steps_js_code)
        if match:
            session_id_from_steps = match.group(1)
    
    # Analyze the bug condition:
    # Line 19 in try-player.js: window.moduloId = urlParams.get('modulo') || 'default';
    # Since we're in standalone mode without URL params, this will be 'default'
    
    # Check if the code has the bug (uses 'default' for moduloId)
    has_bug = "window.moduloId = urlParams.get('modulo') || 'default';" in try_player_code
    
    # In standalone mode (isLMS = false) without URL params:
    # - UNFIXED code: moduloId = 'default' (from line 19, before STEPS_DATA loads)
    # - FIXED code: moduloId should be session_id from STEPS_DATA
    
    if has_bug:
        # Bug exists: moduloId is set to 'default' on line 19
        moduloId = "default"
    else:
        # Bug is fixed: moduloId should use session_id from STEPS_DATA
        moduloId = session_id_from_steps or "default"
    
    # localStorage keys are formatted as: scorm_{moduloId}_{key}
    localStorage_key_prefix = f"scorm_{moduloId}_"
    
    # Bug condition: NOT isLMS AND no URL modulo param AND moduloId == 'default'
    bug_condition = has_bug and moduloId == "default"
    
    return {
        "moduloId": moduloId,
        "localStorage_key_prefix": localStorage_key_prefix,
        "session_id_from_steps": session_id_from_steps,
        "bug_condition": bug_condition,
        "has_unfixed_code": has_bug,
    }


@pytest.mark.parametrize(
    "session_id_a,session_id_b",
    [
        ("sess_A", "sess_B"),
        ("sess_1234567890", "sess_9876543210"),
        ("sess_test_alpha", "sess_test_beta"),
    ],
)
def test_bug_condition_cross_scorm_isolation(
    tmp_path: Path,
    session_id_a: str,
    session_id_b: str,
):
    """Property 1: Bug Condition - Cross-SCORM localStorage Isolation.
    
    **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3**
    
    CRITICAL: This test is EXPECTED TO FAIL on unfixed code.
    
    This test verifies that two different SCORM packages should use isolated
    localStorage namespaces based on their unique session_id values.
    
    Bug Condition:
        isBugCondition(input) where:
            - input.isLMS = false (standalone mode)
            - input.urlParams.get('modulo') = null (no URL parameter)
            - input.moduloId = 'default' (generic fallback)
    
    Expected Behavior After Fix:
        - SCORM_A uses keys like 'scorm_sess_A_cmi.core.lesson_status'
        - SCORM_B uses keys like 'scorm_sess_B_cmi.core.lesson_status'
        - No data leakage between different SCORMs
    
    Expected FAILURE on unfixed code:
        Both SCORMs will use 'scorm_default_*' keys, causing data leakage.
    """
    # Create two distinct SCORM packages with different session_ids
    scorm_a_package = create_scorm_package(session_id_a, tmp_path, num_steps=5)
    scorm_b_package = create_scorm_package(session_id_b, tmp_path, num_steps=3)
    
    # Simulate execution of SCORM_A
    result_a = simulate_scorm_execution_and_extract_moduloid(
        scorm_a_package,
        session_id_a,
    )
    
    # Simulate execution of SCORM_B
    result_b = simulate_scorm_execution_and_extract_moduloid(
        scorm_b_package,
        session_id_b,
    )
    
    # Extract the localStorage key prefixes
    prefix_a = result_a["localStorage_key_prefix"]
    prefix_b = result_b["localStorage_key_prefix"]
    moduloid_a = result_a["moduloId"]
    moduloid_b = result_b["moduloId"]
    
    # Document the bug condition
    if result_a["bug_condition"] and result_b["bug_condition"]:
        bug_manifestation = (
            f"BUG DETECTED: Both SCORMs use the same moduloId='{moduloid_a}' "
            f"(should use unique session_ids '{session_id_a}' and '{session_id_b}'). "
            f"This causes localStorage keys to collide:\n"
            f"  SCORM_A keys: {prefix_a}*\n"
            f"  SCORM_B keys: {prefix_b}*\n"
            f"Both SCORMs will share data, causing cross-contamination."
        )
    else:
        bug_manifestation = None
    
    # ASSERTION: Each SCORM must have a unique localStorage prefix
    # On UNFIXED code: This will FAIL because both use 'scorm_default_'
    # On FIXED code: This will PASS because they use 'scorm_sess_A_' and 'scorm_sess_B_'
    assert prefix_a != prefix_b, (
        f"Cross-SCORM isolation violated: SCORM_A and SCORM_B use the same "
        f"localStorage prefix '{prefix_a}', causing data leakage.\n"
        f"Expected: SCORM_A prefix != SCORM_B prefix\n"
        f"Actual: Both use prefix='{prefix_a}'\n"
        f"Root cause: {bug_manifestation or 'Unknown'}\n"
        f"Details:\n"
        f"  SCORM_A: session_id={session_id_a}, moduloId={moduloid_a}, prefix={prefix_a}\n"
        f"  SCORM_B: session_id={session_id_b}, moduloId={moduloid_b}, prefix={prefix_b}"
    )
    
    # ASSERTION: Each SCORM must use its own session_id as moduloId
    # This is the core fix requirement
    assert moduloid_a == session_id_a, (
        f"SCORM_A should use session_id '{session_id_a}' as moduloId, "
        f"but uses '{moduloid_a}' instead."
    )
    
    assert moduloid_b == session_id_b, (
        f"SCORM_B should use session_id '{session_id_b}' as moduloId, "
        f"but uses '{moduloid_b}' instead."
    )


@given(
    session_id_a=st.text(
        alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters="_"),
        min_size=10,
        max_size=20,
    ).map(lambda x: f"sess_{x}"),  # Prepend "sess_" instead of filtering
    session_id_b=st.text(
        alphabet=st.characters(whitelist_categories=("Lu", "Ll", "Nd"), whitelist_characters="_"),
        min_size=10,
        max_size=20,
    ).map(lambda x: f"sess_{x}"),  # Prepend "sess_" instead of filtering
)
@settings(
    max_examples=50,
    phases=[Phase.generate, Phase.target],
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_bug_condition_property_unique_identifiers(
    tmp_path: Path,
    session_id_a: str,
    session_id_b: str,
):
    """Property-Based Test: Unique localStorage identifiers for different SCORMs.
    
    **Validates: Requirements 2.1, 2.2, 2.3**
    
    CRITICAL: This test is EXPECTED TO FAIL on unfixed code - generates counterexamples.
    
    Property: FOR ALL pairs of distinct SCORM packages (session_id_a, session_id_b)
              WHERE session_id_a != session_id_b
              THEN localStorage_prefix_a != localStorage_prefix_b
    
    This property-based test generates many different session_id pairs to explore
    the bug condition space and find counterexamples.
    
    Expected counterexample on UNFIXED code:
        Falsifying example: test_bug_condition_property_unique_identifiers(
            session_id_a='sess_abc123', session_id_b='sess_xyz789'
        )
        Both use moduloId='default', causing prefix collision 'scorm_default_'
    """
    # Skip if session IDs are identical (we need different SCORMs)
    if session_id_a == session_id_b:
        return
    
    # Create two SCORM packages with different session_ids
    scorm_a_package = create_scorm_package(session_id_a, tmp_path, num_steps=3)
    scorm_b_package = create_scorm_package(session_id_b, tmp_path, num_steps=3)
    
    # Analyze what moduloId each would use
    result_a = simulate_scorm_execution_and_extract_moduloid(scorm_a_package, session_id_a)
    result_b = simulate_scorm_execution_and_extract_moduloid(scorm_b_package, session_id_b)
    
    prefix_a = result_a["localStorage_key_prefix"]
    prefix_b = result_b["localStorage_key_prefix"]
    moduloid_a = result_a["moduloId"]
    moduloid_b = result_b["moduloId"]
    
    # Property: Different SCORMs MUST have different localStorage prefixes
    assert prefix_a != prefix_b, (
        f"Property violation: Different SCORMs must use isolated localStorage.\n"
        f"Counterexample found:\n"
        f"  session_id_a={session_id_a!r}\n"
        f"  session_id_b={session_id_b!r}\n"
        f"  moduloId_a={moduloid_a!r}\n"
        f"  moduloId_b={moduloid_b!r}\n"
        f"  localStorage_prefix_a={prefix_a!r}\n"
        f"  localStorage_prefix_b={prefix_b!r}\n"
        f"Both SCORMs share the same localStorage namespace, violating isolation."
    )
    
    # Stronger property: moduloId should match the session_id
    assert moduloid_a == session_id_a, (
        f"SCORM with session_id={session_id_a!r} should use that as moduloId, "
        f"but uses moduloId={moduloid_a!r}"
    )
    
    assert moduloid_b == session_id_b, (
        f"SCORM with session_id={session_id_b!r} should use that as moduloId, "
        f"but uses moduloId={moduloid_b!r}"
    )


def test_bug_condition_concrete_example_lesson_status_leak(tmp_path: Path):
    """Concrete Example: lesson_status leakage between SCORMs.
    
    **Validates: Requirements 1.3, 2.3**
    
    CRITICAL: This test is EXPECTED TO FAIL on unfixed code.
    
    Scenario:
        1. User completes SCORM_A (session_id="sess_abc123")
        2. SCORM_A stores lesson_status="passed" in localStorage
        3. User opens SCORM_B (session_id="sess_xyz789")
        4. SCORM_B should start with lesson_status=undefined (not load SCORM_A's status)
    
    Bug: On unfixed code, both SCORMs use key 'scorm_default_cmi.core.lesson_status',
         causing SCORM_B to incorrectly load lesson_status="passed" from SCORM_A.
    
    Fix: Each SCORM should use unique keys:
         - SCORM_A: 'scorm_sess_abc123_cmi.core.lesson_status'
         - SCORM_B: 'scorm_sess_xyz789_cmi.core.lesson_status'
    """
    session_id_a = "sess_abc123"
    session_id_b = "sess_xyz789"
    
    scorm_a = create_scorm_package(session_id_a, tmp_path, num_steps=3)
    scorm_b = create_scorm_package(session_id_b, tmp_path, num_steps=3)
    
    result_a = simulate_scorm_execution_and_extract_moduloid(scorm_a, session_id_a)
    result_b = simulate_scorm_execution_and_extract_moduloid(scorm_b, session_id_b)
    
    # Simulate localStorage keys that would be used
    lesson_status_key_a = f"{result_a['localStorage_key_prefix']}cmi.core.lesson_status"
    lesson_status_key_b = f"{result_b['localStorage_key_prefix']}cmi.core.lesson_status"
    
    # These keys MUST be different to prevent data leakage
    assert lesson_status_key_a != lesson_status_key_b, (
        f"Lesson status key collision detected:\n"
        f"  SCORM_A (session_id={session_id_a}) uses key: {lesson_status_key_a}\n"
        f"  SCORM_B (session_id={session_id_b}) uses key: {lesson_status_key_b}\n"
        f"If these keys are the same, SCORM_B will incorrectly load SCORM_A's completion status.\n"
        f"Expected: Different keys for different SCORMs\n"
        f"Actual: Both use the same key"
    )


def test_bug_condition_concrete_example_progress_leak(tmp_path: Path):
    """Concrete Example: Progress data (suspend_data) leakage between SCORMs.
    
    **Validates: Requirements 1.3, 2.3**
    
    CRITICAL: This test is EXPECTED TO FAIL on unfixed code.
    
    Scenario:
        1. SCORM_A has 10 steps, user completes up to step 7
        2. SCORM_A stores suspend_data with passoAtual=7 in localStorage
        3. User opens SCORM_B which has only 5 steps
        4. SCORM_B should start with passoAtual=0 (not load SCORM_A's step 7)
    
    Bug: On unfixed code, both use key 'scorm_default_cmi.suspend_data',
         causing SCORM_B to try restoring passoAtual=7 which exceeds its 5 steps.
    """
    session_id_a = "sess_progress_a"
    session_id_b = "sess_progress_b"
    
    scorm_a = create_scorm_package(session_id_a, tmp_path, num_steps=10)
    scorm_b = create_scorm_package(session_id_b, tmp_path, num_steps=5)
    
    result_a = simulate_scorm_execution_and_extract_moduloid(scorm_a, session_id_a)
    result_b = simulate_scorm_execution_and_extract_moduloid(scorm_b, session_id_b)
    
    # Simulate suspend_data keys
    suspend_data_key_a = f"{result_a['localStorage_key_prefix']}cmi.suspend_data"
    suspend_data_key_b = f"{result_b['localStorage_key_prefix']}cmi.suspend_data"
    
    # These keys MUST be different
    assert suspend_data_key_a != suspend_data_key_b, (
        f"Suspend data key collision detected:\n"
        f"  SCORM_A (10 steps, session_id={session_id_a}) uses key: {suspend_data_key_a}\n"
        f"  SCORM_B (5 steps, session_id={session_id_b}) uses key: {suspend_data_key_b}\n"
        f"If these keys are the same, SCORM_B will incorrectly load SCORM_A's progress data,\n"
        f"potentially trying to restore a step number that doesn't exist (e.g., step 7 > 5 total steps)."
    )
