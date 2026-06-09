# SCORM History Isolation Fix - Bugfix Design

## Overview

Este bugfix resolve o problema de isolamento incorreto do histórico de progresso entre diferentes pacotes SCORM executados em modo standalone (sem LMS). Atualmente, todos os SCORMs em standalone compartilham a mesma chave `'default'` no localStorage, causando vazamento de dados de progresso entre treinamentos que deveriam ser isolados.

A estratégia de correção consiste em utilizar o `session_id` único de cada pacote SCORM (disponível no manifest como `identifier="CaptureOS_TRY_{session_id}"`) em vez do valor genérico `'default'`. Esta solução garante isolamento completo entre SCORMs diferentes enquanto preserva todos os comportamentos existentes para LMS e URL com parâmetro `modulo`.

**Impacto da Correção:**
- Cada SCORM terá seu próprio namespace no localStorage
- Usuários poderão executar múltiplos SCORMs sem interferência de dados
- Comportamento em LMS e com parâmetros URL permanece inalterado

## Glossary

- **Bug_Condition (C)**: A condição que dispara o bug - quando um SCORM em standalone sem parâmetro URL usa `'default'` como identificador, compartilhando localStorage com outros SCORMs
- **Property (P)**: O comportamento desejado - cada pacote SCORM deve ter um identificador único derivado do `session_id` no manifest, garantindo isolamento de dados
- **Preservation**: Comportamentos existentes que devem permanecer inalterados - funcionamento em LMS real, uso de parâmetros URL `modulo`, e funcionalidades de salvar/restaurar progresso
- **window.moduloId**: Variável JavaScript em `try-player.js` que define o identificador usado para namespacing no localStorage
- **ScormAPI**: Objeto JavaScript em `scorm-api.js` que abstrai a comunicação com LMS ou localStorage standalone
- **session_id**: Identificador único gerado para cada pacote SCORM (formato `sess_TIMESTAMP`), usado no manifest e no backend
- **imsmanifest.xml**: Arquivo XML de metadados SCORM que contém o identificador único do pacote no atributo `identifier`
- **STEPS_DATA**: Objeto JavaScript global que contém os dados do módulo SCORM, incluindo `session_id`

## Bug Details

### Bug Condition

O bug se manifesta quando um pacote SCORM é executado em modo standalone (fora de um LMS) sem parâmetro `modulo` na URL. Nesta situação, o código em `try-player.js` define `window.moduloId = 'default'`, que é então usado pelo `scorm-api.js` para gerar chaves de localStorage como `scorm_default_{key}`. Como todos os SCORMs diferentes usam o mesmo identificador `'default'`, eles compartilham o mesmo espaço de armazenamento, causando vazamento de dados de progresso.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type ScormExecutionContext
  OUTPUT: boolean
  
  RETURN (NOT input.isLMS) AND
         (input.urlParams.get('modulo') IS NULL OR input.urlParams.get('modulo') = '') AND
         (input.moduloId = 'default')
