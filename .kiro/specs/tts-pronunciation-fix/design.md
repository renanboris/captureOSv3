# TTS Pronunciation Fix - Bugfix Design

## Overview

The `gerar_audio` function in `video_eng/tts_generator.py` applies phonetic corrections to convert English terms into pronunciation-friendly representations for Portuguese TTS voices. The word "SIGN" is missing from these corrections, causing the Portuguese voice engine to mispronounce it as "sígni" (following Portuguese phonetic rules) instead of the correct English pronunciation "sáin". The fix adds a single regex substitution using word boundaries to correct isolated occurrences of "sign" without affecting words containing it as a substring (e.g., "design", "signal").

## Glossary

- **Bug_Condition (C)**: The input text contains the word "sign" as an isolated word (any case) — matched by `(?i)\bsign\b`
- **Property (P)**: When C holds, the word "sign" must be replaced by "sáin" in the text sent to TTS
- **Preservation**: All existing phonetic corrections, anti-stutter rules, and cache behavior must remain unchanged
- **gerar_audio**: The async function in `video_eng/tts_generator.py` responsible for text-to-speech generation with phonetic preprocessing
- **texto_falado**: The intermediate variable holding the phonetically corrected text before it is sent to TTS providers
- **Word Boundary (`\b`)**: Regex anchor that matches the position between a word character and a non-word character, ensuring only whole-word matches

## Bug Details

### Bug Condition

The bug manifests when the input text contains the standalone English word "SIGN" (case-insensitive). The `gerar_audio` function has no phonetic correction rule for this word, so the Portuguese TTS voice applies native Portuguese phonetics to it, resulting in an incorrect pronunciation.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type String (text to be narrated by TTS)
  OUTPUT: boolean
  
  RETURN regex_match(r"(?i)\bsign\b", input) exists
         AND "sign" is not part of a larger word (e.g., "design", "signal")
         AND no phonetic correction is applied to "sign"
