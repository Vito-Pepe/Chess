# Stato del progetto: Scacchi vs Stockfish

Ultimo aggiornamento: 2026-11-20. Serve per riprendere il lavoro in una nuova sessione.

## Obiettivo

Gioco di scacchi per uso personale sul Raspberry Pi 5, con Stockfish come avversario. Modalità: vs Stockfish (colore bianco/nero/casuale, livello 1–10, tempo di riflessione), 2 giocatori sullo stesso dispositivo, Stockfish vs Stockfish (livello per lato, pausa tra le mosse, pausa/stop). Colori di pezzi e case personalizzabili, salvati nel browser. Si può rivedere la partita mossa per mossa (⏮ ◀ ▶ ⏭, frecce della tastiera, clic sulla lista mosse) e chiedere a Stockfish la mossa consigliata per chi deve muovere. Modalità **Posizione libera**: editor della scacchiera (trascinamento con mouse e dita, oppure tocco pezzo + case, gomma, re unico per colore), scelta di chi muove, consiglio di Stockfish a piena forza (1/3/5 s) ed esecuzione della mossa consigliata. Ci si entra dal dialogo "Nuova partita" o con "Modifica posizione" durante una partita.

## Stato attuale

- **In produzione sul Pi** dal 2026-10-23: tutto in `main` (PR #1 prima versione, PR #2 revisione mosse, mossa consigliata e livelli 1–10). Cron di `update.sh` attivo.
- 2026-11-20: Elo indicativi accanto ai livelli (`GET /api/levels`, vedi sotto "Elo dei livelli").
- Provato in cloud: API con Stockfish 16, interfaccia con Playwright (mosse, promozione, matto, annulla, SvS con pausa/stop, colori, errore di rete, layout telefono, revisione mosse, mossa consigliata per bianco e nero, livelli, editor di posizione con mouse, tocchi e trascinamento touch).
- Provato sul Pi: build Docker, `docker compose`, API e gioco funzionano.

## Architettura

| Parte | Dove | Note |
|---|---|---|
| Frontend statico | `web/` | `index.html`, `style.css`, `app.js` (modulo ES). Regole con chess.js 1.0.0 in `web/vendor/` (BSD-2-Clause). |
| API Stockfish | `server/server.py` | Python, solo libreria standard. Un solo processo Stockfish con lock: una richiesta alla volta. `movetime` max 5 s. Livelli in `LEVELS` (vedi sotto). |
| Servizio web | `Dockerfile`, `nginx.conf` | nginx:alpine, serve `web/` e inoltra `/api/` a `stockfish:8000` (resolver Docker, parte anche se Stockfish non è pronto). |
| Compose | `docker-compose.yml` | Servizi `web` (porta **8085**) e `stockfish` (`cpus: 2`, `SF_THREADS=2`, `SF_HASH_MB=64`). Tutti e due con un `healthcheck` ogni minuto (`web`: `/` con `wget`; `stockfish`: `/api/health` con Python, perché l'immagine non ha `wget`): se uno si blocca diventa `unhealthy` e il guardiano del Pi (repo `guardiano`) lo riavvia. |
| Aggiornamento | `update.sh` | Come nelle altre repo: se ci sono commit nuovi sul branch corrente fa pull, rebuild, riavvio. |

Editor (`web/app.js`, sezione "posizione libera"): la posizione è una mappa casa → pezzo; la FEN si costruisce al volo (arrocco dedotto da re e torri nelle case iniziali, niente en passant). Prima di chiedere la mossa controlla: un re per colore, nessun pedone in prima/ottava, re di chi non muove non sotto scacco, niente matto/stallo.

API: `POST /api/move` `{"fen", "level", "movetime"}` → `{"move": "e2e4"}` (`null` se non ci sono mosse legali). Senza `level` gioca alla massima forza: lo usa "Consiglia mossa" (1 s di riflessione). Accetta anche `elo` (1350–2850), non usato dall'interfaccia. `GET /api/levels` → `{"engine": "Stockfish 15.1", "elo": {"1": 350, …, "9": 2750}, "max": 2850}`: Elo dei livelli per la versione di Stockfish in uso (la legge dalla riga `id name` dell'UCI), mostrati nella pagina accanto ai nomi.

### Livelli di Stockfish

| Livello | Nome | Impostazione | Elo con Stockfish 15.1 | Elo con Stockfish 16+ |
|---|---|---|---|---|
| 1 | Principiante | Skill 0, profondità 1, 50% mosse casuali | ≈350 | ≈350 |
| 2 | Novizio | Skill 0, profondità 1, 20% mosse casuali | ≈750 | ≈750 |
| 3 | Facile | Skill 0, profondità 2 | ≈1350 | ≈1350 |
| 4 | Dilettante | Skill 2, profondità 4 | ≈1600 | ≈1550 |
| 5 | Intermedio | Skill 5 | ≈1850 | ≈2200 |
| 6 | Giocatore di circolo | Skill 8 | ≈2100 | ≈2600 |
| 7 | Esperto | Skill 11 | ≈2350 | ≈2850 |
| 8 | Maestro | Skill 14 | ≈2550 | ≈3000 |
| 9 | Gran maestro | Skill 17 | ≈2750 | ≈3150 |
| 10 | Massimo | piena forza | oltre 2850 | oltre 3190 |

Verificato con partite tra livelli vicini (0,1 s a mossa): ogni livello batte nettamente il precedente. Le mosse casuali arrivano da `go perft 1` di Stockfish. `GET /api/health` → `{"ok": true}`.

**Elo dei livelli** (`levels_info` in `server/server.py`, arrotondati a 50). Sul Pi l'immagine `python:3.12-slim-bookworm` installa lo Stockfish di Debian bookworm (dovrebbe essere la 15.1; il server lo legge da solo). La scala è quella con cui Stockfish tara `UCI_Elo`: Elo CCRL dei motori (goldfish 1.13 = 2000), partite 60 s + 0,6 s. Non è FIDE né chess.com: la pagina lo dice sotto i livelli.
- Livelli 3–9: la formula di Stockfish (struttura `Skill` in `search.cpp`) al contrario. Fino alla 15.1: Elo = 1346,6 + 143,4 × skill^0,806 (UCI_Elo 1350–2850). Dalla 16: e = (Elo − 1320) / 1870 con skill = ((37,2473 e − 40,8525) e + 22,2943) e − 0,311438 (UCI_Elo 1320–3190). Lo Skill Level sceglie la mossa alla profondità 1 + skill, quindi questi Elo non dipendono dal tempo di riflessione; i limiti di profondità dei livelli 3 e 4 sono sopra quella profondità e non cambiano niente.
- Livelli 1 e 2: le mosse casuali Stockfish non le conosce. Misurato in cloud con Stockfish 16, 400 partite per coppia a 0,1 s a mossa, con il codice del server: il 3 batte il 2 di +576 Elo (95%: 510–680), il 2 batte l'1 di +436 (383–508), il 3 batte l'1 di +920 (200 partite, 199 vinte). Nel server: −575 e −1000 rispetto allo Skill 0 (`RANDOM_ELO_DROP`). Sono stime più grezze: nelle stesse partite il 4 batte il 3 di +126 (93–161), contro i +250 della formula ufficiale.
- Livello 10: piena forza, dipende da tempo e hardware; si scrive solo "oltre" il massimo di `UCI_Elo`.

## Il Raspberry Pi e le porte già in uso

Pi: hostname `vito`, utente `pepe`, IP LAN `192.168.1.22`, Tailscale `100.96.58.127`. Dettagli completi in `STATO-PROGETTO.md` della repo `sillabe`.

| Porta | App |
|---|---|
| 8080 | Sillabe |
| 8081 | Homepage |
| 8082 | Parole (app) |
| 8083 | Parole (esercizi pubblici) |
| 8084 | Giochi della homepage (solo `127.0.0.1`) |
| **8085** | **Scacchi (questa repo)** |

`tailscale serve` HTTPS: 443 (homepage) e 8443 (sillabe) già usate, quindi Scacchi si apre via Tailscale in http su `http://vito:8085` (cifrato comunque da Tailscale).

## Deploy e comandi sul Pi

```bash
ssh pepe@192.168.1.22
cd ~ && git clone https://github.com/Vito-Pepe/Chess.git && cd Chess
docker compose up --build -d
curl http://127.0.0.1:8085/api/health
```

Cron (`crontab -e`, senza `sudo`):

```
*/5 * * * * cd /home/pepe/Chess && ./update.sh >> /home/pepe/Chess/update.log 2>&1
```

Utili:

```bash
cd ~/Chess && docker compose ps
cd ~/Chess && docker compose logs --tail 50
tail -f ~/Chess/update.log
vcgencmd measure_temp
```

Indirizzi: `http://192.168.1.22:8085` (casa), `http://vito:8085` (Tailscale).

## Flusso di lavoro

Come per le altre repo: modifiche su un branch, pull request verso `main`, unione con **"Create a merge commit"**. Entro 5 minuti il cron aggiorna il Pi.

## Da fare

- [x] Unire la PR #1.
- [x] Unire la PR #2 e fare il primo deploy sul Pi.
- [x] Aggiungere la riga di cron per `update.sh`.
- [ ] (Opzionale) Riquadro Scacchi nella homepage: una riga in `app/apps.js` della repo homepage con `lanPort: 8085`.
