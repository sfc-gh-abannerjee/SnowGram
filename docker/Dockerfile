# =====================================================
# SnowGram Multi-Stage Dockerfile
# =====================================================
# Stage 1: Build Frontend (React/Next.js)
# Stage 2: Build Backend (Python/FastAPI)
# Stage 3: Final production image
# =====================================================

# =====================================================
# Stage 1: Frontend Build
# =====================================================
FROM node:18-alpine AS frontend-build

WORKDIR /frontend

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm install --production

# Copy frontend source
COPY frontend/ ./

# Build frontend (Next.js static export or production build)
RUN npm run build

# =====================================================
# Stage 2: Backend Build
# =====================================================
FROM python:3.11-slim AS backend-build

WORKDIR /backend

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY backend/requirements.txt ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./

# =====================================================
# Stage 3: Production Image
# =====================================================
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependencies from backend-build
COPY --from=backend-build /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend-build /usr/local/bin /usr/local/bin

# Copy backend application
COPY --from=backend-build /backend /app/backend

# Copy frontend build
COPY --from=frontend-build /frontend/.next /app/frontend/.next
COPY --from=frontend-build /frontend/node_modules /app/frontend/node_modules
COPY --from=frontend-build /frontend/public /app/frontend/public
COPY --from=frontend-build /frontend/package.json /app/frontend/

# Copy nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Copy supervisor configuration
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create necessary directories
RUN mkdir -p /var/log/supervisor /var/log/nginx /var/log/snowgram

# Expose ports
# 8000: FastAPI backend
# 3000: Next.js frontend
# 80: Nginx reverse proxy
EXPOSE 80 8000 3000

# Environment variables (override via docker-compose or SPCS spec)
# Note: SNOWFLAKE_PASSWORD should be provided via Snowflake secrets, not ENV
ENV SNOWFLAKE_ACCOUNT=""
ENV SNOWFLAKE_USER=""
ENV SNOWFLAKE_ROLE="SNOWGRAM_APP_ROLE"
ENV SNOWFLAKE_WAREHOUSE="SNOWGRAM_WH"
ENV SNOWFLAKE_DATABASE="SNOWGRAM_DB"
ENV SNOWFLAKE_SCHEMA="CORE"
ENV CORTEX_AGENT_NAME="SNOWGRAM_AGENT"
ENV LOG_LEVEL="INFO"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost/health || exit 1

# Start supervisor (manages nginx + FastAPI + Next.js)
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]






