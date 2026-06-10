# Requirements Document

## Introduction

Este documento especifica os requisitos para refinar o scorm_builder, sistema que gera pacotes SCORM interativos com prints, passo a passo, menu com legenda e indicação de passos. As melhorias visam aumentar a precisão de cliques usando seletores disponíveis (xpath, css_selector) e integrar opcionalmente quizzes ao final do conteúdo SCORM.

## Glossary

- **SCORM_Builder**: Sistema que gera pacotes SCORM 1.2 interativos com modo Try (prática guiada)
- **Try_Player**: Motor JavaScript que executa a simulação interativa dentro do pacote SCORM
- **Hotspot**: Zona clicável de um passo da simulação, contendo coordenadas, seletores e metadados
- **SimlinkModulo**: Estrutura de dados que contém todos os hotspots e metadados de uma sessão de captura
- **Quiz_Generator**: Sistema existente que gera questões de múltipla escolha baseadas no roteiro
- **Click_Detector**: Componente do Try_Player responsável por validar cliques do usuário
- **Highlight_Renderer**: Componente do Try_Player que desenha bordas indicativas na tela
- **LMS**: Learning Management System (plataforma que hospeda conteúdos SCORM)

## Requirements

### Requirement 1: Detecção de Cliques com Precisão Baseada em Seletores

**User Story:** Como desenvolvedor do sistema, quero que o Try_Player use xpath e css_selector prioritariamente para detectar cliques corretos, para que as bordas indicativas sejam precisas e os cliques sejam validados com exatidão, mesmo quando a resolução da tela difere do screenshot original.

#### Acceptance Criteria

1. WHEN o Try_Player inicializa um passo com hotspot válido, THE Click_Detector SHALL tentar identificar o elemento DOM usando o css_selector do hotspot
2. IF o css_selector não localizar um elemento válido, THEN THE Click_Detector SHALL tentar identificar o elemento DOM usando o xpath do hotspot
3. IF ambos os seletores falharem, THEN THE Click_Detector SHALL usar detecção baseada em coordenadas com tolerância percentual como fallback
4. WHEN um clique ocorre na área da simulação, THE Click_Detector SHALL verificar se o elemento clicado corresponde ao elemento identificado pelo seletor
5. WHEN a verificação de seletor indica acerto, THE Click_Detector SHALL registrar o acerto com prioridade sobre a detecção por coordenadas
6. FOR ALL hotspots válidos com seletores, a taxa de precisão de detecção de cliques SHALL ser superior a 95% em diferentes resoluções de tela

### Requirement 2: Renderização Precisa de Bordas Indicativas

**User Story:** Como usuário do treinamento SCORM, quero que as bordas indicativas (hints e reveals) sejam desenhadas exatamente sobre os elementos interativos, para que eu consiga identificar claramente onde devo clicar.

#### Acceptance Criteria

1. WHEN o Highlight_Renderer desenha uma borda indicativa com hotspot válido, THE Highlight_Renderer SHALL tentar obter as dimensões reais do elemento DOM usando o css_selector
2. IF o css_selector não localizar um elemento, THEN THE Highlight_Renderer SHALL tentar usando o xpath
3. IF ambos os seletores falharem, THEN THE Highlight_Renderer SHALL usar as coordenadas do hotspot escaladas proporcionalmente ao tamanho da imagem
4. WHEN as dimensões são obtidas do elemento DOM, THE Highlight_Renderer SHALL calcular a posição da borda baseando-se no getBoundingClientRect() do elemento
5. WHEN as dimensões são obtidas por coordenadas, THE Highlight_Renderer SHALL aplicar escala proporcional baseada na razão entre o tamanho natural da imagem e o tamanho renderizado
6. THE Highlight_Renderer SHALL aplicar offset de posição considerando a posição da imagem de fundo no container da simulação
7. FOR ALL hotspots com seletores válidos, a precisão de posicionamento de bordas SHALL ter margem de erro inferior a 5 pixels em resoluções entre 1280x720 e 1920x1080

### Requirement 3: Fallback Gracioso para Coordenadas

