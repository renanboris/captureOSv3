# Requirements Document

## Introduction

O `manual_builder.py` é responsável por gerar apostilas PDF a partir de roteiros de tutoriais capturados pelo CaptureOS. As melhorias propostas introduzem dois layouts de geração (Apostila e Playbook), uma capa padronizada com identidade visual da empresa e suporte a logo, mantendo a simplicidade do módulo e compatibilidade total com as chamadas existentes.

---

## Glossary

- **Manual_Builder**: Módulo `pdf_eng/manual_builder.py` que gera documentos PDF a partir de roteiros de tutoriais.
- **Roteiro**: Lista de dicionários com os passos do tutorial, contendo `passo`, `ancora`, `micro_narracao` e `_simlink.screenshot_path`.
- **Passo**: Unidade individual do roteiro. Passo 0 = introdução; passo 999 = conclusão; demais passos contêm screenshot.
- **Layout_Apostila**: Layout vertical, estilo apostila, com passos apresentados sequencialmente de cima para baixo (formato atual).
- **Layout_Playbook**: Layout horizontal (paisagem/landscape), estilo playbook, com passos organizados em grade de 2 colunas preenchida da esquerda para a direita e de cima para baixo.
- **Capa**: Primeira página do PDF com identidade visual padronizada, exibindo o título do tutorial e, opcionalmente, a logo da empresa.
- **Identidade_Visual**: Conjunto de elementos visuais da empresa, incluindo a cor principal `#00998F` e a logo.
- **Logo**: Arquivo de imagem da empresa (PNG ou JPEG) exibido na Capa e opcionalmente no cabeçalho de cada página de conteúdo.
- **Cor_Principal**: Cor hexadecimal `#00998F` usada nos elementos de destaque do documento (títulos de seção, labels de passo, barra decorativa da capa).
- **Pipeline**: Módulo `api/rerender_pipeline.py` que chama o Manual_Builder via `gerar_pdf(roteiro, output_path, titulo)`.

---

## Requirements

### Requirement 1: Suporte a Dois Layouts de Geração

**User Story:** Como usuário do CaptureOS, quero escolher entre o layout Apostila (vertical) e o layout Playbook (horizontal), para que eu possa gerar documentos adequados a diferentes contextos de uso.

#### Acceptance Criteria

1. THE Manual_Builder SHALL aceitar um parâmetro `layout` com os valores `"apostila"` ou `"playbook"`, com valor padrão `"apostila"`.
2. WHEN o parâmetro `layout` for `"apostila"`, THE Manual_Builder SHALL gerar o PDF em formato retrato (A4 vertical, 210×297 mm) com os passos apresentados sequencialmente, um abaixo do outro.
3. WHEN o parâmetro `layout` for `"playbook"`, THE Manual_Builder SHALL gerar o PDF em formato paisagem (A4 horizontal, 297×210 mm) com os passos regulares organizados em grade de 2 colunas, preenchida da esquerda para a direita e de cima para baixo.
4. WHEN o parâmetro `layout` for `"playbook"`, THE Manual_Builder SHALL redimensionar as imagens de screenshot apenas para baixo (scale-down), mantendo a proporção original, para caber dentro de cada célula da grade sem distorção.
5. IF um valor de `layout` diferente de `"apostila"` ou `"playbook"` for fornecido, THEN THE Manual_Builder SHALL usar o layout `"apostila"` como fallback e registrar um aviso no log contendo o valor inválido recebido.
6. WHEN o parâmetro `layout` for omitido na chamada, THE Manual_Builder SHALL produzir o mesmo resultado que quando `layout="apostila"` é passado explicitamente.

---

### Requirement 2: Capa Padronizada

**User Story:** Como usuário do CaptureOS, quero que o PDF gerado inclua uma capa inicial padronizada com o título do tutorial, para que o documento tenha aparência profissional e identidade consistente.

#### Acceptance Criteria

1. THE Manual_Builder SHALL gerar uma página de capa como primeira página de todo PDF produzido.
2. THE Manual_Builder SHALL exibir na capa o valor do parâmetro `titulo` como título principal do documento, centralizado na região superior da capa.
3. THE Manual_Builder SHALL aplicar na capa a Cor_Principal `#00998F` como cor da barra decorativa superior da capa.
4. WHEN o parâmetro `logo_path` for fornecido com valor não vazio e o arquivo existir no sistema de arquivos, THE Manual_Builder SHALL exibir a Logo na capa com largura máxima de 5 cm, preservando a proporção original da imagem.
5. IF o arquivo referenciado por `logo_path` não existir no sistema de arquivos, THEN THE Manual_Builder SHALL gerar a capa sem a Logo e registrar um aviso no log indicando o caminho não encontrado.
6. THE Manual_Builder SHALL manter posição e tamanho fixos para a área do título e para a área da Logo na capa, variando apenas o conteúdo textual do título e o arquivo de imagem da Logo entre documentos diferentes.
7. WHEN o parâmetro `logo_path` for `None` ou não fornecido, THE Manual_Builder SHALL gerar a capa sem a Logo sem registrar aviso no log.
8. IF o parâmetro `titulo` for vazio ou não fornecido, THEN THE Manual_Builder SHALL interromper a geração do PDF, registrar um erro no log e retornar `False`.

