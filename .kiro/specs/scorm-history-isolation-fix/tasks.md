# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Cross-SCORM localStorage Isolation
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists (different SCORMs sharing localStorage)
  - **Scoped PBT Approach**: Scope the property to concrete failing cases - two different SCORM packages with distinct session_ids
  - Test that when SCORM_A (session_id="sess_A") completes and SCORM_B (session_id="sess_B") opens in standalone mode without URL `modulo` parameter, SCORM_B does NOT load SCORM_A's progress data (from Bug Condition in design)
  - Property: `isBugCondition(input)` where `input.isLMS = false AND input.urlParams.get('modulo') = null AND input.moduloId = 'default'`
  - Expected behavior after fix: Each SCORM SHALL use unique localStorage keys based on its `session_id` (e.g., `scorm_sess_A_*` vs `scorm_sess_B_*`)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (e.g., "SCORM_B incorrectly loaded lesson_status='passed' from SCORM_A" or "both SCORMs share key 'scorm_default_cmi.core.lesson_status'")
  - Document counterexamples found to understand root cause
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - LMS Mode and URL Parameter Behavior
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (LMS mode, URL with `modulo` parameter, same SCORM reopening)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements:
    - Test 1: When executed in LMS mode (`input.isLMS = true`), verify system uses LMS API (not localStorage)
    - Test 2: When URL contains `?modulo=custom_id`, verify system uses `custom_id` as moduloId (not 'default' or session_id)
    - Test 3: When same SCORM reopens, verify progress restoration works correctly (e.g., SCORM_A closes at step 3, reopens at step 3)
    - Test 4: When saving progress (`cmi.suspend_data`, `cmi.core.lesson_location`, `cmi.core.score.raw`), verify data persists correctly
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for SCORM History Isolation

  - [x] 3.1 Implement the fix
    - Remove global `window.moduloId` initialization on line 19 of `try-player.js` (currently: `window.moduloId = urlParams.get('modulo') || 'default'`)
    - Move `moduloId` initialization into `iniciarPlayer()` function after `STEPS_DATA` is loaded (after line 35)
    - Implement priority logic: URL parameter `modulo` > `STEPS_DATA.session_id` > fallback to 'default'
    - Code to add after loading STEPS_DATA:
      ```javascript
      if (!window.moduloId) {
          const urlModulo = urlParams.get('modulo');
          if (urlModulo) {
              window.moduloId = urlModulo;
          } else if (dados.session_id) {
              window.moduloId = dados.session_id;
          } else {
              window.moduloId = 'default'; // Fallback apenas se session_id não existir
          }
      }
      console.log(`[SCORM] Modo: ${ScormAPI.isLMS ? 'LMS' : 'Standalone'}, moduloId: ${window.moduloId}`);
      ```
    - Verify that `ScormAPI` operations occur AFTER `window.moduloId` is defined
    - Ensure localStorage keys now use format `scorm_{session_id}_{key}` for each unique SCORM package
    - _Bug_Condition: `isBugCondition(input)` where `(NOT input.isLMS) AND (input.urlParams.get('modulo') IS NULL) AND (input.moduloId = 'default')`_
    - _Expected_Behavior: Each SCORM package SHALL use unique `session_id` as moduloId, generating isolated localStorage namespaces (e.g., `scorm_sess_123_*` vs `scorm_sess_456_*`)_
    - _Preservation: LMS mode SHALL continue using API SCORM nativa; URL parameter `modulo` SHALL have priority; same SCORM reopening SHALL restore saved progress; all save/restore functionality SHALL remain unchanged_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Unique Identifier per SCORM Package
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms different SCORMs now have isolated localStorage, e.g., `scorm_sess_A_*` vs `scorm_sess_B_*`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - LMS Mode and URL Parameter Behavior
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions - LMS mode, URL parameters, progress save/restore, same SCORM reopening all work identically)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
