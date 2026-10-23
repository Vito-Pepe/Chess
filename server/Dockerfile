# Debian ha il pacchetto stockfish anche per arm64 (Raspberry Pi 5)
FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*
ENV STOCKFISH_PATH=/usr/games/stockfish
WORKDIR /srv
COPY server.py .
EXPOSE 8000
CMD ["python", "server.py"]