**User Story:** Como desenvolvedor do sistema, quero que o sistema continue funcionando com detecção baseada em coordenadas quando seletores não estiverem disponíveis ou falharem, para que conteúdos legados ou capturas sem seletores continuem utilizáveis.

#### Acceptance Criteria

1. WHEN um hotspot não possui css_selector ou xpath definidos, THE Click_Detector SHALL usar exclusivamente detecção baseada em coordenadas
2. WHEN um hotspot possui seletores mas nenhum elemento DOM é localizado, THE Click_Detector SHALL usar detecção baseada em coordenadas como fallback
3. WHEN a detecção por coordenadas é ativada, THE Click_Detector SHALL usar tolerância percentual de 4% (TOL = 0.04) em todas as direções
4. WHEN a detecção por coordenadas calcula limites, THE Click_Detector SHALL normalizar as coordenadas do hotspot pela resolução natural da imagem
5. THE Click_Detector SHALL registrar no console do navegador quando o fallback de coordenadas é utilizado (para fins de debugging)

### Requirement 4: Integração Opcional de Quiz ao Final do SCORM

**User Story:** Como administrador do sistema, quero poder incluir opcionalmente um quiz ao final de um pacote SCORM, para que os usuários possam validar conhecimento após a prática guiada.

#### Acceptance Criteria

1. WHEN o SCORM_Builder recebe um parâmetro incluir_quiz=True durante a geração, THE SCORM_Builder SHALL invocar o Quiz_Generator para gerar questões baseadas nos hotspots do módulo
2. WHEN o Quiz_Generator retorna questões válidas, THE SCORM_Builder SHALL incluir os dados do quiz no arquivo data/quiz.js dentro do pacote SCORM
3. WHEN o Try_Player conclui todos os passos da simulação e existe quiz.js carregado, THE Try_Player SHALL exibir tela de transição informando "Quiz de Validação"
4. WHEN o usuário avança da tela de transição, THE Try_Player SHALL renderizar o componente de quiz com as questões carregadas
5. WHEN o usuário responde todas as questões do quiz, THE Try_Player SHALL calcular a pontuação do quiz (percentual de acertos)
6. WHEN a pontuação do quiz é calculada, THE Try_Player SHALL incluir a pontuação no cmi.core.score.raw junto com o XP da simulação (formato: "{xp_simulacao}|{percentual_quiz}")
7. IF o Quiz_Generator falhar ou retornar lista vazia, THEN THE SCORM_Builder SHALL gerar o pacote SCORM sem quiz e registrar warning no log

### Requirement 5: Renderização do Componente de Quiz no Try_Player

**User Story:** Como usuário do treinamento SCORM, quero responder questões de múltipla escolha ao final da prática guiada, para que eu possa validar meu conhecimento e receber feedback.

#### Acceptance Criteria

1. WHEN o componente de quiz é renderizado, THE Try_Player SHALL exibir uma questão por vez com seu enunciado e 4 opções de resposta
2. WHEN o usuário seleciona uma resposta, THE Try_Player SHALL permitir navegação para a próxima questão
3. WHEN o usuário responde a última questão, THE Try_Player SHALL exibir tela de resultado com percentual de acertos
4. WHEN o resultado do quiz é exibido, THE Try_Player SHALL mostrar feedback visual (verde para aprovação >= 70%, amarelo para 50-69%, vermelho para < 50%)
5. THE Try_Player SHALL permitir que o usuário revise as respostas após a conclusão do quiz
6. WHEN o quiz é concluído, THE Try_Player SHALL salvar o progresso no cmi.suspend_data incluindo as respostas do usuário

### Requirement 6: Formato de Dados do Quiz

**User Story:** Como desenvolvedor do sistema, quero que o formato de dados do quiz seja compatível com o Quiz_Generator existente e facilmente consumível pelo Try_Player, para que a integração seja simples e manutenível.

#### Acceptance Criteria

1. THE Quiz_Generator SHALL retornar uma lista de questões no formato JSON conforme schema especificado
2. WHEN cada questão é gerada, THE Quiz_Generator SHALL incluir os campos: id, enunciado, opcoes (array de 4 strings), resposta_correta (índice 0-3)
3. THE SCORM_Builder SHALL serializar as questões no formato `const QUIZ_DATA = [...]` dentro de data/quiz.js
4. THE Try_Player SHALL validar a presença e estrutura de QUIZ_DATA antes de renderizar o componente de quiz
5. IF QUIZ_DATA estiver malformado, THEN THE Try_Player SHALL exibir mensagem de erro e pular para a conclusão da simulação

