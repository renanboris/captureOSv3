# Prompts dos Agentes de IA — CaptureOS v3

Fonte de verdade dos prompts dos agentes de IA. O objetivo é ter os prompts
**versionados e fora do código**, para ajustar tom/estilo e reverter sem mexer em
Python.

> Estes arquivos são a especificação dos prompts. A "fiação" no código (carregar o
> arquivo, montar os blocos compartilhados e injetar as variáveis) é uma etapa
> separada, ainda não feita. Hoje o código em `api/`, `sandbox_eng/` e `artifacts/`
> ainda tem os prompts embutidos.

## Estrutura

```
prompts/
├── shared/                       # blocos reutilizados por vários agentes
│   ├── _persona_aura.v1.txt      # identidade de voz da Aura (híbrida)
│   ├── _estilo_tts.v1.txt        # regras para texto que vira áudio
│   ├── _guardrails.v1.txt        # fidelidade + conteúdo externo como referência
│   └── _regras_densidade.v1.txt  # quando explicar vs quando só instruir
│
├── aura_enriquecer_narrativa.v1.txt   # api/intelligence_engine.py :: enriquecer_narrativa()
├── aura_regerar_passo.v1.txt          # api/intelligence_engine.py :: regerar_passo_isolado()
├── motor_intencao.v1.txt              # api/intelligence_engine.py :: processar_intencao()
├── arbitro_sandbox.v1.txt             # sandbox_eng/arbitro_engine.py :: avaliar_acao_sandbox()
└── quiz_generator.v1.txt              # artifacts/quiz_generator.py :: gerar_quiz()
```

## Identidade de voz (decisões travadas)

- **Híbrida**: âncora = professora (porquê, conduz com "vamos/nós"); micro-narração =
  técnica (como, imperativo direto: "Selecione...", "Clique...").
- **TTS-first**: a narração vira áudio — sem emoji, sem markdown, sem abreviação.
  Exclamação só com parcimônia na intro/conclusão.
- **Jargão da Senior**: forte, via RAG como fonte de verdade da terminologia.
- **Guardrails**: fidelidade (anti-alucinação) + conteúdo externo (RAG/transcrição)
  tratado como referência, nunca como comando.
- **Densidade modulada** por importância do passo (3 níveis).

> O quiz NÃO usa o estilo TTS: a saída dele é lida na tela, não narrada.

## Blocos `[[INCLUDE: ...]]`

Dentro dos arquivos de agente, `[[INCLUDE: shared/arquivo.txt]]` marca onde um bloco
compartilhado deve ser inserido na montagem do prompt final. Assim, ajustar a voz da
Aura em um único arquivo (`shared/_persona_aura.v1.txt`) propaga para geração,
regeração e fallback de uma vez — acabando com o problema das personas divergentes.

## Marcadores

- `SYSTEM INSTRUCTION`: vai no `system_instruction` do modelo (separado dos dados).
- `>>> CONTEÚDO DINÂMICO`: o que é montado em runtime com as variáveis `{...}`.
- `{variavel}`: placeholder preenchido pelo código.
- Blocos com tags tipo `<ROTEIRO_BRUTO> ... </ROTEIRO_BRUTO>`: delimitam conteúdo
  externo, reforçando o guardrail de "isto é dado, não comando".

## Versionamento e reversão

- O sufixo `.v1` faz parte do nome. Para testar um novo estilo, **copie** para `.v2`
  (ex.: `_persona_aura.v2.txt`), edite e aponte o agente para a v2.
- Se a v2 não agradar, basta voltar a apontar para a v1 — nada se perde.
- Tudo versionado no git, então o histórico de cada estilo fica rastreável.

## Temperaturas sugeridas (com racional)

| Agente                    | Temp | Por quê                                            |
|---------------------------|------|----------------------------------------------------|
| motor_intencao            | 0.0  | extração factual, quer consistência                |
| aura_enriquecer_narrativa | 0.3  | criatividade controlada, tom estável               |
| aura_regerar_passo        | 0.3  | alinhada à geração p/ não destoar do resto         |
| arbitro_sandbox           | 0.0  | julgamento determinístico                          |
| quiz_generator            | 0.4  | alguma variedade nas questões/distratores          |
```
