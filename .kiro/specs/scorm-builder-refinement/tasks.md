# Implementation Plan: SCORM Builder Refinement

## Overview

This plan implements enhancements to the SCORM Builder system to improve interactive click detection precision using selector-based detection (xpath/css_selector) with coordinate fallback, and optionally integrate knowledge validation quizzes at the end of SCORM packages. The implementation spans both Python backend (SCORM_Builder) and JavaScript frontend (Try_Player).

## Tasks

- [x] 1. Enhance Try_Player with selector-based click detection
  - [x] 1.1 Implement getElementByXPath helper function
    - Add XPath evaluation with try-catch error handling
    - Return null on invalid syntax or evaluation errors
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 1.2 Refactor detectClickMatch with selector-priority algorithm
    - Try css_selector first, then xpath, then coordinate fallback
    - Return detection method used (css_selector/xpath/coordinates)
    - Add debug logging for each detection attempt
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 9.1, 9.2_

  - [x] 1.3 Implement isDebugMode function
    - Return `!ScormAPI.isLMS` to enable debug logs in standalone mode
    - Ensure logs suppressed in LMS execution
    - _Requirements: 9.5_

  - [ ]* 1.4 Write unit tests for click detection priority
    - Test CSS selector priority over xpath and coordinates
    - Test xpath fallback when CSS selector fails
    - Test coordinate fallback when both selectors fail
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

- [x] 2. Enhance Highlight_Renderer with selector-based positioning
  - [x] 2.1 Refactor renderHighlight with selector-priority bounds calculation
    - Try getBoundingClientRect from css_selector element
    - Fallback to xpath element bounds
    - Fallback to calculateScaledBounds from coordinates
    - Add debug logging for bounds source
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.3_

  - [x] 2.2 Implement calculateScaledBounds function
    - Calculate proportional scaling based on natural vs rendered image size
    - Apply offset for image container positioning
    - _Requirements: 2.5, 2.6_

  - [ ]* 2.3 Write unit tests for highlight rendering
    - Test bounds calculation from DOM elements
    - Test coordinate fallback with scaling
    - Test offset calculations for container positioning
    - _Requirements: 2.1, 2.2, 2.3, 2.7_

- [x] 3. Checkpoint - Verify selector-based detection works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Quiz_Component in Try_Player
  - [x] 4.1 Create Quiz_Component object with core structure
    - Implement data, currentIndex, userAnswers properties
    - Implement init() with QUIZ_DATA validation
    - Implement validateQuizData() checking schema requirements
    - _Requirements: 5.1, 6.4, 6.5_

  - [x] 4.2 Implement quiz navigation and answer tracking
    - Implement selectAnswer() to store user selections
    - Implement next() for question navigation
    - Implement render() to display current question and options
    - _Requirements: 5.2, 5.3_

  - [x] 4.3 Implement quiz scoring and results display
    - Implement calculateScore() returning 0-100 percentage
    - Implement showResults() with color-coded feedback (green >= 70%, yellow 50-69%, red < 50%)
    - Allow user to review answers after completion
    - _Requirements: 5.3, 5.4, 5.5, 6.2_

  - [x] 4.4 Implement saveQuizScore for SCORM persistence
    - Format score as "{xp_simulation}|{quiz_percentage}"
    - Save to cmi.core.score.raw
    - Update cmi.suspend_data with quizAnswers and quizScore
    - _Requirements: 4.6, 5.6, 8.1_

  - [ ]* 4.5 Write unit tests for Quiz_Component
    - Test QUIZ_DATA validation with valid and malformed data
    - Test score calculation with various answer patterns
    - Test SCORM data format compliance
    - _Requirements: 5.1, 5.3, 5.4, 6.4, 6.5_

- [x] 5. Implement suspend_data size management
  - [x] 5.1 Add salvarProgresso size validation and truncation
    - Check suspend_data size before saving
    - Truncate historico to last 5 entries if exceeds 4096 chars
    - Remove quizAnswers if still too large
    - Log truncation warnings
    - _Requirements: 8.2, 8.3_

  - [ ]* 5.2 Write unit tests for suspend_data truncation
    - Test truncation with oversized historico
    - Test quizAnswers removal when needed
    - Verify critical data preserved (passoAtual, xpTotal, quizScore)
    - _Requirements: 8.2, 8.3_

