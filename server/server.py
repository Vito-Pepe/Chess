"""Server minimale che espone Stockfish via HTTP.

POST /api/move  {"fen": "...", "level": 5, "movetime": 500}
             -> {"move": "e2e4"}
"level" va da 1 (più scarso) a 10 (massima forza), vedi LEVELS. In
alternativa "elo" (1350-2850). Senza nessuno dei due: massima forza.

Solo libreria standard. Un unico processo Stockfish serve una richiesta alla
volta (lock): niente picchi di carico, adatto a un Raspberry Pi.
"""
import json
import os
import random
import re
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STOCKFISH = os.environ.get("STOCKFISH_PATH", "stockfish")
THREADS = int(os.environ.get("SF_THREADS", "2"))
HASH_MB = int(os.environ.get("SF_HASH_MB", "64"))
MAX_MOVETIME = 5000  # ms, tetto di sicurezza
ELO_MIN, ELO_MAX = 1350, 2850  # intervallo valido per UCI_Elo in tutte le versioni

# Livelli dal più scarso al più forte, con "Skill Level" (0-20) di Stockfish.
# Sotto Skill Level 0 si limita la profondità e si aggiunge una quota di
# mosse casuali ("random": probabilità), altrimenti un principiante perde sempre.
LEVELS = {
    1: {"skill": 0, "depth": 1, "random": 0.5},
    2: {"skill": 0, "depth": 1, "random": 0.2},
    3: {"skill": 0, "depth": 2},
    4: {"skill": 2, "depth": 4},
    5: {"skill": 5},
    6: {"skill": 8},
    7: {"skill": 11},
    8: {"skill": 14},
    9: {"skill": 17},
    10: {},  # massima forza
}

MOVE_RE = re.compile(r"^([a-h][1-8][a-h][1-8][qrbn]?):")  # righe di "go perft 1"

lock = threading.Lock()


class Engine:
    def __init__(self):
        self.proc = subprocess.Popen(
            [STOCKFISH], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.send("uci")
        self.wait_for("uciok")
        self.send(f"setoption name Threads value {THREADS}")
        self.send(f"setoption name Hash value {HASH_MB}")
        self.send("isready")
        self.wait_for("readyok")

    def send(self, cmd):
        self.proc.stdin.write(cmd + "\n")
        self.proc.stdin.flush()

    def wait_for(self, prefix):
        for line in self.proc.stdout:
            if line.startswith(prefix):
                return line.strip()
        raise RuntimeError("Stockfish terminato")

    def legal_moves(self, fen):
        self.send(f"position fen {fen}")
        self.send("go perft 1")
        moves = []
        for line in self.proc.stdout:
            if line.startswith("Nodes searched"):
                return moves
            m = MOVE_RE.match(line)
            if m:
                moves.append(m.group(1))
        raise RuntimeError("Stockfish terminato")

    def best_move(self, fen, strength, movetime):
        """strength: dizionario come in LEVELS ({} = massima forza)."""
        if random.random() < strength.get("random", 0):
            moves = self.legal_moves(fen)
            return random.choice(moves) if moves else None
        self.send("ucinewgame")
        # UCI_LimitStrength ha la precedenza su Skill Level: va spento se non serve
        if "elo" in strength:
            self.send("setoption name UCI_LimitStrength value true")
            self.send(f"setoption name UCI_Elo value {strength['elo']}")
        else:
            self.send("setoption name UCI_LimitStrength value false")
        self.send(f"setoption name Skill Level value {strength.get('skill', 20)}")
        self.send(f"position fen {fen}")
        depth = f"depth {strength['depth']} " if "depth" in strength else ""
        self.send(f"go {depth}movetime {movetime}")
        parts = self.wait_for("bestmove").split()
        move = parts[1] if len(parts) > 1 else "(none)"
        return None if move == "(none)" else move


engine = None


def get_engine():
    global engine
    if engine is None or engine.proc.poll() is not None:
        engine = Engine()
    return engine


class Handler(BaseHTTPRequestHandler):
    def _reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/health":
            self._reply(200, {"ok": True})
        else:
            self._reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/api/move":
            return self._reply(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > 2048:
                raise ValueError("richiesta troppo grande")
            req = json.loads(self.rfile.read(length))
            fen = str(req["fen"])
            if "\n" in fen or "\r" in fen:
                raise ValueError("fen non valido")
            if req.get("level") is not None:
                level = int(req["level"])
                if level not in LEVELS:
                    raise ValueError("livello non valido")
                strength = LEVELS[level]
            elif req.get("elo") is not None:
                strength = {"elo": max(ELO_MIN, min(ELO_MAX, int(req["elo"])))}
            else:
                strength = {}
            movetime = max(50, min(MAX_MOVETIME, int(req.get("movetime", 500))))
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as e:
            return self._reply(400, {"error": str(e)})
        try:
            with lock:
                move = get_engine().best_move(fen, strength, movetime)
        except Exception as e:  # motore crashato: verrà riavviato alla prossima richiesta
            return self._reply(500, {"error": str(e)})
        self._reply(200, {"move": move})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"Stockfish API su :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
