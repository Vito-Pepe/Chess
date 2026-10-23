import { Chess } from './vendor/chess.js';

// Glifi "pieni" per entrambi i colori; ︎ forza la resa come testo (non emoji).
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟︎' };
const FILES = 'abcdefgh';
const MODE_NAMES = { pvp: '2 giocatori', pve: 'Vs Stockfish', eve: 'Stockfish vs Stockfish', edit: 'Posizione libera' };
// Livelli di Stockfish, dal più scarso al più forte (la forza vera è definita in server/server.py)
const LEVEL_NAMES = [, 'Principiante', 'Novizio', 'Facile', 'Dilettante', 'Intermedio',
  'Giocatore di circolo', 'Esperto', 'Maestro', 'Gran maestro', 'Massimo (piena forza)'];
const levelName = (n) => `${n} · ${LEVEL_NAMES[n]}`;

const $ = (sel) => document.querySelector(sel);
const boardEl = $('#board');

const game = new Chess();
const state = {
  mode: 'pve',
  human: 'w',          // colore del giocatore in modalità pve
  level: 4,
  levelW: 7,
  levelB: 7,
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
  view: null,          // null = posizione attuale, altrimenti numero di semimosse mostrate
  hint: null,          // { fen, from, to, san } consigliata da Stockfish
  hinting: false,
};

// Posizione mostrata: quella attuale o una precedente se si stanno rivedendo le mosse.
function shown() {
  if (state.view === null) return game;
  const g = new Chess();
  for (const san of game.history().slice(0, state.view)) g.move(san);
  return g;
}

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

function currentHint() {
  return state.view === null && state.hint && state.hint.fen === game.fen() ? state.hint : null;
}

