# Scacchi

Gioco di scacchi per uso personale, pensato per girare su un Raspberry Pi 5, con Stockfish come avversario.

- **Vs Stockfish**: scegli bianco, nero o casuale, forza (1350–2850 Elo) e tempo di riflessione.
- **2 giocatori** sullo stesso dispositivo.
- **Stockfish vs Stockfish**: Elo diverso per i due lati, pausa tra le mosse, pausa/stop.
- **Colori personalizzabili** di pezzi e case (preset inclusi), salvati nel browser.

Le regole (mosse legali, scacco matto, patte) sono gestite nel browser da [chess.js](https://github.com/jhlywa/chess.js) 1.0.0 (licenza BSD-2-Clause, copiato in `web/vendor/`). Stockfish gira in un piccolo servizio Python che serve una richiesta alla volta, per non sovraccaricare il Pi.

## Struttura

```
Dockerfile           # web: nginx:alpine con i file di web/
docker-compose.yml   # servizi web (porta 80) + stockfish
nginx.conf           # serve web/ e inoltra /api/ al servizio stockfish
web/                 # frontend statico (index.html, style.css, app.js)
server/              # API Stockfish (Python, solo libreria standard)
```

API: `POST /api/move` con `{"fen": "...", "elo": 1500, "movetime": 500}` → `{"move": "e2e4"}` (`null` se non ci sono mosse). `GET /api/health` → `{"ok": true}`.

## Deploy sul Raspberry Pi 5

1. Installa Docker (Raspberry Pi OS 64 bit):
   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER   # poi esci e rientra
   ```
2. Clona la repo e avvia:
   ```sh
   git clone https://github.com/Vito-Pepe/Chess.git
   cd Chess
   docker compose up --build -d
   ```
3. Apri `http://<ip-del-pi>/` dal browser.

Per aggiornare: `git pull && docker compose up --build -d`.

### Accesso da fuori casa

Usa [Tailscale](https://tailscale.com) sul Pi e sui tuoi dispositivi: nessuna porta da aprire sul router.

```sh
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Poi apri `http://<nome-del-pi>/` (o l'IP Tailscale) da telefono o computer collegati alla stessa tailnet.

### Carico e temperatura

Stockfish usa fino a 2 core (`SF_THREADS` e `cpus` in `docker-compose.yml`) e al massimo 5 s per mossa. In modalità Stockfish vs Stockfish il processore resta sotto carico per tutta la partita: è consigliato il dissipatore attivo ufficiale. Controlla la temperatura con `vcgencmd measure_temp`.

## Sviluppo locale

Senza Docker serve `stockfish` installato:

```sh
STOCKFISH_PATH=$(which stockfish) PORT=8000 python3 server/server.py
```

e un server statico per `web/` che inoltri `/api/` alla porta 8000.
