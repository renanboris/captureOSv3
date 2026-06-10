# Requirements Document

## Introduction

Esta especificação define a integração de um arquivo de intro .mov no sistema de renderização de vídeos do video_eng. O sistema atual renderiza vídeos com freeze frames, overlays personalizados e narração TTS usando uma pipeline FFmpeg otimizada (passada única com filter_complex). O objetivo é adicionar a intro .mov no início de cada vídeo renderizado preservando a velocidade de renderização existente.

## Glossary

- **Video_Eng**: Módulo Python responsável pela renderização de vídeos com composição de freeze frames e overlays
- **Intro_Video**: Arquivo .mov pré-renderizado que será adicionado no início de cada vídeo final
- **Time_Bender**: Componente do Video_Eng que implementa a composição de vídeos com freeze frames e timeline de áudio
- **Filter_Complex**: Pipeline de filtros do FFmpeg que processa vídeo e áudio em passada única
- **Timeline_Events**: Lista de eventos que definem timestamps de freeze frames e áudio TTS
- **Overlay_Frame**: Moldura PNG com área transparente aplicada sobre o vídeo
- **Rendering_Pipeline**: Processo completo de composição do vídeo (FFmpeg primário, MoviePy fallback)
- **Configuration_System**: Sistema de configuração que permite ativar/desativar features do Video_Eng

## Requirements

### Requirement 1: Intro Video Concatenation

**User Story:** Como usuário do sistema de renderização, eu quero que minha intro .mov seja automaticamente adicionada no início de cada vídeo renderizado, para que todos os vídeos tenham branding consistente.

#### Acceptance Criteria

1. WHEN a intro .mov é configurada, THE Video_Eng SHALL adicionar o arquivo intro como primeiro segmento do vídeo final
2. THE Video_Eng SHALL preservar a resolução original da intro sem re-escalar ou distorcer
3. WHEN a intro possui áudio, THE Video_Eng SHALL preservar a trilha de áudio da intro no vídeo final
4. THE Intro_Video SHALL ser processada antes da aplicação de overlays ao conteúdo principal
5. WHEN a intro não está configurada, THE Video_Eng SHALL renderizar o vídeo normalmente sem intro

### Requirement 2: Performance Preservation

**User Story:** Como desenvolvedor, eu quero que a adição da intro não comprometa a velocidade de renderização, para que o sistema continue sendo rápido e eficiente.

#### Acceptance Criteria

1. THE Video_Eng SHALL utilizar concatenação de vídeo via FFmpeg concat demuxer ou concat filter
2. THE Video_Eng SHALL processar intro e conteúdo principal em passada única (single-pass)
3. THE Rendering_Pipeline SHALL evitar re-encodar a intro quando possível (stream copy)
4. WHEN a intro possui codec incompatível, THE Video_Eng SHALL re-encodar apenas a intro com preset fast
5. THE Video_Eng SHALL manter o tempo total de renderização dentro de 110% do tempo atual para vídeos sem intro

### Requirement 3: Intro Configuration Management

**User Story:** Como usuário, eu quero configurar qual arquivo .mov usar como intro, para que eu possa atualizar ou desativar a intro facilmente.

#### Acceptance Criteria

1. THE Configuration_System SHALL definir um caminho padrão para o arquivo de intro
2. THE Configuration_System SHALL permitir especificar um caminho customizado para o arquivo de intro
3. THE Configuration_System SHALL validar a existência do arquivo de intro antes da renderização
4. WHEN o arquivo de intro não existe, THE Video_Eng SHALL registrar um warning e renderizar sem intro
5. THE Configuration_System SHALL permitir desativar a intro via flag booleano (enable_intro)

### Requirement 4: Codec and Format Compatibility

**User Story:** Como desenvolvedor, eu quero garantir compatibilidade de codec entre intro e vídeo principal, para que a concatenação seja eficiente e sem erros.

#### Acceptance Criteria

1. THE Video_Eng SHALL verificar o codec da intro antes da concatenação
2. WHEN a intro usa codec diferente do vídeo principal (libx264), THE Video_Eng SHALL re-encodar a intro
3. THE Video_Eng SHALL normalizar a taxa de frames da intro para 30 FPS (FPS constante do sistema)
4. THE Video_Eng SHALL normalizar a resolução da intro para corresponder ao canvas final (com ou sem overlay)
5. WHEN a intro possui proporção de aspecto diferente, THE Video_Eng SHALL aplicar pad ou crop para manter consistência visual

### Requirement 5: Audio Stream Handling

