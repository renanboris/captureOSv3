# Capture OS v3 POC (Hybrid Intelligence Layer)

POC isolada para demonstrar a arquitetura híbrida de captura e execução com enriquecimento visual (Gemini Vision) e semântico (AXTree).

## Setup

1. Crie um ambiente virtual (opcional mas recomendado):
   ```bash
   python -m venv venv
   source venv/bin/activate  # ou `venv\Scripts\activate` no Windows
   ```

2. Instale as dependências:
   ```bash
   pip install -r requirements.txt
   playwright install chromium
   ```

3. Configure as variáveis de ambiente. Crie um arquivo `.env` na pasta `poc/` com:
   ```env
   POC_URL=https://sua-url-de-teste.com
   GOOGLE_API_KEY=sua_chave_aqui
   POC_OUTPUT_DIR=poc/output
   ```

## 1. Captura (`poc_capture.py`)

Inicia um navegador e captura cliques, scroll e navegação.

```bash
python poc_capture.py
```
- O script fará o **auto-login** automaticamente (via `auth.py`) caso a tela de login da Senior X seja detectada. Durante esse processo, a captura de eventos fica pausada para evitar lixo no fluxo.
- Após o login, navegue na página. A cada clique interativo, o sistema capturará screenshots anotadas (SoM) e o enriquecimento CDP.
- Feche o navegador para encerrar a sessão.
- O script vai enviar os eventos em lote para o Gemini gerar as intenções semânticas e salvar o resultado final `capture_YYYYMMDD_HHMMSS.jsonl` na pasta `output/`.

## 2. Execução (`poc_executor.py`)

Lê o arquivo `jsonl` e reexecuta os passos usando a arquitetura inteligente (Verificação de pré-condição com Atalho DOM -> Ação resiliente com iframes -> Verificação macro de pós-condição via Gemini).

```bash
python poc_executor.py poc/output/capture_YYYYMMDD_HHMMSS.jsonl
```
- A execução abrirá a URL inicial do fluxo capturado.
- Se o sistema detectar a tela de login, o **auto-login** também atuará de forma autônoma.
- Em seguida, executará cada evento lendo a melhor estratégia de seletor.
- Um log `execution_YYYYMMDD_HHMMSS.jsonl` será gerado na pasta `output/`.
