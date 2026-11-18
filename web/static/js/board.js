// board.js — the FischerBot chessboard. The board is a view.
//
//   const board = new Board(rootElement, { pieceUrl, onMove });
//   board.setPosition(position, { lastMove, animate });
//   board.setOrientation(WHITE | BLACK);
//   board.setInteractive(WHITE | BLACK | null);
//   board.destroy();
//
// It knows the rules only through the rules.js Position it is shown: it draws
// that position, lets the user pick a LEGAL move (drag and drop, tap-tap or
// keyboard, with its own promotion picker) and reports it through onMove. It
// never plays the move itself: the controller answers with setPosition() and
// the board animates from what it shows to what it is given.
//
// Original code, no dependencies. Everything that does not need a DOM is a
// named export below so that it can be tested in Node (web/tests/board.test.js).
// Styles: ../css/board.css.

import { WHITE, BLACK, KNIGHT, BISHOP, ROOK, QUEEN, SQUARE_NAMES } from './rules.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const PIECE_LETTERS = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
const PIECE_NAMES = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };

/** The pieces the promotion picker offers, nearest the promotion square first. */
export const PROMOTION_ORDER = Object.freeze([QUEEN, ROOK, BISHOP, KNIGHT]);

/** 'wK' ... 'bP' for a colour (WHITE/BLACK) and a rules.js piece type. */
export function pieceCode(color, type) {
  return (color === WHITE ? 'w' : 'b') + PIECE_LETTERS[type];
}

/** Where a square is drawn: column and row counted from the top-left corner. */
export function squareToCell(sq, orientation = WHITE) {
  const file = sq & 7;
  const rank = sq >> 3;
  return orientation === BLACK ? { col: 7 - file, row: rank } : { col: file, row: 7 - rank };
}

/** The square drawn at a column and row (from the top-left); null off the board. */
export function cellToSquare(col, row, orientation = WHITE) {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  if (col < 0 || col > 7 || row < 0 || row > 7) return null;
  return orientation === BLACK ? row * 8 + (7 - col) : (7 - row) * 8 + col;
}

