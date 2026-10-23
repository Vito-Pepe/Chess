import { Chess } from './vendor/chess.js';

// Glifi "pieni" per entrambi i colori; ︎ forza la resa come testo (non emoji).
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' };
const FILES = 'abcdefgh';
const MODE_NAMES = { pvp: '2 giocatori', pve: 'Vs Stockfish', eve: 'Stockfish vs Stockfish' };

const $ = (sel) => document.querySelector(sel);
const boardEl = $('#board');

const game = new Chess();
const state = {
  mode: 'pve',
  human: 'w',          // colore del giocatore in modalità pve
  elo: 1500,
  eloW: 2000,
  eloB: 2000,
  movetime: 500,
  delay: 1000,
  orientation: 'w',
  selected: null,
  thinking: false,
  paused: false,
  stopped: false,
  error: null,
  runId: 0,            // cambia a ogni nuova partita/annulla: le risposte vecchie vengono ignorate
  timer: null,
};

// ---------------------------------------------------------------- scacchiera

function squaresInOrder() {
  const out = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const file = state.orientation === 'w' ? f : 7 - f;
      const rank = state.orientation === 'w' ? 8 - r : r + 1;
      out.push({ sq: FILES[file] + rank, file, rank, row: r, col: f });
    }
  }
  return out;
}

function pieceSpan(color, type) {
  const span = document.createElement('span');
  span.className = `piece ${color}`;
  span.textContent = GLYPH[type];
  return span;
}

function renderBoard() {
  const last = game.history({ verbose: true }).at(-1);
  const targets = new Map();
  if (state.selected) {
    for (const m of game.moves({ square: state.selected, verbose: true })) {
      targets.set(m.to, m.captured !== undefined);
    }
  }
  let checkSq = null;
  if (game.inCheck()) {
    for (const row of game.board()) {
      for (const p of row) {
        if (p && p.type === 'k' && p.color === game.turn()) checkSq = p.square;
      }
    }
  }

  const frag = document.createDocumentFragment();
  for (const { sq, file, rank, row, col } of squaresInOrder()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.square = sq;
    btn.className = 'sq ' + ((file + rank) % 2 === 0 ? 'light' : 'dark');
    if (last && (sq === last.from || sq === last.to)) btn.classList.add('last');
    if (sq === state.selected) btn.classList.add('selected');
    if (sq === checkSq) btn.classList.add('check');
    if (targets.has(sq)) {
      btn.classList.add('hint');
      if (targets.get(sq)) btn.classList.add('capture');
    }
    const p = game.get(sq);
    btn.setAttribute('aria-label', sq + (p ? ` ${p.color === 'w' ? 'bianco' : 'nero'} ${p.type}` : ''));
    if (p) btn.append(pieceSpan(p.color, p.type));
    if (col === 0) btn.append(coord('rank', rank));
    if (row === 7) btn.append(coord('file', FILES[file]));
    frag.append(btn);
  }
  boardEl.replaceChildren(frag);
}

function coord(kind, text) {
  const s = document.createElement('span');
  s.className = `coord ${kind}`;
  s.textContent = text;
  return s;
}

// ---------------------------------------------------------------- stato e UI

function gameOverText() {
  if (game.isCheckmate()) return `Scacco matto: vince il ${game.turn() === 'w' ? 'nero' : 'bianco'}.`;
  if (game.isStalemate()) return 'Patta per stallo.';
  if (game.isInsufficientMaterial()) return 'Patta per materiale insufficiente.';
  if (game.isThreefoldRepetition()) return 'Patta per triplice ripetizione.';
  if (game.isDrawByFiftyMoves()) return 'Patta per la regola delle 50 mosse.';
  return null;
}

function renderStatus() {
  const over = gameOverText();
  const side = game.turn() === 'w' ? 'Bianco' : 'Nero';
  let text;
  if (over) text = over;
  else if (state.stopped) text = 'Partita interrotta.';
  else if (state.thinking) text = `Stockfish (${side.toLowerCase()}) sta pensando…`;
  else if (state.mode === 'eve' && state.paused) text = 'In pausa.';
  else if (state.mode === 'pve') text = game.turn() === state.human ? 'Tocca a te.' : `Muove ${side.toLowerCase()}.`;
  else text = `Muove il ${side.toLowerCase()}.`;
  if (!over && game.inCheck()) text += ' Scacco!';
  $('#status').textContent = text;

  const err = $('#error');
  err.hidden = !state.error;
  err.textContent = state.error ?? '';

  let label = MODE_NAMES[state.mode];
  if (state.mode === 'pve') label += ` · giochi col ${state.human === 'w' ? 'bianco' : 'nero'} · ${state.elo} Elo`;
  if (state.mode === 'eve') label += ` · ${state.eloW} vs ${state.eloB} Elo`;
  $('#mode-label').textContent = label;

  const finished = !!over || state.stopped;
  $('#btn-undo').hidden = state.mode === 'eve';
  $('#btn-undo').disabled = game.history().length === 0;
  $('#btn-pause').hidden = state.mode !== 'eve' || finished;
  $('#btn-pause').textContent = state.paused ? 'Riprendi' : 'Pausa';
  $('#btn-stop').hidden = state.mode !== 'eve' || finished;
  $('#btn-retry').hidden = !state.error || finished;
}