### Requirement 7: Parâmetro de Configuração para Número de Questões

**User Story:** Como administrador do sistema, quero poder especificar quantas questões o quiz deve conter, para que eu possa ajustar a profundidade da avaliação conforme o conteúdo.

#### Acceptance Criteria

1. WHEN o SCORM_Builder recebe o parâmetro num_questoes_quiz, THE SCORM_Builder SHALL passar esse valor para o Quiz_Generator
2. IF num_questoes_quiz não for fornecido, THEN THE SCORM_Builder SHALL usar valor padrão de 3 questões
3. THE SCORM_Builder SHALL validar que num_questoes_quiz está entre 1 e 10 inclusive
4. IF num_questoes_quiz estiver fora do intervalo válido, THEN THE SCORM_Builder SHALL usar o valor padrão e registrar warning no log

### Requirement 8: Compatibilidade com SCORM 1.2

**User Story:** Como desenvolvedor do sistema, quero que todas as melhorias sejam compatíveis com o padrão SCORM 1.2, para que os pacotes gerados continuem funcionando em plataformas LMS existentes (ex: Senior X Learning).

#### Acceptance Criteria

1. WHEN o Try_Player registra pontuação ou progresso, THE Try_Player SHALL usar exclusivamente campos definidos no padrão SCORM 1.2
2. THE Try_Player SHALL respeitar os limites de tamanho de cmi.suspend_data (4096 caracteres) definidos no SCORM 1.2
3. WHEN o tamanho dos dados de suspensão exceder 4096 caracteres, THE Try_Player SHALL comprimir ou truncar os dados priorizando informações de progresso atual
4. THE SCORM_Builder SHALL incluir no imsmanifest.xml apenas elementos e atributos válidos conforme schema SCORM 1.2
5. WHEN o pacote SCORM é validado contra schema SCORM 1.2, THE pacote SHALL passar sem erros de validação

### Requirement 9: Logs de Debugging para Seletores

**User Story:** Como desenvolvedor do sistema, quero que o Try_Player registre informações de debugging sobre seletores e fallbacks, para que eu possa diagnosticar problemas de precisão em produção.

#### Acceptance Criteria

1. WHEN o Click_Detector tenta localizar um elemento por seletor, THE Click_Detector SHALL registrar no console se o elemento foi encontrado
2. WHEN o Click_Detector usa fallback de coordenadas, THE Click_Detector SHALL registrar no console o motivo (seletor ausente ou elemento não encontrado)
3. WHEN o Highlight_Renderer calcula posição de borda, THE Highlight_Renderer SHALL registrar no console se usou DOM ou coordenadas
4. THE Try_Player SHALL usar console.debug() para logs de debugging, permitindo filtragem no console do navegador
5. WHERE o Try_Player detecta modo de execução LMS, THE Try_Player SHALL suprimir logs de debugging para não poluir o console do usuário final

### Requirement 10: Preservação de Funcionalidades Existentes

**User Story:** Como desenvolvedor do sistema, quero que as melhorias de precisão não quebrem funcionalidades existentes, para que pacotes SCORM legados continuem funcionando corretamente.

#### Acceptance Criteria

1. WHEN um pacote SCORM gerado antes das melhorias é executado no Try_Player atualizado, THE Try_Player SHALL funcionar corretamente usando detecção por coordenadas
2. THE Try_Player SHALL preservar o sistema de XP (pontos, tentativas, sequência perfeita) exatamente como está implementado
3. THE Try_Player SHALL preservar o sistema de feedback auditivo (narração via áudio ou TTS) sem modificações
4. THE Try_Player SHALL preservar as animações e transições de highlight existentes
5. THE Try_Player SHALL preservar a integração com SCORM API (init, set, get, save, quit) sem alterações
6. FOR ALL pacotes SCORM de teste existentes, a execução no Try_Player atualizado SHALL produzir resultados equivalentes aos da versão anterior