function renderBoard() {
  if (state.mode === 'edit') return renderEditBoard();
  boardEl.classList.remove('editing');
  const g = shown();
  const last = g.history({ verbose: true }).at(-1);
  const hint = currentHint();
  const targets = new Map();
  if (state.selected) {
    for (const m of g.moves({ square: state.selected, verbose: true })) {
      targets.set(m.to, m.captured !== undefined);
    }
  }
  let checkSq = null;
  if (g.inCheck()) {
    for (const row of g.board()) {
      for (const p of row) {
        if (p && p.type === 'k' && p.color === g.turn()) checkSq = p.square;
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
    if (hint && (sq === hint.from || sq === hint.to)) btn.classList.add('suggest');
    if (targets.has(sq)) {
      btn.classList.add('hint');
      if (targets.get(sq)) btn.classList.add('capture');
    }
    const p = g.get(sq);
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
  $('#game-panel').hidden = state.mode === 'edit';
  $('#edit-panel').hidden = state.mode !== 'edit';
  if (state.mode === 'edit') return renderEditStatus();
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
  if (state.mode === 'pve') label += ` · giochi col ${state.human === 'w' ? 'bianco' : 'nero'} · livello ${levelName(state.level)}`;
  if (state.mode === 'eve') label += ` · livello ${state.levelW} vs ${state.levelB}`;
  $('#mode-label').textContent = label;

  const total = game.history().length;
  const ply = state.view ?? total;
  const viewText = $('#view-text');
  viewText.hidden = state.view === null;
  viewText.textContent = `Stai rivedendo la partita (semimossa ${ply} di ${total}). Premi ⏭ per tornare alla posizione attuale.`;
  $('#nav-start').disabled = $('#nav-prev').disabled = ply === 0;
  $('#nav-next').disabled = $('#nav-end').disabled = state.view === null;

  const hint = currentHint();
  const hintText = $('#hint-text');
  hintText.hidden = !hint && !state.hinting;
  hintText.textContent = state.hinting ? 'Stockfish cerca la mossa migliore…' : hint ? `Mossa consigliata: ${hint.san}` : '';

  const finished = !!over || state.stopped;
  $('#btn-hint').hidden = state.mode === 'eve';
  $('#btn-hint').disabled = !humanCanMove() || state.hinting;
  $('#btn-undo').hidden = state.mode === 'eve';
  $('#btn-undo').disabled = total === 0;
  $('#btn-pause').hidden = state.mode !== 'eve' || finished;
  $('#btn-pause').textContent = state.paused ? 'Riprendi' : 'Pausa';
  $('#btn-stop').hidden = state.mode !== 'eve' || finished;
  $('#btn-retry').hidden = !state.error || finished;
}

function renderMoves() {
  const list = $('#moves');
  const sans = game.history();
  const current = state.view ?? sans.length;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < sans.length; i += 2) {
    const li = document.createElement('li');
    sans.slice(i, i + 2).forEach((san, j) => {
      const s = document.createElement('span');
      s.textContent = san;
      s.dataset.ply = i + j + 1;
      if (i + j + 1 === current) s.classList.add('current');
      li.append(s);
    });
    frag.append(li);
  }
  list.replaceChildren(frag);
  const cur = list.querySelector('.current');
  if (state.view === null) list.scrollTop = list.scrollHeight;
  else cur?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- rivedere le mosse

function setView(ply) {
  const total = game.history().length;
  ply = Math.max(0, Math.min(total, ply));
  state.view = ply === total ? null : ply;
  state.selected = null;
  render();
}

$('#moves').addEventListener('click', (e) => {
  const s = e.target.closest('span[data-ply]');
  if (s) setView(+s.dataset.ply);
});
$('#nav-start').addEventListener('click', () => setView(0));
$('#nav-prev').addEventListener('click', () => setView((state.view ?? game.history().length) - 1));
$('#nav-next').addEventListener('click', () => setView((state.view ?? game.history().length) + 1));
$('#nav-end').addEventListener('click', () => setView(Infinity));

document.addEventListener('keydown', (e) => {
  if (state.mode === 'edit') return;
  if (document.querySelector('dialog[open]') || e.target.closest('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') setView((state.view ?? game.history().length) - 1);
  else if (e.key === 'ArrowRight') setView((state.view ?? game.history().length) + 1);
  else return;
  e.preventDefault();
});

function render() {
  renderBoard();
  renderStatus();
  renderMoves();
}

// ---------------------------------------------------------------- mosse del giocatore

function humanCanMove() {
  if (game.isGameOver() || state.stopped || state.thinking || state.view !== null) return false;
  if (state.mode === 'pvp') return true;
  if (state.mode === 'pve') return game.turn() === state.human;
  return false;
}

boardEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.sq');
  if (btn && state.mode === 'edit') return edTap(btn.dataset.square);
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
  state.hint = null;
  render();
  scheduleEngine();
}

// ---------------------------------------------------------------- mossa consigliata

const HINT_MOVETIME = 1000;

// Mossa migliore a piena forza (senza "level") -> { fen, from, to, promotion, san }
async function bestMove(fen, movetime) {
  const res = await fetch('api/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen, movetime }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (!data.move) throw new Error('Stockfish non ha restituito una mossa');
  const m = data.move;
  const move = { from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] };
  return { fen, ...move, san: new Chess(fen).move(move).san };
}

$('#btn-hint').addEventListener('click', async () => {
  if (!humanCanMove() || state.hinting) return;
  const fen = game.fen();
  state.hinting = true;
  state.hint = null;
  state.error = null;
  renderStatus();
  try {
    const hint = await bestMove(fen, HINT_MOVETIME);
    if (game.fen() === fen) state.hint = hint;
  } catch (err) {
    if (game.fen() === fen) state.error = `Consiglio non disponibile: ${err.message}.`;
  } finally {
    state.hinting = false;
  }
  render();
});

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
  const level = state.mode === 'eve' ? (game.turn() === 'w' ? state.levelW : state.levelB) : state.level;
  state.thinking = true;
  state.error = null;
  renderStatus();
  try {
    const res = await fetch('api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: game.fen(), level, movetime: state.movetime }),
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
  state.view = null;
  state.hint = null;
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
  if (state.mode === 'edit') edLoad(game);
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

// ---------------------------------------------------------------- posizione libera

// Posizione dell'editor: una mappa casa -> pezzo, così si può mettere qualsiasi
// cosa; la validità si controlla solo quando serve (vedi edProblem).
const ed = { board: {}, turn: 'w', stamp: null, hint: null, hinting: false, error: null };
const PALETTE = ['w', 'b'].flatMap((color) => ['k', 'q', 'r', 'b', 'n', 'p'].map((type) => ({ color, type })));
const COLOR_NAME = { w: 'bianco', b: 'nero' };

function edLoad(g) {
  ed.board = {};
  for (const row of g.board()) {
    for (const p of row) if (p) ed.board[p.square] = { color: p.color, type: p.type };
  }
  ed.turn = g.turn();
  ed.stamp = null;
  edChanged();
}

function edFen(turn = ed.turn) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (const f of FILES) {
      const p = ed.board[f + rank];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    rows.push(row + (empty || ''));
  }
  // arrocco possibile se re e torre sono ancora nelle case di partenza
  const at = (sq, color, type) => ed.board[sq]?.color === color && ed.board[sq]?.type === type;
  let castling = '';
  if (at('e1', 'w', 'k')) castling += (at('h1', 'w', 'r') ? 'K' : '') + (at('a1', 'w', 'r') ? 'Q' : '');
  if (at('e8', 'b', 'k')) castling += (at('h8', 'b', 'r') ? 'k' : '') + (at('a8', 'b', 'r') ? 'q' : '');
  return `${rows.join('/')} ${turn} ${castling || '-'} - 0 1`;
}

// null se si può chiedere la mossa, altrimenti il motivo
function edProblem() {
  const pieces = Object.entries(ed.board);
  for (const c of ['w', 'b']) {
    const kings = pieces.filter(([, p]) => p.color === c && p.type === 'k').length;
    if (kings !== 1) return `Serve esattamente un re ${COLOR_NAME[c]}.`;
  }
  if (pieces.some(([sq, p]) => p.type === 'p' && (sq[1] === '1' || sq[1] === '8'))) {
    return "I pedoni non possono stare sulla prima o sull'ottava traversa.";
  }
  const other = ed.turn === 'w' ? 'b' : 'w';
  try {
    if (new Chess(edFen(other)).inCheck()) {
      return `Il re ${COLOR_NAME[other]} è sotto scacco ma tocca al ${COLOR_NAME[ed.turn]}: posizione impossibile.`;
    }
    const g = new Chess(edFen());
    if (g.isCheckmate()) return `Il ${COLOR_NAME[ed.turn]} ha subito scacco matto: non ha mosse.`;
    if (g.isStalemate()) return `Stallo: il ${COLOR_NAME[ed.turn]} non ha mosse legali.`;
  } catch (err) {
    return `Posizione non valida (${err.message}).`;
  }
  return null;
}

function edCurrentHint() {
  return ed.hint && ed.hint.fen === edFen() ? ed.hint : null;
}

function edChanged() {
  ed.hint = null;
  ed.error = null;
  render();
}

function edPlace(sq, piece) {
  if (piece.type === 'k') {  // un solo re per colore: lo si sposta
    for (const [s, p] of Object.entries(ed.board)) {
      if (p.type === 'k' && p.color === piece.color) delete ed.board[s];
    }
  }
  ed.board[sq] = { ...piece };
}

function edTap(sq) {
  if (!ed.stamp) return;
  const p = ed.board[sq];
  if (ed.stamp === 'erase' || (p && p.color === ed.stamp.color && p.type === ed.stamp.type)) delete ed.board[sq];
  else edPlace(sq, ed.stamp);
  edChanged();
}

function renderEditBoard() {
  boardEl.classList.add('editing');
  const hint = edCurrentHint();
  const frag = document.createDocumentFragment();
  for (const { sq, file, rank, row, col } of squaresInOrder()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.square = sq;
    btn.className = 'sq ' + ((file + rank) % 2 === 0 ? 'light' : 'dark');
    if (hint && (sq === hint.from || sq === hint.to)) btn.classList.add('suggest');
    const p = ed.board[sq];
    btn.setAttribute('aria-label', sq + (p ? ` ${COLOR_NAME[p.color]} ${p.type}` : ''));
    if (p) btn.append(pieceSpan(p.color, p.type));
    if (col === 0) btn.append(coord('rank', rank));
    if (row === 7) btn.append(coord('file', FILES[file]));
    frag.append(btn);
  }
  boardEl.replaceChildren(frag);
}

function renderEditStatus() {
  const problem = edProblem();
  const hint = edCurrentHint();
  $('#mode-label').textContent = `${MODE_NAMES.edit} · consigli a piena forza`;
  $('#status').textContent = ed.hinting ? 'Stockfish analizza la posizione…'
    : problem ?? `Muove il ${COLOR_NAME[ed.turn]}. Premi "Consiglia mossa".`;
  $('#hint-text').hidden = !hint;
  $('#hint-text').textContent = hint ? `Mossa consigliata: ${hint.san}` : '';
  $('#error').hidden = !ed.error;
  $('#error').textContent = ed.error ?? '';
  $('#btn-edit-hint').disabled = !!problem || ed.hinting;
  $('#btn-edit-play').hidden = !hint;
  for (const r of document.querySelectorAll('input[name="edit-turn"]')) r.checked = r.value === ed.turn;
  for (const b of $('#palette').children) {
    const s = ed.stamp;
    b.classList.toggle('active', !!s && s !== 'erase' && s.color === b.dataset.color && s.type === b.dataset.type);
  }
  $('#btn-erase').classList.toggle('active', ed.stamp === 'erase');
}

$('#palette').append(...PALETTE.map(({ color, type }) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.color = color;
  b.dataset.type = type;
  b.setAttribute('aria-label', `${type} ${COLOR_NAME[color]}`);
  b.append(pieceSpan(color, type));
  return b;
}));

$('#palette').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const s = ed.stamp;
  const same = s && s !== 'erase' && s.color === b.dataset.color && s.type === b.dataset.type;
  ed.stamp = same ? null : { color: b.dataset.color, type: b.dataset.type };
  renderEditStatus();
});

$('#btn-erase').addEventListener('click', () => {
  ed.stamp = ed.stamp === 'erase' ? null : 'erase';
  renderEditStatus();
});

for (const r of document.querySelectorAll('input[name="edit-turn"]')) {
  r.addEventListener('change', () => { ed.turn = r.value; edChanged(); });
}

$('#btn-edit-hint').addEventListener('click', async () => {
  if (edProblem() || ed.hinting) return;
  const fen = edFen();
  ed.hinting = true;
  ed.hint = null;
  ed.error = null;
  render();
  try {
    const hint = await bestMove(fen, +$('#edit-time').value);
    if (edFen() === fen) ed.hint = hint;
  } catch (err) {
    if (edFen() === fen) ed.error = `Consiglio non disponibile: ${err.message}.`;
  } finally {
    ed.hinting = false;
  }
  render();
});

$('#btn-edit-play').addEventListener('click', () => {
  const hint = edCurrentHint();
  if (!hint) return;
  const g = new Chess(hint.fen);
  g.move(hint);
  edLoad(g);
});

$('#btn-edit-start').addEventListener('click', () => edLoad(new Chess()));
$('#btn-edit-clear').addEventListener('click', () => { ed.board = {}; edChanged(); });
$('#btn-edit-flip').addEventListener('click', () => {
  state.orientation = state.orientation === 'w' ? 'b' : 'w';
  renderBoard();
});
$('#btn-new-edit').addEventListener('click', () => $('#btn-new').click());

// "Modifica posizione" durante una partita: si parte dalla posizione mostrata
$('#btn-edit').addEventListener('click', () => {
  const g = shown();
  cancelPending();
  state.mode = 'edit';
  state.selected = null;
  state.error = null;
  edLoad(g);
});

// Trascinamento (mouse e dita) con i pointer event. Un tocco senza movimento
// resta un clic normale, gestito da edTap e dalla tavolozza.
let drag = null;

function startDrag(e, piece, from) {
  if (state.mode !== 'edit' || e.button > 0) return;
  drag = { piece, from, x: e.clientX, y: e.clientY, ghost: null };
}

boardEl.addEventListener('pointerdown', (e) => {
  const sq = e.target.closest('.sq')?.dataset.square;
  if (sq && ed.board[sq]) startDrag(e, ed.board[sq], sq);
});

$('#palette').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button');
  if (b) startDrag(e, { color: b.dataset.color, type: b.dataset.type }, null);
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.ghost) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.ghost = pieceSpan(drag.piece.color, drag.piece.type);
    drag.ghost.classList.add('ghost');
    document.body.append(drag.ghost);
    if (drag.from) boardEl.querySelector(`[data-square="${drag.from}"] .piece`)?.classList.add('lifted');
  }
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;
});