END FUNCTION
```

### Examples

- Input: `"Click the SIGN button"` → Current: TTS reads "sígni" | Expected: TTS reads "sáin"
- Input: `"The sign indicates danger"` → Current: TTS reads "sígni" | Expected: TTS reads "sáin"
- Input: `"Sign here please"` → Current: TTS reads "sígni" | Expected: TTS reads "sáin"
- Input: `"This is a design pattern"` → Current: "design" unchanged | Expected: "design" unchanged (no regression)
- Input: `"Send a signal now"` → Current: "signal" unchanged | Expected: "signal" unchanged (no regression)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Existing phonetic corrections must continue to work: "GED" → "gédi", "ecm_ged" → "E C M gédi", "senior" → "Sênior", "X" → "Éks", "template(s)" → "têmpleit(s)"
- Anti-stutter rules must continue to apply: underscore → space, pipes/slashes → comma, multiple spaces collapsed
- MD5 cache lookup and storage must operate identically
- TTS provider priority chain (MiniMax → Edge-TTS → OpenAI) must remain unchanged
- Words containing "sign" as a substring ("design", "signal", "assign", "resignation") must NOT be affected

**Scope:**
All inputs that do NOT contain "sign" as an isolated word should be completely unaffected by this fix. This includes:
- Text with only Portuguese words
- Text with other English words already handled by existing corrections
- Text containing "sign" as a substring within other words
- Empty or whitespace-only text (already handled by early return)

## Hypothesized Root Cause

Based on the bug description, the root cause is straightforward:

1. **Missing Phonetic Rule**: The phonetic corrections block in `gerar_audio` simply lacks an entry for the word "sign". The existing corrections handle "GED", "senior", "X", and "template(s)" but the word "sign" was never added to this list.

2. **Portuguese TTS Default Behavior**: When the Portuguese voice encounters an uncorrected English word, it applies Portuguese phonetic rules. For "sign", the Portuguese voice interprets the 'gn' consonant cluster and final vowelless ending according to Portuguese patterns, producing approximately "sígni".

3. **No Fallback Mechanism**: There is no general-purpose English word detection or fallback pronunciation system — each English word that needs correct pronunciation must be explicitly mapped in the corrections block.

## Correctness Properties

Property 1: Bug Condition - SIGN Phonetic Correction

_For any_ input text where the word "sign" appears as an isolated word (case-insensitive, matched by `(?i)\bsign\b`), the fixed `gerar_audio` function SHALL replace all occurrences with "sáin" in the `texto_falado` variable before sending to TTS providers.

**Validates: Requirements 2.1**

Property 2: Preservation - Existing Corrections and Substring Safety

_For any_ input text where the word "sign" does NOT appear as an isolated word (either the text has no "sign" at all, or "sign" only appears as a substring of other words like "design" or "signal"), the fixed function SHALL produce exactly the same `texto_falado` as the original function, preserving all existing phonetic corrections, anti-stutter rules, and word integrity.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `video_eng/tts_generator.py`

**Function**: `gerar_audio`

**Specific Changes**:
1. **Add regex substitution for "sign"**: Insert a new `re.sub` line in the phonetic corrections block:
   ```python
   texto_falado = re.sub(r"(?i)\bsign\b", "sáin", texto_falado)
   ```

2. **Placement**: The new line should be placed after the existing phonetic corrections (after the `templates?` line and before the anti-stutter section). The exact insertion point is after line:
   ```python
   texto_falado = re.sub(r"(?i)\btemplates?\b", lambda m: "têmpleits" if m.group().lower().endswith("s") else "têmpleit", texto_falado)
   ```

3. **Pattern details**:
   - `(?i)` — case-insensitive flag, handles "SIGN", "Sign", "sign"
   - `\b` — word boundary anchors, prevents matching "design", "signal", "assign", etc.
   - Replacement "sáin" — phonetic representation for correct English pronunciation

4. **No other changes required**: The cache, provider logic, and all other corrections remain untouched.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that "sign" passes through uncorrected in the current code.

**Test Plan**: Extract the phonetic correction logic into a testable function, pass text containing "sign" through it, and verify that the word remains unchanged (demonstrating the bug).

**Test Cases**:
1. **Standalone SIGN uppercase**: Input `"Click the SIGN button"` — assert "SIGN" still present in output (will fail on unfixed code)
2. **Standalone sign lowercase**: Input `"The sign indicates danger"` — assert "sign" still present in output (will fail on unfixed code)
3. **Mixed case Sign**: Input `"Sign here please"` — assert "Sign" still present in output (will fail on unfixed code)
4. **Multiple occurrences**: Input `"SIGN the sign"` — assert both remain unchanged (will fail on unfixed code)

**Expected Counterexamples**:
- The word "sign" passes through the correction pipeline without modification
- Cause: no regex rule exists for the word "sign" in the corrections block

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function replaces "sign" with "sáin".

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := apply_phonetic_corrections_fixed(input)
  ASSERT regex_match(r"(?i)\bsign\b", result) does NOT exist
  ASSERT "sáin" IN result
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT apply_phonetic_corrections_original(input) = apply_phonetic_corrections_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many text strings automatically, covering diverse input patterns
- It catches edge cases where "sign" might appear as a substring in unexpected words
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Extract the phonetic correction logic, observe behavior on unfixed code for texts without standalone "sign", then write property-based tests confirming the fixed version matches.

**Test Cases**:
1. **Substring preservation — "design"**: Input `"This is a design pattern"` — verify "design" unchanged after fix
2. **Substring preservation — "signal"**: Input `"Send a signal now"` — verify "signal" unchanged after fix
3. **Substring preservation — "assign"**: Input `"Assign the task"` — verify "assign" unchanged after fix
4. **Existing corrections preserved**: Input `"The GED senior template"` — verify "gédi", "Sênior", "têmpleit" still applied
5. **Anti-stutter rules preserved**: Input `"foo_bar | baz"` — verify underscore and pipe substitutions still work
6. **Pure Portuguese text**: Input `"O sistema está funcionando"` — verify no changes applied

### Unit Tests

- Test `re.sub(r"(?i)\bsign\b", "sáin", text)` with standalone "sign" in various cases
- Test that "design", "signal", "assign", "resignation", "signage" are NOT affected
- Test combination of "sign" with existing correction words (e.g., `"Sign the GED template"`)
- Test empty string and whitespace-only input

### Property-Based Tests

- Generate random text strings containing the word "sign" as a standalone word and verify all are replaced with "sáin"
- Generate random text strings NOT containing standalone "sign" and verify output matches original function
- Generate random text containing words with "sign" as substring and verify they are untouched
- Generate random combinations of existing correction words with "sign" and verify all corrections apply correctly

### Integration Tests

- Test full `gerar_audio` flow with mocked TTS provider, verifying the corrected text reaches the provider
- Test that cache key (MD5) changes appropriately when "sign" is now corrected (new hash for corrected text)
- Test that existing cached audio for texts without "sign" remains valid and is still served from cache