/** The square under a point (x, y from the board's top-left corner; size = board edge). */
export function pointToSquare(x, y, size, orientation = WHITE) {
  if (!(size > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return cellToSquare(Math.floor((x * 8) / size), Math.floor((y * 8) / size), orientation);
}

/** a1 is dark. */
export function isDarkSquare(sq) {
  return (((sq & 7) + (sq >> 3)) & 1) === 0;
}

/** The largest square edge (CSS px) that fits 8 across `available` and is whole in device pixels. */
export function snapSquareSize(available, devicePixelRatio = 1) {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  if (!(available > 0)) return 0;
  return Math.floor((available * dpr) / 8 + 1e-6) / dpr;
}

/** What stands where: 64 strings, '' or a piece code, read from a rules.js Position. */
export function positionCodes(position) {
  const codes = new Array(64);
  for (let sq = 0; sq < 64; sq++) {
    const type = position.pieceTypeAt(sq);
    codes[sq] = type ? pieceCode(position.colorAt(sq), type) : '';
  }
  return codes;
}

/** The accessible name of a square: "e4, white pawn" or "e4, empty". */
export function squareLabel(sq, code) {
  if (!code) return `${SQUARE_NAMES[sq]}, empty`;
  return `${SQUARE_NAMES[sq]}, ${code[0] === 'w' ? 'white' : 'black'} ${PIECE_NAMES[code[1]]}`;
}

/** A spoken description of the move that led to `after` (64 piece codes). */
export function describeMove(after, lastMove, { check = false, mate = false } = {}) {
  if (!lastMove) return '';
  const code = after[lastMove.to];
  if (!code) return '';
  const side = code[0] === 'w' ? 'White' : 'Black';
  const from = SQUARE_NAMES[lastMove.from];
  const to = SQUARE_NAMES[lastMove.to];
  const files = (lastMove.to & 7) - (lastMove.from & 7);
  let text;
  if (code[1] === 'K' && Math.abs(files) === 2 && lastMove.from >> 3 === lastMove.to >> 3) {
    text = `${side} castles ${files > 0 ? 'kingside' : 'queenside'}`;
  } else if (lastMove.promotion) {
    text = `${side} pawn ${from} to ${to}, promotes to ${PIECE_NAMES[code[1]]}`;
  } else {
    text = `${side} ${PIECE_NAMES[code[1]]} ${from} to ${to}`;
  }
  if (mate) text += ', checkmate';
  else if (check) text += ', check';
  return text;
}

/**
 * Where the promotion picker goes: the column of the promotion square and the
 * four cells it covers, starting on that square and running toward the centre.
 */
export function promotionCells(to, orientation = WHITE) {
  const { col, row } = squareToCell(to, orientation);
  const down = row < 4;
  const cells = [];
  for (let i = 0; i < 4; i++) cells.push({ col, row: down ? row + i : row - i });
  return { col, down, cells };
}

/**
 * Turn "what the board shows" into "what it should show" as piece movements.
 *
 * `before` and `after` are arrays of 64 piece codes ('' = empty). `lastMove`
 * ({ from, to, promotion }) is a hint: the move that produced `after`.
 * Returns { moves, removes, adds }:
 *   moves   [{ from, to, code, becomes }]  a piece slides; `becomes` is the new
 *           code when a pawn promotes (from === to: it is already standing there);
 *   removes [{ sq, code }]                 a piece leaves the board (captured);
 *   adds    [{ sq, code }]                 a piece appears from nowhere.
 * Applying the three lists to `before` always yields `after`, whatever the two
 * positions are (a move, a take-back, a jump to another game).
 */
export function diffPositions(before, after, lastMove = null) {
  const moves = [];
  const removes = [];
  const adds = [];
  const sourceDone = new Uint8Array(64);
  const destDone = new Uint8Array(64);

  if (lastMove && lastMove.from !== lastMove.to) {
    const { from, to } = lastMove;
    const promo = lastMove.promotion ? PIECE_LETTERS[lastMove.promotion] : '';
    const mover = before[from];
    const arrived = after[to];
    const promotes = (pawn) => Boolean(promo) && pawn[1] === 'P' && arrived[1] === promo && arrived[0] === pawn[0];
    if (mover && arrived && !after[from] && (promo ? promotes(mover) : arrived === mover)) {
      // The move itself: the piece on `from` goes to `to`, taking what stood there.
      moves.push({ from, to, code: mover, becomes: arrived === mover ? null : arrived });
      sourceDone[from] = 1;
      destDone[to] = 1;
      if (before[to]) {
        removes.push({ sq: to, code: before[to] });
        sourceDone[to] = 1;
      }
    } else if (!mover && arrived && before[to] && before[to] !== arrived && promotes(before[to])) {
      // The pawn was dropped on the promotion square already; it only changes.
      moves.push({ from: to, to, code: before[to], becomes: arrived });
      sourceDone[to] = 1;
      destDone[to] = 1;
    }
  }

  // Everything else: pair each piece that disappeared with the nearest square
  // where the same piece appeared (the castling rook, a take-back, a new game).
  const sources = [];
  const dests = [];
  for (let sq = 0; sq < 64; sq++) {
    if (before[sq] === after[sq]) continue;
    if (before[sq] && !sourceDone[sq]) sources.push(sq);
    if (after[sq] && !destDone[sq]) dests.push(sq);
  }
  const pairs = [];
  for (const s of sources) {
    for (const d of dests) {
      if (before[s] !== after[d]) continue;
      const df = (s & 7) - (d & 7);
      const dr = (s >> 3) - (d >> 3);
      pairs.push([df * df + dr * dr, s, d]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  for (const [, s, d] of pairs) {
    if (sourceDone[s] || destDone[d]) continue;
    sourceDone[s] = 1;
    destDone[d] = 1;
    moves.push({ from: s, to: d, code: before[s], becomes: null });
  }
  for (const s of sources) if (!sourceDone[s]) removes.push({ sq: s, code: before[s] });
  for (const d of dests) if (!destDone[d]) adds.push({ sq: d, code: after[d] });
  return { moves, removes, adds };
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

const SLIDE_MS = 150;
const SLIDE_EASING = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
const TOUCH_SLOP = 5;            // px a finger may wander before a tap becomes a drag
const DRAG_SCALE = 1.16;         // the piece in the hand, mouse and pen
const TOUCH_SCALE = 1.8;         // ... and under a finger, where it must stay visible
const TOUCH_LIFT = 0.8;          // squares the piece floats above the finger
const PROMOTION_KEYS = { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT };
const PROMOTION_LABELS = { [QUEEN]: 'Queen', [ROOK]: 'Rook', [BISHOP]: 'Bishop', [KNIGHT]: 'Knight' };

export class Board {
  /**
   * @param {HTMLElement} root  the container; the board fills it (a square).
   * @param {{ pieceUrl?: (code: string) => string, onMove?: (move) => void }} options
   */
  constructor(root, options = {}) {
    if (!root || root.nodeType !== 1) throw new TypeError('Board: a root element is required');
    this._host = root;
    this._doc = root.ownerDocument;
    this._win = this._doc.defaultView;
    this._pieceUrl = options.pieceUrl || ((code) => `/static/img/pieces/${code}.svg`);
    this._onMove = typeof options.onMove === 'function' ? options.onMove : () => {};

    this._orientation = WHITE;
    this._interactive = null;
    this._pos = null;             // our own copy of the position we were shown
    this._legal = [];
    this._lastMove = null;
    this._checkSq = null;
    this._pieces = new Array(64).fill(null);   // what is drawn: { el, code } per square
    this._shown = false;
    this._awaiting = false;       // a move was reported; waiting for setPosition()

    this._selected = null;
    this._targets = new Map();    // square -> is it a capture
    this._over = null;            // legal square under a dragged piece
    this._cursor = null;          // keyboard cursor
    this._kbd = false;            // the keyboard is in use: show the cursor
    this._drag = null;
    this._picker = null;
    this._anims = new Map();      // el -> { anim, done }
    this._retiring = new Set();   // captured pieces fading out
    this._sq = 0;
    this._dead = false;
    this._focusFromPointer = false;

    this._uid = `cb${Math.random().toString(36).slice(2, 8)}`;
    this._abort = new AbortController();
    this._reduced = this._win.matchMedia ? this._win.matchMedia('(prefers-reduced-motion: reduce)') : null;

    this._build();
    this._bind();
    this._layout();
    this._refresh();
  }

  // ---- public API ---------------------------------------------------------

  /** Show a rules.js Position. The board copies it and never mutates it. */
  setPosition(position, { lastMove = null, animate = true } = {}) {
    if (this._dead) return;
    this._abortInput();
    const before = this._pieces.map((p) => (p ? p.code : ''));
    const after = positionCodes(position);
    const hint = lastMove
      ? { from: lastMove.from, to: lastMove.to, promotion: lastMove.promotion || 0 }
      : null;
    const diff = diffPositions(before, after, hint);
    this._applyDiff(diff, animate && this._shown && this._motion());

    this._pos = position.copy();
    this._legal = this._pos.legalMoves();
    this._lastMove = hint;
    const check = this._pos.isCheck();
    this._checkSq = check ? this._pos.king(this._pos.turn) : null;
    this._awaiting = false;
    this._shown = true;
    this._live.textContent = hint
      ? describeMove(after, hint, { check, mate: check && this._legal.length === 0 })
      : '';
    this._refresh();
  }

  /** WHITE or BLACK at the bottom. */
  setOrientation(color) {
    if (this._dead) return;
    const orientation = color === BLACK ? BLACK : WHITE;
    if (orientation === this._orientation) return;
    this._abortInput();
    this._orientation = orientation;
    this._assignCells();
    for (let sq = 0; sq < 64; sq++) if (this._pieces[sq]) this._put(this._pieces[sq].el, sq);
    this._refresh();
  }

  /** The colour the user may move now; null = look, don't touch. */
  setInteractive(color) {
    if (this._dead) return;
    const interactive = color === WHITE || color === BLACK ? color : null;
    if (interactive === this._interactive) return;
    this._interactive = interactive;
    if (this._drag || this._picker || this._selected !== null) this._cancelAll();
    this._refresh();
  }

  /** Remove the board from the page: elements, listeners, observers, animations. */
  destroy() {
    if (this._dead) return;
    this._abortInput();
    this._dead = true;
    this._abort.abort();
    if (this._observer) this._observer.disconnect();
    for (const el of [...this._anims.keys()]) this._stop(el);
    for (const el of [...this._retiring]) el.remove();
    this._retiring.clear();
    this._wrap.remove();
    this._host.classList.remove('cb-host');
    this._pieces.fill(null);
    this._pos = null;
    this._legal = [];
    this._onMove = () => {};
  }

  // ---- construction -------------------------------------------------------

  _el(tag, className) {
    const el = this._doc.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  _build() {
    this._host.classList.add('cb-host');
    const wrap = (this._wrap = this._el('div', 'cb'));

    const grid = (this._grid = this._el('div', 'cb-grid'));
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', 'Chessboard');
    grid.tabIndex = 0;
    this._cellAt = [];            // [row][col] -> element
    for (let row = 0; row < 8; row++) {
      const rowEl = this._el('div', 'cb-row');
      rowEl.setAttribute('role', 'row');
      const cells = [];
      for (let col = 0; col < 8; col++) {
        const cell = this._el('div', 'cb-sq');
        cell.setAttribute('role', 'gridcell');
        rowEl.append(cell);
        cells.push(cell);
      }
      this._cellAt.push(cells);
      grid.append(rowEl);
    }

    this._halo = this._el('div', 'cb-halo');
    this._halo.setAttribute('aria-hidden', 'true');
    this._layer = this._el('div', 'cb-pieces');
    this._layer.setAttribute('aria-hidden', 'true');
    this._live = this._el('div', 'cb-live');
    this._live.setAttribute('aria-live', 'polite');

    wrap.append(grid, this._halo, this._layer, this._live);
    this._cells = new Array(64);  // square -> element
    this._cellClass = new Array(64).fill('');
    this._cellLabel = new Array(64).fill('');
    this._assignCells();
    this._host.append(wrap);

    // Warm the cache so that a promoted piece never flashes in late.
    this._preload = [];
    for (const side of 'wb') {
      for (const letter of 'KQRBNP') {
        const img = new this._win.Image();
        img.src = this._pieceUrl(side + letter);
        this._preload.push(img);
      }
    }
  }

  /** Give every drawn cell its square for the current orientation. */
  _assignCells() {
    this._wrap.dataset.orientation = this._orientation === WHITE ? 'white' : 'black';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = cellToSquare(col, row, this._orientation);
        const cell = this._cellAt[row][col];
        const name = SQUARE_NAMES[sq];
        cell.id = `${this._uid}-${name}`;
        cell.dataset.square = name;
        cell.textContent = '';
        if (col === 0) {
          const rank = this._el('span', 'cb-coord cb-coord--rank');
          rank.setAttribute('aria-hidden', 'true');
          rank.textContent = name[1];
          cell.append(rank);
        }
        if (row === 7) {
          const file = this._el('span', 'cb-coord cb-coord--file');
          file.setAttribute('aria-hidden', 'true');
          file.textContent = name[0];
          cell.append(file);
        }
        this._cells[sq] = cell;
        this._cellClass[sq] = '';
        this._cellLabel[sq] = '';
      }
    }
  }

  _bind() {
    const signal = this._abort.signal;
    const wrap = this._wrap;
    wrap.addEventListener('pointerdown', (e) => this._onPointerDown(e), { signal });
    wrap.addEventListener('pointermove', (e) => this._onPointerMove(e), { signal });
    wrap.addEventListener('pointerup', (e) => this._onPointerUp(e), { signal });
    wrap.addEventListener('pointercancel', (e) => this._onPointerLost(e), { signal });
    wrap.addEventListener('lostpointercapture', (e) => this._onPointerLost(e), { signal });
    wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); this._cancelAll(); }, { signal });
    wrap.addEventListener('keydown', (e) => this._onKeyDown(e), { signal });
    this._grid.addEventListener('focus', () => this._onFocus(), { signal });
    this._win.addEventListener('resize', () => this._layout(), { signal });
    if (typeof this._win.ResizeObserver === 'function') {
      this._observer = new this._win.ResizeObserver(() => this._layout());
      this._observer.observe(this._host);
    }
  }

  /** Size the board: the largest square that fits, on whole device pixels. */
  _layout() {
    if (this._dead) return;
    const cs = this._win.getComputedStyle(this._host);
    const px = (v) => parseFloat(v) || 0;
    const padL = px(cs.paddingLeft);
    const padT = px(cs.paddingTop);
    const edgeX = padL + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
    const edgeY = padT + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    const borderBox = cs.boxSizing === 'border-box';
    const width = px(cs.width) - (borderBox ? edgeX : 0);
    let height = px(cs.height) - (borderBox ? edgeY : 0);
    if (!(height > 0)) height = width;
    const available = Math.min(width, height);
    const dpr = this._win.devicePixelRatio || 1;
    const sq = snapSquareSize(available, dpr);
    if (!(sq > 0)) return;       // not laid out (hidden): the stylesheet's 100% stands in
    const size = sq * 8;
    const snap = (v) => Math.round(v * dpr) / dpr;
    const style = this._wrap.style;
    style.width = `${size}px`;
    style.height = `${size}px`;
    style.left = `${snap(padL + (width - size) / 2)}px`;
    style.top = `${snap(padT + (height - size) / 2)}px`;
    style.setProperty('--cb-sq-px', `${sq}px`);
    this._sq = sq;
  }

  // ---- drawing ------------------------------------------------------------

  _motion() {
    return !(this._reduced && this._reduced.matches);
  }

  _setImage(el, code) {
    el.dataset.piece = code;
    el.style.backgroundImage = `url("${String(this._pieceUrl(code)).replace(/["\\\n]/g, '')}")`;
  }

  _create(code, sq) {
    const el = this._el('div', 'cb-piece');
    this._setImage(el, code);
    this._place(el, sq);
    this._layer.append(el);
    return { el, code };
  }

  /** The resting transform of a piece on a square (percentages of its own size). */
  _place(el, sq) {
    const { col, row } = squareToCell(sq, this._orientation);
    el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }

  /** Stop a running animation on a piece (its "arrived" callback still runs). */
  _stop(el) {
    const running = this._anims.get(el);
    if (!running) return;
    this._anims.delete(el);
    running.anim.onfinish = null;
    running.anim.oncancel = null;
    running.anim.cancel();
    el.classList.remove('cb-piece--moving');
    if (running.done) running.done();
  }

  /** Put a piece on a square at once. */
  _put(el, sq) {
    this._stop(el);
    this._place(el, sq);
  }

  /** Glide a piece from wherever it is drawn now to a square. */
  _slide(el, sq, done = null) {
    const canAnimate = this._motion() && typeof el.animate === 'function' && this._sq > 0;
    const from = canAnimate ? this._win.getComputedStyle(el).transform : 'none';
    this._stop(el);
    this._place(el, sq);
    if (!canAnimate || !from || from === 'none') {
      if (done) done();
      return;
    }
    const { col, row } = squareToCell(sq, this._orientation);
    const to = `translate(${col * this._sq}px, ${row * this._sq}px)`;
    el.classList.add('cb-piece--moving');
    const anim = el.animate([{ transform: from }, { transform: to }], { duration: SLIDE_MS, easing: SLIDE_EASING });
    const finish = () => {
      if (this._anims.get(el)?.anim !== anim) return;
      this._anims.delete(el);
      el.classList.remove('cb-piece--moving');
      if (done) done();
    };
    anim.onfinish = finish;
    anim.oncancel = finish;
    this._anims.set(el, { anim, done });
  }

  /** Take a piece off the board, fading if asked. */
  _retire(el, fade) {
    this._stop(el);
    if (!fade || typeof el.animate !== 'function') {
      el.remove();
      return;
    }
    el.style.opacity = '0';
    this._retiring.add(el);
    const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SLIDE_MS, easing: 'ease-out' });
    const gone = () => { el.remove(); this._retiring.delete(el); };
    anim.onfinish = gone;
    anim.oncancel = gone;
  }

  _applyDiff(diff, animate) {
    for (const r of diff.removes) {
      const piece = this._pieces[r.sq];
      if (!piece) continue;
      this._pieces[r.sq] = null;
      this._retire(piece.el, animate);
    }
    const movers = [];
    for (const m of diff.moves) {
      const piece = this._pieces[m.from];
      if (piece) movers.push([m, piece]);
    }
    for (const [m, piece] of movers) if (this._pieces[m.from] === piece) this._pieces[m.from] = null;
    for (const [m, piece] of movers) {
      this._pieces[m.to] = piece;
      let arrived = null;
      if (m.becomes) {
        // Promotion: the pawn arrives, then becomes the piece.
        const code = (piece.code = m.becomes);
        arrived = () => this._setImage(piece.el, code);
      }
      if (animate && m.from !== m.to) {
        this._slide(piece.el, m.to, arrived);
      } else {
        this._put(piece.el, m.to);
        if (arrived) arrived();
      }
    }
    for (const a of diff.adds) {
      const piece = this._create(a.code, a.sq);
      this._pieces[a.sq] = piece;
      if (animate && typeof piece.el.animate === 'function') {
        piece.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SLIDE_MS, easing: 'ease-out' });
      }
    }
  }

  /** May the user move at all right now? */
  _playable() {
    return this._interactive !== null && !this._awaiting && !this._picker && this._pos !== null
      && this._legal.length > 0 && this._pos.turn === this._interactive;
  }

  _canMove(sq) {
    const piece = this._pieces[sq];
    return Boolean(piece) && this._playable() && piece.code[0] === (this._interactive === WHITE ? 'w' : 'b');
  }

  /** Bring every square's classes and accessible name in line with the state. */
  _refresh() {
    if (this._dead) return;
    const playable = this._playable();
    const side = this._interactive === WHITE ? 'w' : 'b';
    const last = this._lastMove;
    for (let sq = 0; sq < 64; sq++) {
      const piece = this._pieces[sq];
      const cell = this._cells[sq];
      let cls = isDarkSquare(sq) ? 'cb-sq cb-sq--dark' : 'cb-sq cb-sq--light';
      let label = squareLabel(sq, piece ? piece.code : '');
      if (last && (sq === last.from || sq === last.to)) cls += ' cb-sq--last';
      if (sq === this._selected) cls += ' cb-sq--selected';
      if (sq === this._checkSq) { cls += ' cb-sq--check'; label += ', in check'; }
      const capture = this._targets.get(sq);
      if (capture !== undefined) {
        cls += capture ? ' cb-sq--ring' : ' cb-sq--dot';
        label += capture ? ', capture' : ', legal move';
      }
      if (sq === this._over) cls += ' cb-sq--over';
      if (this._kbd && sq === this._cursor) cls += ' cb-sq--cursor';
      if (playable && piece && piece.code[0] === side) cls += ' cb-sq--movable';
      if (cls !== this._cellClass[sq]) {
        this._cellClass[sq] = cls;
        cell.className = cls;
        cell.setAttribute('aria-selected', sq === this._selected ? 'true' : 'false');
      }
      if (label !== this._cellLabel[sq]) {
        this._cellLabel[sq] = label;
        cell.setAttribute('aria-label', label);
      }
    }
    this._wrap.classList.toggle('cb--kbd', this._kbd);
    this._wrap.classList.toggle('cb--idle', !playable);
    if (this._cursor !== null) this._grid.setAttribute('aria-activedescendant', this._cells[this._cursor].id);
    else this._grid.removeAttribute('aria-activedescendant');
  }

  // ---- selecting and moving -----------------------------------------------

  _select(sq) {
    this._selected = sq;
    this._targets = new Map();
    if (sq !== null) {
      for (const move of this._legal) {
        if (move.from === sq) this._targets.set(move.to, this._pos.isCapture(move));
      }
    }
    this._refresh();
  }

  /** Try the move from -> to. Returns false if it is not legal. */
  _tryMove(from, to, how = {}) {
    const moves = this._legal.filter((m) => m.from === from && m.to === to);
    if (moves.length === 0) return false;
    if (moves.some((m) => m.promotion)) this._openPicker(from, to, moves, how);
    else this._commit(moves[0], Boolean(how.viaDrag));
    return true;
  }

  /**
   * Report a move. `settled` means the piece has been dropped on its square
   * already: the board then shows it there (and what it took is gone) while it
   * waits for the controller's setPosition().
   */
  _commit(move, settled) {
    if (settled) {
      const piece = this._pieces[move.from];
      const taken = this._pieces[move.to];
      if (taken) this._retire(taken.el, false);
      this._pieces[move.from] = null;
      this._pieces[move.to] = piece;
      this._put(piece.el, move.to);
      this._lastMove = { from: move.from, to: move.to, promotion: move.promotion || 0 };
    }
    this._awaiting = true;
    this._selected = null;
    this._targets = new Map();
    this._refresh();
    this._onMove(move);
  }

  /** Cancel whatever the user has in hand. True if there was anything. */
  _cancelAll() {
    let did = false;
    if (this._drag) { this._cancelDrag(false); did = true; }
    if (this._picker) { this._closePicker(null, false); did = true; }
    if (this._selected !== null) did = true;
    this._select(null);
    return did;
  }

  /** The same without animation, before the board is redrawn or torn down. */
  _abortInput() {
    if (this._drag) this._cancelDrag(true);
    if (this._picker) this._closePicker(null, true);
    this._selected = null;
    this._targets = new Map();
  }

  // ---- pointer ------------------------------------------------------------

  _squareFromPoint(clientX, clientY) {
    const rect = this._wrap.getBoundingClientRect();
    return pointToSquare(clientX - rect.left, clientY - rect.top, rect.width, this._orientation);
  }

  _focusGrid() {
    if (this._doc.activeElement === this._grid) return;
    this._focusFromPointer = true;
    try { this._grid.focus({ preventScroll: true }); } finally { this._focusFromPointer = false; }
  }

  _onFocus() {
    if (this._focusFromPointer) return;
    this._kbd = true;
    if (this._cursor === null) this._cursor = this._defaultCursor();
    this._refresh();
  }

  _onPointerDown(e) {
    if (this._picker || this._drag) return;
    if (e.button === 2) { this._cancelAll(); return; }
    if (e.button !== 0 || e.isPrimary === false) return;
    const sq = this._squareFromPoint(e.clientX, e.clientY);
    if (sq === null) return;
    e.preventDefault();
    this._kbd = false;
    this._focusGrid();

    if (this._selected !== null && this._targets.has(sq)) {      // tap, tap
      this._tryMove(this._selected, sq, { viaPointer: true });
      return;
    }
    if (!this._canMove(sq)) { this._select(null); return; }

    const again = this._selected === sq;
    this._cursor = sq;
    this._select(sq);
    const drag = (this._drag = {
      pointerId: e.pointerId,
      from: sq,
      el: this._pieces[sq].el,
      x0: e.clientX,
      y0: e.clientY,
      touch: e.pointerType === 'touch',
      started: false,
      left: false,
      again,
      over: sq,
      abort: new AbortController(),
    });
    try { this._wrap.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    this._doc.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      this._cancelAll();
    }, { capture: true, signal: drag.abort.signal });
    if (!drag.touch) this._beginDrag(e);       // a mouse picks the piece up at once
  }

  _onPointerMove(e) {
    const drag = this._drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (e.buttons & 2) { this._cancelAll(); return; }           // right button while holding
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < TOUCH_SLOP) return;
      this._beginDrag(e);
      return;
    }
    this._trackDrag(e);
  }

  _beginDrag(e) {
    const drag = this._drag;
    drag.started = true;
    this._stop(drag.el);
    drag.el.classList.add('cb-piece--drag');
    this._wrap.classList.add('cb--dragging');
    this._trackDrag(e);
  }

  _trackDrag(e) {
    const drag = this._drag;
    const rect = this._wrap.getBoundingClientRect();
    const sq = rect.width / 8;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scale = drag.touch ? TOUCH_SCALE : DRAG_SCALE;
    const lift = drag.touch ? sq * TOUCH_LIFT : 0;
    drag.el.style.transform = `translate(${x - sq / 2}px, ${y - sq / 2 - lift}px) scale(${scale})`;

    const over = pointToSquare(x, y, rect.width, this._orientation);
    if (over === drag.over) return;
    drag.over = over;
    if (over !== drag.from) drag.left = true;
    this._over = over !== null && this._targets.has(over) ? over : null;
    if (drag.touch && over !== null) {
      const cell = squareToCell(over, this._orientation);
      this._halo.style.transform = `translate(${cell.col * 100}%, ${cell.row * 100}%)`;
      this._halo.classList.add('cb-halo--on');
    } else {
      this._halo.classList.remove('cb-halo--on');
    }
    this._refresh();
  }

  /** Let go of the pointer; the caller decides where the piece ends up. */
  _endDrag() {
    const drag = this._drag;
    if (!drag) return null;
    this._drag = null;
    drag.abort.abort();
    try { this._wrap.releasePointerCapture(drag.pointerId); } catch { /* not captured any more */ }
    drag.el.classList.remove('cb-piece--drag');
    this._wrap.classList.remove('cb--dragging');
    this._halo.classList.remove('cb-halo--on');
    this._over = null;
    return drag;
  }

  _cancelDrag(silent) {
    const drag = this._endDrag();
    if (!drag || !drag.started) return;
    if (silent) this._put(drag.el, drag.from);
    else this._slide(drag.el, drag.from);
  }

  _onPointerUp(e) {
    const drag = this._drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const target = drag.started ? this._squareFromPoint(e.clientX, e.clientY) : drag.from;
    this._endDrag();
    if (target === drag.from) {
      // A click on the piece (or a drag that came home): it stays selected,
      // unless this was the second click on it.
      if (drag.started) this._put(drag.el, drag.from);
      if (drag.again && !drag.left) this._select(null);
      else this._refresh();
      return;
    }
    if (target !== null && this._targets.has(target) && this._tryMove(drag.from, target, { viaDrag: true })) return;
    this._select(null);                        // off the board or not legal: glide home
    this._slide(drag.el, drag.from);
  }

  _onPointerLost(e) {
    const drag = this._drag;
    if (!drag || e.pointerId !== drag.pointerId) return;
    this._cancelDrag(false);
    this._select(null);
  }

  // ---- keyboard -----------------------------------------------------------

  _defaultCursor() {
    if (this._selected !== null) return this._selected;
    if (this._lastMove) return this._lastMove.to;
    return cellToSquare(4, 6, this._orientation);
  }

  _onKeyDown(e) {
    if (this._picker) { this._pickerKey(e); return; }
    if (e.key === 'Escape') {
      if (this._cancelAll()) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (e.target !== this._grid || e.altKey || e.ctrlKey || e.metaKey) return;
    let dc = 0;
    let dr = 0;
    let act = false;
    let edge = null;
    switch (e.key) {
      case 'ArrowLeft': dc = -1; break;
      case 'ArrowRight': dc = 1; break;
      case 'ArrowUp': dr = -1; break;
      case 'ArrowDown': dr = 1; break;
      case 'Home': edge = 0; break;
      case 'End': edge = 7; break;
      case 'Enter': case ' ': case 'Spacebar': act = true; break;
      default: return;
    }
    e.preventDefault();
    const fresh = this._cursor === null;
    if (fresh) this._cursor = this._defaultCursor();
    this._kbd = true;
    if (act) {
      this._activate(e);
      return;
    }
    if (!fresh || edge !== null) {
      const cell = squareToCell(this._cursor, this._orientation);
      const col = edge !== null ? edge : Math.max(0, Math.min(7, cell.col + dc));
      const row = Math.max(0, Math.min(7, cell.row + dr));
      this._cursor = cellToSquare(col, row, this._orientation);
    }
    this._refresh();
  }

  /** Enter / Space on the cursor square: pick up, drop, or put down. */
  _activate(e) {
    const sq = this._cursor;
    if (e.repeat) return;
    if (this._selected !== null && this._targets.has(sq)) {
      this._tryMove(this._selected, sq, { viaKey: true });
    } else if (this._selected === sq || !this._canMove(sq)) {
      this._select(null);
    } else {
      this._select(sq);
    }
  }

  // ---- promotion picker ---------------------------------------------------

  _openPicker(from, to, moves, { viaDrag = false, viaKey = false } = {}) {
    const mover = this._pieces[from];
    const taken = this._pieces[to];
    const side = mover.code[0];
    const { col, down } = promotionCells(to, this._orientation);

    // The pawn steps onto the square; whatever stands there hides behind the picker.
    if (viaDrag) this._put(mover.el, to);
    else this._slide(mover.el, to);
    if (taken) taken.el.classList.add('cb-piece--hidden');

    const root = this._el('div', 'cb-promo');
    const column = this._el('div', `cb-promo-col ${down ? 'cb-promo-col--down' : 'cb-promo-col--up'}`);
    column.setAttribute('role', 'dialog');
    column.setAttribute('aria-label', `Promote the pawn on ${SQUARE_NAMES[to]} to`);
    column.style.left = `${col * 12.5}%`;
    const buttons = [];
    for (const type of PROMOTION_ORDER) {
      const button = this._el('button', 'cb-promo-btn');
      button.type = 'button';
      button.dataset.promotion = PIECE_LETTERS[type].toLowerCase();
      button.setAttribute('aria-label', PROMOTION_LABELS[type]);
      button.title = PROMOTION_LABELS[type];
      const art = this._el('span', 'cb-promo-art');
      art.style.backgroundImage = `url("${String(this._pieceUrl(side + PIECE_LETTERS[type])).replace(/["\\\n]/g, '')}")`;
      button.append(art);
      column.append(button);
      buttons.push(button);
    }
    const cancel = this._el('button', 'cb-promo-cancel');
    cancel.type = 'button';
    cancel.setAttribute('aria-label', 'Cancel');
    cancel.title = 'Cancel';
    cancel.textContent = '×';
    column.append(cancel);
    buttons.push(cancel);
    root.append(column);

    const picker = (this._picker = {
      from, to, moves, root, column, buttons, down, mover, taken,
      armed: false,              // a press began on the picker itself (not the drop that opened it)
      keyGuard: viaKey,          // the key that opened it is still down
      abort: new AbortController(),
    });
    const signal = picker.abort.signal;
    column.addEventListener('pointerdown', () => { picker.armed = true; }, { signal });
    column.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button || this._picker !== picker) return;
      if (e.detail === 0 ? picker.keyGuard : !picker.armed) return;
      if (button === cancel) { this._closePicker(null, false); return; }
      const type = PROMOTION_KEYS[button.dataset.promotion];
      this._closePicker(moves.find((m) => m.promotion === type) || null, false);
    }, { signal });
    this._doc.addEventListener('pointerdown', (e) => {          // a click elsewhere cancels
      if (column.contains(e.target)) return;
      if (this._wrap.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
      this._closePicker(null, false);
    }, { capture: true, signal });
    this._doc.addEventListener('keyup', () => { picker.keyGuard = false; }, { capture: true, signal });
    this._doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this._wrap.contains(e.target)) return;
      e.preventDefault();
      this._closePicker(null, false);
    }, { capture: true, signal });

    this._selected = null;
    this._targets = new Map();
    this._wrap.append(root);
    this._refresh();
    this._focusFromPointer = true;
    try { buttons[0].focus({ preventScroll: true }); } finally { this._focusFromPointer = false; }
  }

  /** Close the picker with the chosen move, or null to take the pawn back. */
  _closePicker(move, silent) {
    const picker = this._picker;
    if (!picker) return;
    this._picker = null;
    const hadFocus = picker.root.contains(this._doc.activeElement);
    picker.abort.abort();
    picker.root.remove();
    if (picker.taken) picker.taken.el.classList.remove('cb-piece--hidden');
    if (hadFocus && !silent) this._focusGrid();
    if (move) {
      this._commit(move, true);
    } else {
      if (silent) this._put(picker.mover.el, picker.from);
      else this._slide(picker.mover.el, picker.from);
      this._refresh();
    }
  }

  _pickerKey(e) {
    const picker = this._picker;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this._closePicker(null, false);
      return;
    }
    const count = picker.buttons.length;
    const at = picker.buttons.indexOf(this._doc.activeElement);
    let next = null;
    switch (e.key) {
      case 'ArrowDown': next = picker.down ? at + 1 : at - 1; break;
      case 'ArrowUp': next = picker.down ? at - 1 : at + 1; break;
      case 'ArrowRight': next = at + 1; break;
      case 'ArrowLeft': next = at - 1; break;
      case 'Tab': next = e.shiftKey ? at - 1 : at + 1; break;
      case 'Home': next = 0; break;
      case 'End': next = count - 1; break;
      default: break;
    }
    if (next !== null) {
      e.preventDefault();
      picker.buttons[at < 0 ? 0 : (next + count) % count].focus({ preventScroll: true });
      return;
    }
    const type = e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey
      ? PROMOTION_KEYS[e.key.toLowerCase()] : undefined;
    if (type !== undefined && !e.repeat) {
      e.preventDefault();
      this._closePicker(picker.moves.find((m) => m.promotion === type) || null, false);
    }
  }
}