function renderMoves() {
  const list = $('#moves');
  const sans = game.history();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < sans.length; i += 2) {
    const li = document.createElement('li');
    for (const san of sans.slice(i, i + 2)) {
      const s = document.createElement('span');
      s.textContent = san;
      li.append(s);
    }
    frag.append(li);
  }
  list.replaceChildren(frag);
  list.scrollTop = list.scrollHeight;
}

function render() {
  renderBoard();
  renderStatus();
  renderMoves();
}

// ---------------------------------------------------------------- mosse del giocatore

function humanCanMove() {
  if (game.isGameOver() || state.stopped || state.thinking) return false;
  if (state.mode === 'pvp') return true;
  if (state.mode === 'pve') return game.turn() === state.human;
  return false;
}

boardEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.sq');
  if (!btn || !humanCanMove()) return;
  const sq = btn.dataset.square;

  if (state.selected) {
    const moves = game.moves({ square: state.selected, verbose: true }).filter((m) => m.to === sq);
    if (moves.length) {
      const from = state.selected;
      let promotion;
      if (moves.some((m) => m.promotion)) {
        promotion = await askPromotion(game.turn());
        if (!promotion) return;  // dialogo chiuso: resta selezionato
      }
      state.selected = null;
      game.move({ from, to: sq, promotion });
      afterMove();
      return;
    }
  }

  const p = game.get(sq);
  state.selected = p && p.color === game.turn() && sq !== state.selected ? sq : null;
  renderBoard();
});

function askPromotion(color) {
  const dlg = $('#dlg-promo');
  const box = $('#promo-choices');
  return new Promise((resolve) => {
    box.replaceChildren(...['q', 'r', 'b', 'n'].map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.append(pieceSpan(color, t));
      b.addEventListener('click', () => { dlg.close(t); });
      return b;
    }));
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue || null), { once: true });
    dlg.showModal();
  });
}

function afterMove() {
  state.error = null;
  render();
  scheduleEngine();
}

// ---------------------------------------------------------------- Stockfish

function engineToMove() {
  if (game.isGameOver() || state.stopped) return false;
  if (state.mode === 'pve') return game.turn() !== state.human;
  if (state.mode === 'eve') return !state.paused;
  return false;
}

function scheduleEngine() {
  clearTimeout(state.timer);
  if (!engineToMove() || state.thinking) return;
  const id = state.runId;
  const wait = state.mode === 'eve' ? Math.max(500, state.delay) : 150;
  state.timer = setTimeout(() => { if (id === state.runId) engineMove(); }, wait);
}

async function engineMove() {
  if (!engineToMove() || state.thinking) return;
  const id = state.runId;
  const elo = state.mode === 'eve' ? (game.turn() === 'w' ? state.eloW : state.eloB) : state.elo;
  state.thinking = true;
  state.error = null;
  renderStatus();
  try {
    const res = await fetch('api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: game.fen(), elo, movetime: state.movetime }),
    });
    const data = await res.json().catch(() => ({}));
    if (id !== state.runId) return;
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (!data.move) throw new Error('Stockfish non ha restituito una mossa');
    const m = data.move;
    game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  } catch (err) {
    if (id !== state.runId) return;
    state.error = `Errore dal motore: ${err.message}. Il server è raggiungibile?`;
  } finally {
    if (id === state.runId) state.thinking = false;
  }
  if (id !== state.runId) return;
  render();
  if (!state.error) scheduleEngine();
}

// ---------------------------------------------------------------- comandi

function cancelPending() {
  state.runId++;
  state.thinking = false;
  clearTimeout(state.timer);
}

function newGame(opts) {
  cancelPending();
  Object.assign(state, opts);
  if (state.human === 'random') state.human = Math.random() < 0.5 ? 'w' : 'b';
  state.orientation = state.mode === 'pve' ? state.human : 'w';
  state.selected = null;
  state.paused = false;
  state.stopped = false;
  state.error = null;
  game.reset();
  render();
  scheduleEngine();
}

$('#btn-undo').addEventListener('click', () => {
  if (state.mode === 'eve') return;
  cancelPending();
  state.selected = null;
  state.error = null;
  state.stopped = false;
  game.undo();
  if (state.mode === 'pve') {
    while (game.history().length && game.turn() !== state.human) game.undo();
  }
  render();
  scheduleEngine();  // es. annullato fino all'inizio quando Stockfish ha il bianco
});

