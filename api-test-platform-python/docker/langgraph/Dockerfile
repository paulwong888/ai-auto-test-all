FROM python:3.13-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js for CodeGraph
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g codegraph

# Install Python deps
COPY backend/requirements.txt .
RUN pip install --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy source
COPY backend/ .

EXPOSE 8200

CMD ["langgraph", "dev", "--host", "0.0.0.0", "--port", "8200", "--n-jobs-per-worker", "10", "--no-reload", "--no-browser"]