**User Story:** Como usuário, eu quero que a intro e a narração TTS coexistam corretamente, para que o áudio final seja completo e sincronizado.

#### Acceptance Criteria

1. THE Video_Eng SHALL preservar o áudio da intro no segmento inicial do vídeo final
2. THE Video_Eng SHALL posicionar os áudios TTS após a duração da intro (offset temporal)
3. THE Timeline_Events SHALL considerar a duração da intro no cálculo de timestamps de freeze frames
4. WHEN a intro não possui áudio, THE Video_Eng SHALL iniciar os áudios TTS normalmente após o vídeo da intro
5. THE Video_Eng SHALL mixar corretamente áudio da intro + áudio TTS sem clipping ou distorção

### Requirement 6: Overlay Integration with Intro

**User Story:** Como usuário, eu quero que o overlay seja aplicado apenas ao conteúdo principal, para que a intro apareça sem moldura.

#### Acceptance Criteria

1. THE Video_Eng SHALL renderizar a intro em tela cheia sem aplicar o Overlay_Frame
2. THE Video_Eng SHALL aplicar o Overlay_Frame apenas ao conteúdo principal após a intro
3. WHEN a intro possui resolução diferente do canvas do overlay, THE Video_Eng SHALL normalizar antes da concatenação
4. THE Video_Eng SHALL garantir transição visual suave entre intro (sem overlay) e conteúdo (com overlay)
5. WHERE overlay está desativado, THE Video_Eng SHALL concatenar intro e conteúdo sem moldura em ambos

### Requirement 7: Error Handling and Fallback

**User Story:** Como desenvolvedor, eu quero que erros na intro não quebrem a renderização do vídeo principal, para que o sistema seja robusto e resiliente.

#### Acceptance Criteria

1. WHEN a intro falha ao carregar, THE Video_Eng SHALL registrar erro e continuar renderização sem intro
2. WHEN a intro falha na re-encoding, THE Video_Eng SHALL tentar usar o arquivo original
3. IF a concatenação com intro falha, THEN THE Video_Eng SHALL renderizar apenas o conteúdo principal
4. THE Video_Eng SHALL retornar código de sucesso mesmo quando a intro é pulada por erro
5. THE Video_Eng SHALL registrar no log todas as decisões de fallback relacionadas à intro

### Requirement 8: Integration with Existing Rendering Paths

**User Story:** Como desenvolvedor, eu quero que a intro funcione em ambos os caminhos de renderização (FFmpeg e MoviePy fallback), para que o sistema seja consistente.

#### Acceptance Criteria

1. THE Video_Eng SHALL implementar concatenação de intro no pipeline FFmpeg primário
2. THE Video_Eng SHALL implementar concatenação de intro no fallback MoviePy
3. WHEN FFmpeg path adiciona intro com sucesso, THE Video_Eng SHALL evitar invocar MoviePy fallback
4. THE Video_Eng SHALL produzir resultados visuais idênticos em ambos os caminhos (FFmpeg e MoviePy)
5. THE Video_Eng SHALL calcular duração total do vídeo final incluindo a intro em ambos os caminhos

### Requirement 9: Intro Duration Detection

**User Story:** Como desenvolvedor, eu preciso detectar a duração da intro automaticamente, para que o sistema possa ajustar timestamps corretamente.

#### Acceptance Criteria

1. THE Video_Eng SHALL usar ffprobe para detectar a duração da intro em segundos
2. THE Video_Eng SHALL validar que a duração da intro é maior que 0 segundos
3. WHEN ffprobe falha, THE Video_Eng SHALL registrar erro e desativar a intro para aquela renderização
4. THE Video_Eng SHALL cachear a duração da intro por caminho de arquivo durante a sessão
5. THE Video_Eng SHALL ajustar todos os timestamps de Timeline_Events adicionando a duração da intro

### Requirement 10: Testing and Validation

**User Story:** Como desenvolvedor, eu quero validar que a intro funciona corretamente em diferentes cenários, para que o sistema seja confiável.

#### Acceptance Criteria

1. THE Video_Eng SHALL ser testado com intro contendo áudio e intro silenciosa
2. THE Video_Eng SHALL ser testado com intro em diferentes resoluções (720p, 1080p, 4K)
3. THE Video_Eng SHALL ser testado com intro em diferentes codecs (H.264, H.265, ProRes)
4. THE Video_Eng SHALL ser testado com intro de diferentes durações (1s, 3s, 5s, 10s)
5. THE Video_Eng SHALL ser testado com e sem overlay ativo ao adicionar a intro
