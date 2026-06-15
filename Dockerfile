# Usar a imagem oficial do Python slim (menor e mais leve)
FROM python:3.11-slim

# Definir diretório de trabalho dentro do contêiner
WORKDIR /app

# Instalar dependências do sistema
# ffmpeg é necessário para a engine de vídeo
# As outras dependências (libglib2.0-0, libnss3, libasound2, etc) são para o Playwright (navegador Chromium)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation \
    xdg-utils \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copiar os arquivos de requisitos
COPY requirements.txt requirements-dev.txt ./

# Instalar as dependências do Python
RUN pip install --no-cache-dir -r requirements.txt

# Instalar os navegadores do Playwright
RUN playwright install chromium
RUN playwright install-deps chromium

# Copiar o restante do código do projeto para o diretório de trabalho
COPY . .

# Expor a porta que o FastAPI usará
EXPOSE 8000

# Comando para iniciar a aplicação
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