document.addEventListener('pointerup', (e) => {
  const d = drag;
  drag = null;
  if (!d?.ghost) return;
  d.ghost.remove();
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('#board .sq');
  if (d.from) delete ed.board[d.from];  // trascinato fuori dalla scacchiera: tolto
  if (target) edPlace(target.dataset.square, d.piece);
  edChanged();
  ignoreNextClick = true;  // il clic che segue il rilascio non è un tocco
});

let ignoreNextClick = false;
window.addEventListener('pointerdown', () => { ignoreNextClick = false; }, { capture: true });
window.addEventListener('click', (e) => {
  if (!ignoreNextClick) return;
  ignoreNextClick = false;
  e.stopPropagation();
}, { capture: true });

document.addEventListener('pointercancel', () => {
  drag?.ghost?.remove();
  drag = null;
  if (state.mode === 'edit') renderBoard();
});

// ---------------------------------------------------------------- dialogo nuova partita

const dlgNew = $('#dlg-new');
const formNew = $('#form-new');

function syncNewForm() {
  const mode = formNew.elements.mode.value;
  for (const el of formNew.querySelectorAll('[data-for]')) {
    el.hidden = !el.dataset.for.split(' ').includes(mode);
  }
  for (const out of formNew.querySelectorAll('output[data-level]')) {
    out.value = levelName(+formNew.elements[out.dataset.level].value);
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
    level: +f.level.value,
    levelW: +f.levelW.value,
    levelB: +f.levelB.value,
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