---

### Requirement 3: Identidade Visual da Empresa

**User Story:** Como usuário do CaptureOS, quero que a identidade visual da empresa (cor principal e logo) seja aplicada de forma consistente no documento, para que os materiais gerados representem a marca da empresa.

#### Acceptance Criteria

1. THE Manual_Builder SHALL aplicar a Cor_Principal `#00998F` nos títulos de seção e nos labels de passo ao longo de todo o documento, tanto no Layout_Apostila quanto no Layout_Playbook.
2. THE Manual_Builder SHALL aceitar o parâmetro opcional `logo_path` do tipo string, com valor padrão `None`.
3. THE Manual_Builder SHALL aceitar o parâmetro opcional `logo_no_cabecalho` do tipo booleano, com valor padrão `False`, para controlar a exibição da Logo nas páginas de conteúdo fora da capa.
4. IF `logo_no_cabecalho` for `True` e `logo_path` apontar para um arquivo existente e legível em formato PNG ou JPEG, THEN THE Manual_Builder SHALL renderizar a Logo no cabeçalho de cada página de conteúdo com altura máxima de 1 cm, preservando a proporção original da imagem.
5. WHEN `logo_no_cabecalho` for `False` ou `logo_path` for `None`, THE Manual_Builder SHALL omitir a Logo do cabeçalho das páginas de conteúdo sem registrar aviso no log.
6. IF `logo_path` apontar para um arquivo existente mas inacessível ou em formato não suportado, THEN THE Manual_Builder SHALL omitir a Logo do cabeçalho, registrar um aviso no log descrevendo o motivo, e continuar a geração do PDF normalmente.

---

### Requirement 4: Compatibilidade com o Pipeline Existente

**User Story:** Como desenvolvedor do CaptureOS, quero que as melhorias não quebrem as chamadas existentes ao `gerar_pdf`, para que o Pipeline continue funcionando sem modificações.

#### Acceptance Criteria

1. THE Manual_Builder SHALL expor a função `gerar_pdf` com a assinatura `gerar_pdf(roteiro: list, output_path: str, titulo: str, layout: str = "apostila", logo_path: str = None, logo_no_cabecalho: bool = False) -> bool`, de forma que chamadas com apenas os três primeiros parâmetros continuem funcionando sem alteração de comportamento.
2. WHEN chamado sem os novos parâmetros, THE Manual_Builder SHALL gerar um PDF com Layout_Apostila, sem Logo na capa nem no cabeçalho, e com a Cor_Principal aplicada nos títulos de seção e labels de passo.
3. WHEN a geração do PDF for concluída com o arquivo gravado no `output_path`, THE Manual_Builder SHALL retornar `True`.
4. IF qualquer exceção ocorrer durante a geração do PDF antes ou após a gravação do arquivo, THEN THE Manual_Builder SHALL capturar a exceção, registrar o erro no log com tipo e mensagem da exceção, e retornar `False` sem propagar a exceção ao chamador.

---

### Requirement 5: Tratamento de Passos Especiais

**User Story:** Como usuário do CaptureOS, quero que os passos de introdução e conclusão sejam apresentados de forma adequada em ambos os layouts, para que o documento tenha início e fim claros.

#### Acceptance Criteria

1. WHEN o roteiro contiver um passo com número `0` cujo campo `ancora` contenha ao menos um caractere não-espaço, THE Manual_Builder SHALL exibir o conteúdo de `ancora` como texto de introdução sem exibir screenshot nem label de número de passo.
2. WHEN o roteiro contiver um passo com número `999` cujo campo `ancora` contenha ao menos um caractere não-espaço, THE Manual_Builder SHALL exibir o conteúdo de `ancora` como texto de conclusão sem exibir screenshot nem label de número de passo.
3. IF o passo de número `0` ou `999` tiver `ancora` nulo, vazio ou composto apenas de espaços em branco, THEN THE Manual_Builder SHALL ignorar esse passo, não produzindo conteúdo nem espaço reservado no PDF para ele.
4. WHEN um passo regular (número diferente de `0` e `999`) não tiver `ancora` preenchido (ao menos um caractere não-espaço) nem `micro_narracao` preenchido, THE Manual_Builder SHALL ignorar esse passo sem gerar conteúdo no PDF.
5. WHEN o Layout_Playbook for utilizado, THE Manual_Builder SHALL posicionar os passos especiais (0 e 999) em largura total da página, não os inserindo nas células da grade de 2 colunas.
6. WHEN o Layout_Apostila for utilizado, THE Manual_Builder SHALL posicionar os passos especiais (0 e 999) em largura total da coluna de conteúdo, de forma idêntica aos passos regulares sem screenshot.
