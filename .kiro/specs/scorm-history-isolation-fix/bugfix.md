# Bugfix Requirements Document

## Introduction

Este documento descreve o bug de isolamento incorreto do histórico de progresso entre diferentes pacotes SCORM quando executados em modo standalone (sem LMS). Atualmente, o sistema armazena o progresso de todos os SCORMs diferentes usando a mesma chave no localStorage do navegador, causando vazamento de dados de progresso entre treinamentos que deveriam ser completamente isolados.

**Impacto:** Quando um usuário completa um SCORM A e depois abre um SCORM B diferente, o sistema carrega incorretamente o histórico de conclusão do SCORM A, fazendo com que o SCORM B apareça como já concluído mesmo que nunca tenha sido executado.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN um pacote SCORM é aberto em modo standalone (fora de um LMS) THEN o sistema utiliza `window.moduloId = 'default'` como identificador do módulo

1.2 WHEN o sistema armazena progresso no localStorage com `moduloId = 'default'` THEN a chave gerada é `scorm_default_${key}`, que é idêntica para todos os SCORMs diferentes

1.3 WHEN o usuário abre um SCORM A, completa o treinamento, e depois abre um SCORM B diferente THEN o sistema carrega o histórico de conclusão do SCORM A no SCORM B, mostrando-o como já concluído

1.4 WHEN o usuário reabre o mesmo SCORM que já completou THEN o sistema corretamente mantém o histórico de conclusão (este comportamento é esperado e deve ser preservado)

### Expected Behavior (Correct)

2.1 WHEN um pacote SCORM é aberto em modo standalone THEN o sistema SHALL utilizar um identificador único específico daquele pacote SCORM (não um valor genérico compartilhado)

2.2 WHEN o sistema armazena progresso no localStorage THEN a chave gerada SHALL incluir o identificador único do pacote SCORM, garantindo isolamento entre diferentes SCORMs

2.3 WHEN o usuário completa um SCORM A e depois abre um SCORM B diferente THEN o sistema SHALL iniciar o SCORM B com progresso zerado, sem carregar dados do SCORM A

2.4 WHEN o usuário reabre o mesmo SCORM que já completou THEN o sistema SHALL continuar carregando o histórico de conclusão específico daquele SCORM

### Unchanged Behavior (Regression Prevention)

3.1 WHEN um SCORM é executado dentro de um LMS real (com API SCORM disponível) THEN o sistema SHALL CONTINUE TO usar a API do LMS para armazenar e recuperar o progresso (não localStorage)

3.2 WHEN o usuário completa um passo dentro de um SCORM THEN o sistema SHALL CONTINUE TO salvar corretamente o progresso (`cmi.suspend_data`, `cmi.core.lesson_location`, `cmi.core.score.raw`)

3.3 WHEN o sistema verifica o status da lição (`cmi.core.lesson_status`) THEN o sistema SHALL CONTINUE TO retornar "passed", "completed", "incomplete" ou "failed" conforme apropriado

3.4 WHEN o usuário fecha e reabre o MESMO SCORM THEN o sistema SHALL CONTINUE TO restaurar o estado salvo anteriormente (passo atual, XP total, histórico)

3.5 WHEN o SCORM é executado em modo standalone E possui um parâmetro `modulo` na URL (ex: `?modulo=abc123`) THEN o sistema SHALL CONTINUE TO usar esse parâmetro como identificador

## Bug Condition

**Bug Condition Function:**
```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type ScormExecutionContext
  OUTPUT: boolean
  
  // O bug ocorre quando:
  // 1. SCORM está em modo standalone (não em LMS)
  // 2. Não há parâmetro 'modulo' na URL
  // 3. window.moduloId é definido como 'default'
  RETURN (NOT X.isLMS) AND 
         (X.urlParams.get('modulo') IS NULL OR X.urlParams.get('modulo') = '') AND
         (X.moduloId = 'default')
END FUNCTION
```

**Property Specification - Fix Checking:**
```pascal
// Property: Cada SCORM deve ter identificador único no localStorage
FOR ALL X WHERE isBugCondition(X) DO
  // Após a correção, mesmo sem parâmetro na URL,
  // cada pacote SCORM deve ter um identificador único
  result ← getModuloId'(X)
  
  ASSERT result != 'default' AND
         result IS unique_to_scorm_package(X) AND
         localStorage_key_includes(result)
END FOR
```

**Preservation Goal:**
```pascal
// Property: Comportamento não afetado pelo bug deve permanecer igual
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT getModuloId(X) = getModuloId'(X) AND
         storageLogic(X) = storageLogic'(X)
END FOR
```

**Key Definitions:**
- **F (getModuloId)**: Função original que retorna `urlParams.get('modulo') || 'default'`
- **F' (getModuloId')**: Função corrigida que retorna identificador único por pacote SCORM
- **unique_to_scorm_package(X)**: O identificador deve ser derivado de dados únicos do pacote (ex: `session_id` do manifest)

**Counterexample Concreto:**
```
Entrada: 
  - SCORM_A (session_id: "abc123") executado standalone sem ?modulo na URL
  - Usuário completa SCORM_A (lesson_status = "passed")
  - SCORM_B (session_id: "xyz789") executado standalone sem ?modulo na URL

Comportamento Atual (Buggy):
  - SCORM_A: moduloId = 'default', localStorage key = 'scorm_default_cmi.core.lesson_status'
  - SCORM_B: moduloId = 'default', localStorage key = 'scorm_default_cmi.core.lesson_status'
  - Resultado: SCORM_B carrega lesson_status = "passed" do SCORM_A

Comportamento Esperado (Fixed):
  - SCORM_A: moduloId = 'abc123', localStorage key = 'scorm_abc123_cmi.core.lesson_status'
  - SCORM_B: moduloId = 'xyz789', localStorage key = 'scorm_xyz789_cmi.core.lesson_status'
  - Resultado: SCORM_B inicia com lesson_status = null/undefined
```
