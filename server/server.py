"""Server minimale che espone Stockfish via HTTP.

POST /api/move  {"fen": "...", "elo": 1500, "movetime": 500}
             -> {"move": "e2e4"}

Solo libreria standard. Un unico processo Stockfish serve una richiesta alla
volta (lock): niente picchi di carico, adatto a un Raspberry Pi.
"""
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STOCKFISH = os.environ.get("STOCKFISH_PATH", "stockfish")
THREADS = int(os.environ.get("SF_THREADS", "2"))
HASH_MB = int(os.environ.get("SF_HASH_MB", "64"))
MAX_MOVETIME = 5000  # ms, tetto di sicurezza
ELO_MIN, ELO_MAX = 1350, 2850  # intervallo valido per UCI_Elo in tutte le versioni

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

    def best_move(self, fen, elo, movetime):
        self.send("ucinewgame")
        self.send("setoption name UCI_LimitStrength value true")
        self.send(f"setoption name UCI_Elo value {elo}")
        self.send(f"position fen {fen}")
        self.send(f"go movetime {movetime}")
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
            elo = max(ELO_MIN, min(ELO_MAX, int(req.get("elo", 1500))))
            movetime = max(50, min(MAX_MOVETIME, int(req.get("movetime", 500))))
        except (KeyError, ValueError, TypeError, json.JSONDecodeError) as e:
            return self._reply(400, {"error": str(e)})
        try:
            with lock:
                move = get_engine().best_move(fen, elo, movetime)
        except Exception as e:  # motore crashato: verrà riavviato alla prossima richiesta
            return self._reply(500, {"error": str(e)})
        self._reply(200, {"move": move})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    print(f"Stockfish API su :{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
