# Capture OS v3

Bem-vindo ao **Capture OS v3**! Este projeto é uma plataforma avançada para gravação de tutoriais de software e conversão automática deles em vídeos super dinâmicos com narração IA (Aura), além de gerar módulos interativos no Modo Prática (Sandbox).

A arquitetura do projeto divide-se em duas partes principais:
1. **Extensão do Chrome (`/extension`):** Responsável por gravar a tela, áudio e capturar toda a árvore semântica do DOM em tempo real (Radar V3).
2. **Backend Python/FastAPI (`/api`):** Orquestra o pipeline, enriquecendo logs crus através da IA (Gemini 2.5 Flash / Pinecone RAG), recriando a timeline do vídeo (`time_bender`) e validando as intenções no modo prática (`arbitro_engine`).

## 🚀 Arquitetura e Evolução da v3
Durante a Fase 3 e evoluções mais recentes, nós:
- Migramos do uso exclusivo da captura de cliques para a extração do **Set-of-Marks (geometria e semântica real do DOM)** via `radar_v3.js`.
- Refatoramos a lógica do Árbitro (`arbitro_engine.py`) para validação rápida (`XPath`, `CSS` e `Text`) com fallback para o motor LLM caso seja um passo subjetivo.
- Evoluímos a re-renderização (`rerender_pipeline.py`) para preservar a sincronia usando os `start_time_ms` reais.
- Implementamos a possibilidade de **Regerar via IA** um passo específico dentro do Editor web.

---

## 🛠 Como Rodar o Projeto

### 1. Requisitos
- **Python 3.9+** instalado
- **Google Chrome** instalado
- **FFmpeg** instalado na máquina e disponível nas variáveis de ambiente (necessário para processamento do vídeo).

### 2. Configurando o Backend Local
Crie e ative um ambiente virtual:
```bash
python -m venv venv

# Windows
.\venv\Scripts\activate
# Linux/Mac
source venv/bin/activate
```

Instale as dependências:
```bash
pip install -r requirements.txt
```

Crie um arquivo `.env` na raiz do projeto com as chaves das APIs necessárias:
```env
GOOGLE_API_KEY=sua_chave_do_google_aqui
PINECONE_API_KEY=sua_chave_do_pinecone_aqui
# BACKEND_URL=http://localhost:8000 # Opcional caso queira hospedar em produção
```

Inicie o servidor (FastAPI):
```bash
uvicorn api.main:app --reload
```

### 3. Configurando a Extensão
1. No Google Chrome, acesse `chrome://extensions/`.
2. Ative o **Modo do Desenvolvedor** (Developer mode).
3. Clique em **Carregar sem compactação** (Load unpacked).
4. Selecione a pasta `extension` do repositório.

Feito isso, o ícone da extensão Capture OS aparecerá no seu navegador. Basta clicar no ícone, selecionar o modo que desejar (Capturar Tela, Modo Prática, etc.) e gravar o seu fluxo!

---

## 🧩 Estrutura de Diretórios
- `api/` - Endpoints REST, orquestração dos pipelines de exportação/edição.
- `extension/` - Extensão Web Extension (Manifest v3).
- `frontend/` - UI do Editor Roteiro (`editor.html`) e motor do Sandbox (`simlink.js`).
- `video_eng/` - Processamento FFmpeg, geração TTS e time bending.
- `sandbox_eng/` - Motores do Árbitro do modo prática.
- `simlink_eng/` - Construção dos módulos educacionais.
- `contracts/` - Modelos Pydantic.
- `data/` - Armazenamento de estado, vídeos e roteiros (substituindo provisoriamente um banco de dados em nuvem).

## 💡 Próximos Passos (Roadmap)
- Integrar os storage files em nuvem (AWS S3 ou Supabase Storage).
- Migrar o banco local (data/status/ JSONs) para Postgres/Supabase SQL.
- Deploy da Extensão na Chrome Web Store.