END FUNCTION
```

**Onde:**
- `input.isLMS`: Booleano indicando se o SCORM está executando dentro de um LMS real
- `input.urlParams.get('modulo')`: Parâmetro opcional na URL para forçar um identificador específico
- `input.moduloId`: Valor atual usado como identificador no localStorage

### Examples

**Exemplo 1: Vazamento de Status de Conclusão**
- SCORM_A (`session_id: "sess_1234567890"`) executado em standalone
- Usuário completa todos os passos → `localStorage['scorm_default_cmi.core.lesson_status'] = 'passed'`
- SCORM_B (`session_id: "sess_9876543210"`) executado em standalone
- **Comportamento Atual (Buggy)**: SCORM_B carrega `lesson_status = 'passed'` do SCORM_A, aparecendo como já concluído
- **Comportamento Esperado (Fixed)**: SCORM_B inicia com `lesson_status` vazio/indefinido

**Exemplo 2: Vazamento de Progresso de Passos**
- SCORM_A com 10 passos, usuário completa até o passo 7
- `localStorage['scorm_default_cmi.suspend_data']` contém `{"passoAtual": 7, "xpTotal": 65, ...}`
- SCORM_B com 5 passos é aberto
- **Comportamento Atual (Buggy)**: SCORM_B tenta restaurar `passoAtual = 7`, ultrapassando seu total de passos
- **Comportamento Esperado (Fixed)**: SCORM_B inicia no passo 0 com estado limpo

**Exemplo 3: Reabertura do Mesmo SCORM (Comportamento Esperado)**
- SCORM_A executado, usuário completa até o passo 3
- Usuário fecha e reabre SCORM_A
- **Comportamento Atual e Esperado**: SCORM_A restaura corretamente do passo 3 (este comportamento deve ser preservado)

**Exemplo 4: Edge Case - URL com Parâmetro Modulo (Não Afetado)**
- SCORM aberto com URL `index.html?modulo=custom_id`
- **Comportamento Atual e Esperado**: Usa `moduloId = 'custom_id'`, não é afetado pelo bug (este comportamento deve ser preservado)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Execução em LMS real deve continuar usando a API SCORM nativa para armazenamento/recuperação de dados (não localStorage)
- Parâmetros `modulo` na URL devem continuar sendo priorizados como identificador quando presentes
- Funcionalidades de salvar progresso (`cmi.suspend_data`, `cmi.core.lesson_location`, `cmi.core.score.raw`) devem continuar funcionando exatamente como antes
- Verificação de status da lição (`cmi.core.lesson_status`) deve continuar retornando valores corretos
- Restauração de estado ao reabrir o MESMO SCORM deve continuar funcionando

**Scope:**
Todas as entradas que NÃO envolvem modo standalone com `moduloId = 'default'` devem ser completamente não afetadas por esta correção. Isso inclui:
- Qualquer execução dentro de um LMS real (com API SCORM disponível)
- Qualquer execução standalone com parâmetro `?modulo=xyz` na URL
- Lógica de cálculo de XP, navegação entre passos, e feedback visual
- Integração com backend para conclusão em modo simlink

## Hypothesized Root Cause

Baseado na análise do código, as causas raiz identificadas são:

1. **Valor Default Genérico em try-player.js**: A linha 19 define:
   ```javascript
   window.moduloId = urlParams.get('modulo') || 'default';
   ```
   Quando não há parâmetro `modulo` na URL, todos os SCORMs recebem o mesmo valor `'default'`, sem distinção.

2. **Falta de Acesso ao session_id no Contexto Standalone**: O `session_id` único está disponível em dois lugares:
   - No manifest XML como `identifier="CaptureOS_TRY_{session_id}"`
   - No objeto `STEPS_DATA` (carregado de `data/steps.js`) como propriedade `session_id`
   
   Porém, o código atual não utiliza nenhum desses valores para gerar o `moduloId` em standalone.

3. **Lógica de Fallback Inadequada**: O código usa um fallback simples `|| 'default'` em vez de buscar um identificador único disponível nos dados do módulo.

4. **Ordem de Inicialização**: Em `try-player.js`, `window.moduloId` é definido na linha 19, **antes** de carregar `STEPS_DATA` na função `iniciarPlayer()` (linha 28-35). Esta ordem impede o acesso ao `session_id` durante a inicialização do `moduloId`.

## Correctness Properties

Property 1: Bug Condition - Unique Identifier per SCORM Package

_For any_ SCORM execution in standalone mode without URL `modulo` parameter, the fixed code SHALL use the unique `session_id` from the manifest/STEPS_DATA as the `moduloId` identifier, ensuring isolated localStorage namespaces for each distinct SCORM package.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - LMS and URL Parameter Behavior

_For any_ SCORM execution that is NOT in the bug condition (running in LMS or with URL `modulo` parameter), the fixed code SHALL produce exactly the same storage behavior as the original code, preserving all existing identifier logic and data persistence functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assumindo que nossa análise de causa raiz está correta:

**File**: `scorm_eng/templates/js/try-player.js`

**Function**: Global initialization and `iniciarPlayer()`

**Specific Changes**:

1. **Defer moduloId Initialization**: Remover a linha 19 que define `window.moduloId` no escopo global antes de carregar dados
   ```javascript
   // REMOVE: window.moduloId = urlParams.get('modulo') || 'default';
   ```

2. **Set moduloId After Loading STEPS_DATA**: Dentro da função `iniciarPlayer()`, após carregar os dados (linha 35), definir `window.moduloId` baseado no `session_id`:
   ```javascript
   state.modulo = dados;
   
   // NEW: Define moduloId usando session_id do pacote SCORM
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
   ```

3. **Update ScormAPI Initialization Order**: Garantir que `ScormAPI.init()` é chamado antes de definir `moduloId`, mas que operações de leitura/escrita só ocorram depois:
   - Mover `ScormAPI.init()` para o início de `iniciarPlayer()` (já está correto)
   - Garantir que `window.moduloId` está definido antes da primeira chamada a `ScormAPI.get()` na linha 53

4. **Add Validation**: Adicionar log de diagnóstico para confirmar o identificador usado:
   ```javascript
   console.log(`[SCORM] Modo: ${ScormAPI.isLMS ? 'LMS' : 'Standalone'}, moduloId: ${window.moduloId}`);
   ```

5. **Preserve URL Parameter Priority**: Garantir que parâmetros URL sempre têm prioridade sobre `session_id` automático:
   - A lógica proposta no item 2 já implementa isso com a verificação `if (urlModulo)` antes de `dados.session_id`

### Alternative Implementation (If Needed)

Se a abordagem acima causar problemas de timing com o `ScormAPI`, uma alternativa é:
- Fazer o `ScormAPI` buscar `moduloId` dinamicamente via função em vez de variável global
- Passar o `session_id` como parâmetro para `ScormAPI.init(moduloId)` após carregar os dados

## Testing Strategy

### Validation Approach

A estratégia de testes segue uma abordagem de duas fases: primeiro, executar testes exploratórios no código NÃO CORRIGIDO para confirmar o bug e entender seus manifestações; depois, verificar que a correção funciona corretamente e preserva comportamentos existentes.

### Exploratory Bug Condition Checking

**Goal**: Demonstrar o bug no código UNFIXED, confirmando que diferentes SCORMs compartilham dados no localStorage. Esta fase confirma ou refuta nossa análise de causa raiz.

**Test Plan**: Configurar dois pacotes SCORM distintos (com `session_id` diferentes) e executá-los em sequência no modo standalone sem parâmetros URL. Executar estes testes no código UNFIXED para observar o vazamento de dados.

**Test Cases**:
1. **Cross-SCORM Lesson Status Leak** (will fail on unfixed code):
   - Executar SCORM_A, completar até `lesson_status = 'passed'`
   - Abrir SCORM_B em nova sessão (limpar apenas sessionStorage, não localStorage)
   - Verificar que SCORM_B carrega `lesson_status = 'passed'` incorretamente

2. **Cross-SCORM Progress Leak** (will fail on unfixed code):
   - Executar SCORM_A com 10 passos, avançar até passo 7
   - Fechar e abrir SCORM_B com 5 passos
   - Verificar que SCORM_B tenta carregar `passoAtual = 7`, causando erro de índice

3. **Same SCORM Progress Restoration** (should PASS on unfixed code - preservation test):
   - Executar SCORM_A, avançar até passo 3
   - Fechar e reabrir SCORM_A
   - Verificar que restaura corretamente do passo 3

4. **URL Parameter Override** (should PASS on unfixed code - preservation test):
   - Executar SCORM com `?modulo=test123`
   - Verificar que usa `moduloId = 'test123'`, não `'default'`

**Expected Counterexamples**:
- Testes 1 e 2 devem FALHAR no código unfixed, demonstrando vazamento de dados
- Testes 3 e 4 devem PASSAR no código unfixed, confirmando comportamentos a preservar
- Possíveis causas confirmadas: valor `'default'` compartilhado, falta de uso do `session_id`

### Fix Checking

**Goal**: Verificar que para todas as entradas onde a condição de bug existe, a função corrigida usa identificadores únicos por pacote SCORM.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := getModuloId_fixed(input)
  ASSERT result != 'default'
  ASSERT result = input.STEPS_DATA.session_id
  ASSERT localStorage_keys_include(result) // Chaves têm formato scorm_{session_id}_{key}
END FOR
```

