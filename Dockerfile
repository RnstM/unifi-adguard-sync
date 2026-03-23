# Stage 1: Build React frontend
FROM node:20-slim AS frontend-builder
WORKDIR /dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

# Stage 2: Python runtime
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sync/ ./sync/
COPY api/ ./api/
COPY main.py .
COPY --from=frontend-builder /dashboard/dist ./dashboard/dist
ARG VERSION=dev
ENV APP_VERSION=${VERSION}
RUN useradd -r -s /sbin/nologin appuser && \
    mkdir -p /data && \
    chown appuser /data
USER appuser
CMD ["python", "-u", "main.py"]