$('#btn-flip').addEventListener('click', () => {
  state.orientation = state.orientation === 'w' ? 'b' : 'w';
  renderBoard();
});

$('#btn-pause').addEventListener('click', () => {
  state.paused = !state.paused;
  if (state.paused) clearTimeout(state.timer);
  renderStatus();
  scheduleEngine();
});

$('#btn-stop').addEventListener('click', () => {
  cancelPending();
  state.stopped = true;
  render();
});

$('#btn-retry').addEventListener('click', () => {
  state.error = null;
  renderStatus();
  engineMove();
});

// ---------------------------------------------------------------- dialogo nuova partita

const dlgNew = $('#dlg-new');
const formNew = $('#form-new');

function syncNewForm() {
  const mode = formNew.elements.mode.value;
  for (const el of formNew.querySelectorAll('[data-for]')) {
    el.hidden = !el.dataset.for.split(' ').includes(mode);
  }
  for (const out of formNew.querySelectorAll('output[data-out]')) {
    out.value = formNew.elements[out.dataset.out].value;
  }
}
formNew.addEventListener('input', syncNewForm);

$('#btn-new').addEventListener('click', () => {
  syncNewForm();
  dlgNew.showModal();
});

dlgNew.addEventListener('close', () => {
  if (dlgNew.returnValue !== 'ok') return;
  const f = formNew.elements;
  newGame({
    mode: f.mode.value,
    human: f.color.value,
    elo: +f.elo.value,
    eloW: +f.eloW.value,
    eloB: +f.eloB.value,
    movetime: +f.movetime.value,
    delay: +f.delay.value,
  });
});

// ---------------------------------------------------------------- colori

const COLORS_KEY = 'scacchi-colori';
const PRESETS = {
  Classico: { whitePiece: '#ffffff', blackPiece: '#222222', lightSquare: '#f0d9b5', darkSquare: '#b58863' },
  Legno:    { whitePiece: '#fff4e0', blackPiece: '#3b2414', lightSquare: '#e3c16f', darkSquare: '#8b5a2b' },
  Verde:    { whitePiece: '#ffffff', blackPiece: '#1e1e1e', lightSquare: '#eeeed2', darkSquare: '#769656' },
  Blu:      { whitePiece: '#ffffff', blackPiece: '#1b2a41', lightSquare: '#dee3e6', darkSquare: '#8ca2ad' },
  Notte:    { whitePiece: '#e8e8e8', blackPiece: '#111111', lightSquare: '#5a6270', darkSquare: '#2c313a' },
};
const DEFAULT_COLORS = PRESETS.Classico;
const CSS_VAR = { whitePiece: '--white-piece', blackPiece: '--black-piece', lightSquare: '--light-square', darkSquare: '--dark-square' };

let colors = loadColors();

function loadColors() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLORS_KEY));
    if (saved && Object.keys(DEFAULT_COLORS).every((k) => /^#[0-9a-f]{6}$/i.test(saved[k]))) return saved;
  } catch { /* storage non disponibile */ }
  return { ...DEFAULT_COLORS };
}

function saveColors() {
  try { localStorage.setItem(COLORS_KEY, JSON.stringify(colors)); } catch { /* ignora */ }
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function applyColors() {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(CSS_VAR)) root.setProperty(v, colors[k]);
  // contorno scuro sui pezzi chiari e viceversa, così restano leggibili su ogni casa
  root.setProperty('--white-outline', luminance(colors.whitePiece) > 0.4 ? '#000' : '#fff');
  root.setProperty('--black-outline', luminance(colors.blackPiece) > 0.4 ? '#000' : '#fff');
  for (const input of document.querySelectorAll('[data-color]')) input.value = colors[input.dataset.color];
}

for (const input of document.querySelectorAll('[data-color]')) {
  input.addEventListener('input', () => {
    colors[input.dataset.color] = input.value;
    applyColors();
    saveColors();
  });
}

$('#presets').append(...Object.entries(PRESETS).map(([name, p]) => {
  const b = document.createElement('button');
  b.type = 'button';
  const sw = document.createElement('span');
  sw.className = 'swatch';
  for (const c of [p.lightSquare, p.darkSquare, p.darkSquare, p.lightSquare]) {
    const i = document.createElement('i');
    i.style.background = c;
    sw.append(i);
  }
  b.append(sw, name);
  b.addEventListener('click', () => { colors = { ...p }; applyColors(); saveColors(); });
  return b;
}));

$('#btn-colors-reset').addEventListener('click', () => {
  colors = { ...DEFAULT_COLORS };
  applyColors();
  saveColors();
});

$('#btn-colors').addEventListener('click', () => $('#dlg-colors').showModal());

// ---------------------------------------------------------------- avvio

applyColors();
render();
syncNewForm();
dlgNew.showModal();
