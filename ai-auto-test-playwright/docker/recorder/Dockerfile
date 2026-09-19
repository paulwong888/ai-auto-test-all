FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc fluxbox websockify novnc git curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY templates/project-scaffold/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt \
  && /opt/venv/bin/playwright install --with-deps chromium

COPY docker/recorder/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 6080
ENTRYPOINT ["/entrypoint.sh"]
