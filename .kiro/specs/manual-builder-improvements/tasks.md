# Implementation Plan: Manual Builder Improvements

## Overview

Implementar as melhorias do `pdf_eng/manual_builder.py` de forma incremental: primeiro a infraestrutura de suporte (constantes, helpers puros, assinatura), depois a capa, depois os dois layouts, e por fim a identidade visual no cabeçalho e a integração final. Cada etapa é validada com testes antes de avançar.

## Tasks

- [x] 1. Preparar infraestrutura de testes e constantes
  - [x] 1.1 Criar `tests/pdf_eng/conftest.py` com as strategies Hypothesis
    - Implementar `valid_roteiro_strategy()`, `non_empty_text()`, `whitespace_text()`, `list_of_regular_steps()` conforme especificado na Testing Strategy do design
    - _Requirements: 4.1_

  - [x] 1.2 Adicionar constantes e estilos atualizados ao `pdf_eng/manual_builder.py`
    - Definir `APOSTILA_PAGESIZE`, `PLAYBOOK_PAGESIZE`, `MARGIN`, `LOGO_COVER_MAX_W`, `LOGO_COVER_MAX_H`, `LOGO_HEADER_MAX_H`, `COR_PRINCIPAL`, `VALID_LAYOUTS`
    - Atualizar estilos `estilo_secao_titulo`, `estilo_passo_num`, `estilo_ancora` para usar `COR_PRINCIPAL (#00998F)`
    - _Requirements: 3.1_

- [x] 2. Implementar funções puras e atualizar assinatura de `gerar_pdf`
  - [x] 2.1 Implementar `_scale_image`, `_validate_layout` e `_filter_step` / `_is_special_step`
    - `_scale_image(orig_w, orig_h, max_w, max_h) -> (w, h)`: escala proporcional scale-down only
    - `_validate_layout(layout: str) -> str`: fallback para `"apostila"` com `logger.warning` se inválido
    - `_filter_step(passo: dict) -> bool`: retorna `True` se passo deve ser ignorado
    - `_is_special_step(passo: dict) -> bool`: retorna `True` para passo 0 ou 999
    - _Requirements: 1.5, 5.1, 5.2, 5.3, 5.4_

  - [ ]* 2.2 Escrever property test para `_scale_image` (Property 5)
    - **Property 5: Scale-down preserva proporção e nunca amplia**
    - **Validates: Requirements 1.4, 2.4, 3.4**
    - `@given(w=integers(1,5000), h=integers(1,5000), max_w=floats(1.0,500.0), max_h=floats(1.0,500.0))`
    - Verificar: resultado ≤ limites, proporção preservada, sem upscale

  - [x] 2.3 Atualizar assinatura pública de `gerar_pdf` e bloco de validação inicial
    - Adicionar parâmetros `layout`, `logo_path`, `logo_no_cabecalho` com seus defaults
    - Implementar validação de `titulo` vazio: `logger.error` + `return False`
    - Implementar bloco `try/except` externo: `logger.error` + `return False` para exceções
    - _Requirements: 4.1, 4.4, 2.8_

  - [ ]* 2.4 Escrever property tests para validação de assinatura e entradas inválidas (Properties 4 e 6)
    - **Property 4: Omissão de layout equivale a `layout="apostila"`**
    - **Validates: Requirements 1.6, 4.2**
    - **Property 6: Título vazio retorna False**
    - **Validates: Requirements 2.8**
    - Escrever `test_function_signature` e `test_empty_titulo_returns_false`

  - [ ]* 2.5 Escrever teste de exemplo para compatibilidade com pipeline existente
    - `test_backward_compat_3arg_call`: chamar com 3 argumentos e verificar retorno `True` e PDF criado
    - `test_exception_containment`: output_path inválido → retorna `False`, sem propagação
    - _Requirements: 4.1, 4.3, 4.4_