**Test Implementation**:
- Executar os mesmos testes 1 e 2 da fase exploratória no código FIXED
- Verificar que SCORM_A e SCORM_B agora têm chaves localStorage distintas
- Exemplo: `scorm_sess_123_cmi.core.lesson_status` vs `scorm_sess_456_cmi.core.lesson_status`

### Preservation Checking

**Goal**: Verificar que para todas as entradas onde a condição de bug NÃO existe, a função corrigida produz o mesmo resultado que a função original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT getModuloId_original(input) = getModuloId_fixed(input)
  ASSERT storageLogic_original(input) = storageLogic_fixed(input)
END FOR
```

**Testing Approach**: Property-based testing é recomendado para preservation checking porque:
- Gera automaticamente muitos casos de teste através do domínio de entrada
- Detecta edge cases que testes manuais podem perder
- Fornece garantias fortes de que o comportamento é inalterado para todas as entradas não-buggy

**Test Plan**: Primeiro observar o comportamento no código UNFIXED para capturar o comportamento esperado, depois escrever testes baseados em propriedades para verificar que o comportamento continua idêntico após a correção.

**Test Cases**:
1. **LMS Mode Preservation**: Simular execução em LMS (mock de `window.API`), verificar que usa API SCORM nativa e não localStorage
   - Observar no unfixed: chamadas a `LMSSetValue`, `LMSGetValue`
   - Testar no fixed: comportamento deve ser idêntico

2. **URL Parameter Preservation**: Testar com múltiplos valores de parâmetro `modulo` (`?modulo=abc`, `?modulo=xyz123`, etc.)
   - Observar no unfixed: usa o valor do parâmetro como `moduloId`
   - Testar no fixed: comportamento deve ser idêntico

3. **Progress Save/Restore Preservation**: Verificar que salvar e restaurar estado funciona corretamente
   - Observar no unfixed: `suspend_data`, `lesson_location`, `score.raw` são salvos e restaurados
   - Testar no fixed: mesma funcionalidade, apenas com namespace diferente no localStorage

4. **Status Transitions Preservation**: Verificar transições `incomplete → passed/failed`
   - Observar no unfixed: lógica de cálculo de XP e determinação de `passed`
   - Testar no fixed: mesma lógica, sem alterações

### Unit Tests

- Test que `moduloId` é definido corretamente após carregar `STEPS_DATA` com `session_id`
- Test que `moduloId` usa parâmetro URL quando presente (prioridade)
- Test que `moduloId` usa `'default'` apenas quando `session_id` não está disponível (fallback)
- Test que chaves localStorage têm formato correto `scorm_{moduloId}_{key}`
- Test que execução em LMS ignora localStorage e usa API nativa

### Property-Based Tests

- Gerar múltiplos `session_id` aleatórios e verificar que cada um produz namespace único no localStorage
- Gerar configurações aleatórias de módulos (diferentes números de passos, XP) e verificar isolamento de dados
- Gerar sequências aleatórias de ações (abrir SCORM A, progredir, fechar, abrir SCORM B) e verificar que não há vazamento
- Gerar valores aleatórios de parâmetro URL `modulo` e verificar que sempre têm prioridade sobre `session_id`

### Integration Tests

- Test do fluxo completo: abrir SCORM A, completar, fechar, abrir SCORM B diferente, verificar estado limpo
- Test de reabrir o MESMO SCORM múltiplas vezes e verificar persistência de progresso
- Test de alternância entre modo LMS e standalone dentro do mesmo navegador
- Test de compatibilidade com backend (endpoint `/api/v1/simlink/{moduloId}/conclusao` deve receber `session_id` correto)
