FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb \
    xauth \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY templates/project-scaffold/requirements.txt /tmp/requirements.txt

RUN python -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
  && /opt/venv/bin/playwright install --with-deps chromium

WORKDIR /app

COPY worker/ /app/worker/

RUN chmod +x /app/worker/run-pytest.sh /app/worker/healthcheck.sh

ENV PORT=8081
EXPOSE 8081

CMD ["python", "/app/worker/server.py"]