- [x] 3. Implementar `_load_logo` e `_build_cover`
  - [x] 3.1 Implementar `_load_logo(logo_path, max_w, max_h) -> Image | None`
    - Carregar imagem com Pillow, aplicar `_scale_image`, retornar objeto `reportlab.platypus.Image`
    - Se arquivo inexistente: `logger.warning(f"Logo não encontrada: {logo_path}")` + retornar `None`
    - Se formato não suportado / ilegível: `logger.warning(...)` com descrição + retornar `None`
    - Se `logo_path` for `None`: retornar `None` silenciosamente
    - _Requirements: 2.4, 2.5, 2.7, 3.6_

  - [x] 3.2 Implementar `_build_cover(titulo, logo_path, styles) -> list[Flowable]`
    - Criar `_CoverPage(Flowable)` com `canv.nextPage()` explícito para ocupar exatamente uma página
    - Renderizar barra decorativa superior em `COR_PRINCIPAL`
    - Renderizar título centralizado na região superior da capa
    - Exibir logo com largura máxima 5 cm se `logo_path` válido (via `_load_logo`)
    - Manter posição e tamanho fixos para área de título e área de logo
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

  - [ ]* 3.3 Escrever property tests para capa (Properties 7 e 8)
    - **Property 7: Todo PDF gerado com sucesso começa com capa**
    - **Validates: Requirements 2.1**
    - **Property 8: Título aparece na capa do PDF**
    - **Validates: Requirements 2.2**
    - `@given(roteiro=valid_roteiro_strategy(), titulo=non_empty_text())`

  - [ ]* 3.4 Escrever testes de exemplo para logo
    - `test_logo_path_not_found_warning`: warning logado, PDF gerado sem crash
    - `test_no_logo_no_warning`: `logo_path=None` não gera warning
    - `test_unsupported_logo_format_warning`: formato inválido → warning + PDF gerado
    - _Requirements: 2.4, 2.5, 2.7, 3.6_

- [x] 4. Checkpoint — Garantir que todos os testes até aqui passam
  - Garantir que todos os testes passam. Perguntar ao usuário se surgirem dúvidas.

- [x] 5. Implementar layout Apostila (`_build_apostila_elements`)
  - [x] 5.1 Implementar `_build_apostila_elements(roteiro, styles, logo_path, logo_no_cabecalho) -> list[Flowable]`
    - Iterar sobre passos do roteiro, usando `_filter_step` para ignorar passos sem conteúdo
    - Passo 0: exibir `ancora` como texto de introdução em largura total, sem screenshot nem label
    - Passo 999: exibir `ancora` como texto de conclusão em largura total, sem screenshot nem label
    - Passos regulares: exibir label `"Passo N"` em `COR_PRINCIPAL`, `ancora`, `micro_narracao` e screenshot em sequência vertical
    - _Requirements: 1.2, 5.1, 5.2, 5.3, 5.4, 5.6_

  - [ ]* 5.2 Escrever property tests para layout Apostila (Properties 1 e 4)
    - **Property 1: Layout apostila produz página A4 retrato**
    - **Validates: Requirements 1.2, 1.6**
    - **Property 4: Omissão de layout equivale a `layout="apostila"`**
    - **Validates: Requirements 1.6, 4.2**
    - `@given(roteiro=valid_roteiro_strategy())`

  - [ ]* 5.3 Escrever property tests para passos especiais no layout Apostila (Properties 10, 11, 12, 13)
    - **Property 10: Passo 0 com âncora não vazia aparece sem label de passo**
    - **Validates: Requirements 5.1**
    - **Property 11: Passo 999 com âncora não vazia aparece sem label de passo**
    - **Validates: Requirements 5.2**
    - **Property 12: Passos especiais com âncora vazia são ignorados**
    - **Validates: Requirements 5.3**
    - **Property 13: Passos regulares sem conteúdo são ignorados**
    - **Validates: Requirements 5.4**

