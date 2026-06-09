# Documento de Requisitos do Bugfix

## Introdução

O sistema de TTS (`video_eng/tts_generator.py`) possui um mecanismo de correção fonética via regex que converte termos ingleses em representações fonéticas adequadas para vozes portuguesas. Atualmente, a palavra "SIGN" não possui mapeamento fonético, resultando em pronúncia incorreta — a voz portuguesa (MiniMax Portuguese_Casual_Speaker_v1) lê a palavra usando regras de fonética do português (algo como "sígni") em vez de pronunciá-la corretamente em inglês ("sáin").

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN o texto contém a palavra "SIGN" (em qualquer variação de caixa: "SIGN", "Sign", "sign") THEN o sistema envia a palavra sem correção fonética para o provedor TTS, resultando em pronúncia incorreta pela voz portuguesa (lida como "sígni" em vez de "sáin")

### Expected Behavior (Correct)

2.1 WHEN o texto contém a palavra "SIGN" (em qualquer variação de caixa: "SIGN", "Sign", "sign") THEN o sistema SHALL substituir por "sáin" antes de enviar ao provedor TTS, garantindo pronúncia correta em inglês

### Unchanged Behavior (Regression Prevention)

3.1 WHEN o texto contém palavras que já possuem correção fonética existente (ex.: "GED" → "gédi", "senior" → "Sênior", "X" → "Éks", "template" → "têmpleit") THEN o sistema SHALL CONTINUE TO aplicar essas correções corretamente

3.2 WHEN o texto contém palavras em português que não requerem correção fonética THEN o sistema SHALL CONTINUE TO enviá-las sem alteração ao provedor TTS

3.3 WHEN o texto é processado pelas regras de anti-engasgos (substituição de underscores, pipes e barras) THEN o sistema SHALL CONTINUE TO aplicar essas limpezas corretamente

3.4 WHEN um áudio já existe no cache MD5 para o texto corrigido THEN o sistema SHALL CONTINUE TO usar o cache em vez de regenerar o áudio

3.5 WHEN o texto contém a palavra "design" ou "signal" (que contêm "sign" como substring) THEN o sistema SHALL CONTINUE TO não alterar essas palavras erroneamente — a substituição deve afetar apenas "sign" como palavra isolada (word boundary)

---

## Bug Condition (Pseudocódigo)

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type TextoParaTTS (string de texto a ser narrado)
  OUTPUT: boolean
  
  // Retorna true quando o texto contém "SIGN" como palavra isolada (qualquer caixa)
  RETURN X contém match de regex (?i)\bsign\b
END FUNCTION
```

## Property Specification

```pascal
// Property: Fix Checking - Correção fonética de "SIGN"
FOR ALL X WHERE isBugCondition(X) DO
  texto_corrigido ← aplicar_correções_fonéticas'(X)
  ASSERT "sign" (case-insensitive, word boundary) NOT IN texto_corrigido
  ASSERT "sáin" IN texto_corrigido
END FOR
```

## Preservation Goal

```pascal
// Property: Preservation Checking - Comportamento existente inalterado
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT aplicar_correções_fonéticas(X) = aplicar_correções_fonéticas'(X)
END FOR
```
