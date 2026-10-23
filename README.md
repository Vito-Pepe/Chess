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

Stesso schema delle altre app sul Pi (sillabe, homepage, parole): Docker e Tailscale già installati, il Pi segue `main` e si aggiorna da solo con `update.sh` via cron. L'app usa la porta **8085** (8080–8084 sono già occupate).

```sh
cd ~
git clone https://github.com/Vito-Pepe/Chess.git
cd Chess
docker compose up --build -d
curl http://127.0.0.1:8085/api/health   # {"ok": true}
```

Aggiornamento automatico ogni 5 minuti (`crontab -e`, senza `sudo`):

```
*/5 * * * * cd /home/pepe/Chess && ./update.sh >> /home/pepe/Chess/update.log 2>&1
```

Aggiornamento a mano: `cd ~/Chess && ./update.sh`.

### Indirizzi

- In casa: `http://192.168.1.22:8085`
- Da fuori casa, con Tailscale: `http://vito:8085` (il traffico è già cifrato da Tailscale, come per Parole su 8082). Non serve `tailscale serve`, le cui porte HTTPS sono già usate dalle altre app.

### Carico e temperatura

Stockfish usa fino a 2 core (`SF_THREADS` e `cpus` in `docker-compose.yml`) e al massimo 5 s per mossa. In modalità Stockfish vs Stockfish il processore resta sotto carico per tutta la partita: è consigliato il dissipatore attivo ufficiale. Controlla la temperatura con `vcgencmd measure_temp`.

## Sviluppo locale

Senza Docker serve `stockfish` installato:

```sh
STOCKFISH_PATH=$(which stockfish) PORT=8000 python3 server/server.py
```

e un server statico per `web/` che inoltri `/api/` alla porta 8000.