- [x] 6. Implementar layout Playbook (`_build_playbook_elements`)
  - [x] 6.1 Implementar `_build_playbook_elements(roteiro, styles, logo_path, logo_no_cabecalho) -> list[Flowable]`
    - Usar `Table` do reportlab com 2 colunas de tamanho fixo para organizar passos regulares em grade
    - Grade preenchida da esquerda para direita, de cima para baixo
    - Redimensionar screenshots via `_scale_image` (scale-down only) para caber na célula da grade
    - Posicionar passos especiais (0 e 999) em largura total da página, fora da grade de 2 colunas
    - _Requirements: 1.3, 1.4, 5.5_

  - [ ]* 6.2 Escrever property tests para layout Playbook (Properties 2 e 3)
    - **Property 2: Layout playbook produz página A4 paisagem**
    - **Validates: Requirements 1.3**
    - **Property 3: Layout inválido faz fallback para apostila**
    - **Validates: Requirements 1.5**
    - `@given(roteiro=valid_roteiro_strategy())` e `@given(layout=text().filter(...))`

  - [ ]* 6.3 Escrever teste de exemplo para passos especiais em largura total no Playbook
    - `test_special_steps_full_width_playbook`: passo 0 e 999 não ficam em coluna de 2-grid
    - _Requirements: 5.5_

- [x] 7. Implementar cabeçalho com logo nas páginas de conteúdo
  - [x] 7.1 Implementar `_build_header_canvas(canvas, doc, logo_path)` como callback `onPage` do reportlab
    - Renderizar logo no cabeçalho com altura máxima de 1 cm, preservando proporção
    - Ativado apenas quando `logo_no_cabecalho=True` e `logo_path` aponta para arquivo existente legível
    - Omitir silenciosamente quando `logo_no_cabecalho=False` ou `logo_path=None`
    - _Requirements: 3.3, 3.4, 3.5, 3.6_

  - [ ]* 7.2 Escrever teste de exemplo para cabeçalho com logo
    - `test_logo_no_cabecalho_false_no_logo_in_header`: cabeçalho sem logo quando flag é `False`
    - _Requirements: 3.3, 3.5_

- [x] 8. Integrar todos os componentes em `gerar_pdf` e conectar ao pipeline
  - [x] 8.1 Conectar `_build_cover`, `_build_apostila_elements` / `_build_playbook_elements` e `_build_header_canvas` dentro de `gerar_pdf`
    - Chamar `_validate_layout` para normalizar o parâmetro `layout`
    - Construir lista de flowables: capa + elementos de conteúdo
    - Configurar `SimpleDocTemplate` com o pagesize correto e margens definidas
    - Passar `onPage=_build_header_canvas` quando `logo_no_cabecalho=True`
    - Chamar `doc.build(...)` e retornar `True` em caso de sucesso
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 8.2 Escrever property test para geração bem-sucedida (Property 9)
    - **Property 9: Geração bem-sucedida sempre retorna True**
    - **Validates: Requirements 4.3**
    - `@given(roteiro=valid_roteiro_strategy(), titulo=non_empty_text())`

- [x] 9. Checkpoint final — Garantir que todos os testes passam
  - Garantir que toda a suíte de testes passa. Perguntar ao usuário se surgirem dúvidas.

## Notes

- Tasks marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada task referencia os requisitos específicos para rastreabilidade
- Os checkpoints garantem validação incremental
- Os property tests usam Hypothesis (já presente no projeto via `.hypothesis/`)
- Os testes de propriedade devem rodar com `@settings(max_examples=100)` e incluir o comentário `# Feature: manual-builder-improvements, Property N: <texto resumido>`
- A função `gerar_pdf` nunca propaga exceções ao chamador — todas as exceções são capturadas internamente
- Os novos parâmetros são opcionais com defaults, mantendo compatibilidade total com o pipeline existente

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4", "2.5", "3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["3.3", "3.4", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 7, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 8, "tasks": ["7.2", "8.1"] },
    { "id": 9, "tasks": ["8.2"] }
  ]
}
```
