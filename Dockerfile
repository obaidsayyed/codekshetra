# Unified SUNDAY PWA + Backend Dockerfile
FROM node:20-slim AS frontend-builder
WORKDIR /app/sunday
COPY sunday/package*.json ./
RUN npm install
COPY sunday/ ./
RUN npm run build:renderer

FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libsndfile1 espeak-ng ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=frontend-builder /app/sunday/dist ./sunday/dist

ENV HOST=0.0.0.0
ENV PORT=8765

EXPOSE 8765
CMD ["python", "-m", "app.main", "--server"]