- [x] 6. Checkpoint - Verify quiz component integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Enhance SCORM_Builder with quiz integration parameters
  - [x] 7.1 Add incluir_quiz and num_questoes_quiz parameters to ScormBuilder
    - Add parameters to __init__ method
    - Implement _validate_num_questoes to clamp values to [1, 10] range
    - Log warnings for out-of-range values
    - _Requirements: 4.1, 7.1, 7.2, 7.3, 7.4_

  - [x] 7.2 Implement _generate_quiz method
    - Extract roteiro from simlink_modulo.hotspots
    - Invoke Quiz_Generator with error handling and timeout
    - Return empty list on failure and log warnings
    - _Requirements: 4.1, 4.7, 6.1_

  - [x] 7.3 Implement _write_quiz method
    - Serialize quiz data to JavaScript format
    - Write to data/quiz.js in ZIP package
    - _Requirements: 4.2, 6.3_

  - [x] 7.4 Enhance build method with conditional quiz generation
    - Call _generate_quiz when incluir_quiz=True
    - Write quiz.js to package when questions exist
    - Update manifest to reference quiz.js
    - _Requirements: 4.1, 4.2, 4.3, 4.7_

  - [ ]* 7.5 Write unit tests for SCORM_Builder quiz integration
    - Test quiz generation invocation when incluir_quiz=True
    - Test quiz.js file creation with valid questions
    - Test graceful skip when Quiz_Generator fails
    - Test num_questoes validation and clamping
    - _Requirements: 4.1, 4.2, 4.7, 7.1, 7.2, 7.3, 7.4_

- [x] 8. Update gerar_scorm function signature
  - [x] 8.1 Add incluir_quiz and num_questoes_quiz parameters
    - Update function signature with default values
    - Pass parameters to ScormBuilder constructor
    - Update docstring
    - _Requirements: 4.1, 7.1_

- [x] 9. Wire quiz component into Try_Player execution flow
  - [x] 9.1 Add quiz transition after simulation completion
    - Check for QUIZ_DATA presence after final step
    - Display transition screen "Quiz de Validação"
    - Initialize and render QuizComponent on user advance
    - _Requirements: 4.3, 4.4_

  - [x] 9.2 Load quiz.js script in index.html
    - Add script tag for data/quiz.js with async loading
    - Handle missing quiz.js gracefully
    - _Requirements: 4.2, 6.3_

  - [ ]* 9.3 Write integration tests for quiz flow
    - Test end-to-end quiz completion and score persistence
    - Test quiz skip when quiz.js not present
    - Test SCORM API data format compliance
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 10. Verify SCORM 1.2 compliance
  - [x] 10.1 Validate imsmanifest.xml against SCORM 1.2 schema
    - Run schema validation on generated manifest
    - Verify all elements and attributes conform to standard
    - _Requirements: 8.4, 8.5_

  - [x] 10.2 Verify SCORM API usage compliance
    - Audit all cmi.core.* field usage
    - Verify suspend_data size limits enforced
    - Document any SCORM 1.2 specific constraints
    - _Requirements: 8.1, 8.2, 8.5_

- [ ] 11. Verify backward compatibility preservation
  - [ ]* 11.1 Test legacy SCORM packages with updated Try_Player
    - Load pre-existing packages without selectors
    - Verify coordinate-based detection still works
    - Verify XP system, audio feedback, and animations unchanged
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 12. Final checkpoint - Complete system verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Python tasks target `scorm_eng/scorm_builder.py`
- JavaScript tasks target `scorm_eng/templates/js/try-player.js`
- Quiz integration is optional (controlled by `incluir_quiz` parameter)
- Selector-based detection maintains backward compatibility through coordinate fallback
- SCORM 1.2 compliance is mandatory for all changes
- Debug logging automatically suppressed in LMS environments

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.3", "4.1"] },
    { "id": 4, "tasks": ["4.2", "7.1"] },
    { "id": 5, "tasks": ["4.3", "7.2"] },
    { "id": 6, "tasks": ["4.4", "5.1", "7.3"] },
    { "id": 7, "tasks": ["4.5", "5.2", "7.4"] },
    { "id": 8, "tasks": ["7.5", "8.1"] },
    { "id": 9, "tasks": ["9.1", "9.2", "10.1"] },
    { "id": 10, "tasks": ["9.3", "10.2"] },
    { "id": 11, "tasks": ["11.1"] }
  ]
}
```
