// engine-client.js - asking Fischer for a move.
//
// The normal path is the Web Worker (worker.js: book, search and style in the
// browser). If the worker cannot start, fails, or goes silent, the same
// question goes to the server (POST /api/move) and its answer is reshaped to
// look like the worker's. The caller never learns which one answered unless
// it asks (`result.via`, `client.mode`); it hears of a failure only when both
// have failed - and then the error says what happened (`error.kind`:
// 'unreachable' | 'server' | 'move' | 'position').
//
// An answer is checked before it is believed: a worker that sends something
// that is not a legal move in the position is treated like one that sent an
// error, and the server is asked instead.
//
//   const client = new EngineClient();
//   client.start();
//   const result = await client.move({ fen, moves, level });   // level: a level id
//
// Every request gets its own id and its own promise. A caller that has lost
// interest in an answer (new game, take back) simply ignores it when it
// comes: nothing here keeps game state.

import { Position, STARTING_FEN } from './rules.js';

const DEFAULT_URLS = Object.freeze({
  worker: '/static/js/worker.js',
  api: '/api/move',
  book: '/static/data/book.json',
  style: '/static/data/style.json',
});

const INIT_TIMEOUT_MS = 25000;      // the book is a large file on a slow line
const MOVE_GRACE_MS = 5000;         // on top of the level's own thinking time, before the worker counts as silent

/** An Error with a `kind` the page can explain in plain words. */
function failure(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

/** Is `uci` a legal move after `moves` from `fen`? (False for anything malformed.) */
export function isPlayable({ fen = STARTING_FEN, moves = [] }, uci) {
  if (typeof uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return false;
  try {
    const position = Position.fromMoves(moves, fen);
    return position.isLegal(position.parseUci(uci));
  } catch {
    return false;
  }
}

/**
 * The server's reply to POST /api/move in the shape of the worker's result.
 * There is no `context` from the server, so the commentary has less to say.
 */
export function fromServerReply(reply) {
  if (reply === null || typeof reply !== 'object') throw failure('server', 'The server sent no answer');
  if (typeof reply.error === 'string') throw failure('server', reply.error);
  if (typeof reply.bot_move !== 'string' || reply.bot_move === '') {
    throw failure('move', 'The server had no move to play');
  }
  const result = {
    uci: reply.bot_move,
    san: typeof reply.bot_move_san === 'string' ? reply.bot_move_san : reply.bot_move,
    source: typeof reply.source === 'string' ? reply.source : 'search',
    evalCp: Number.isFinite(reply.eval_cp) ? reply.eval_cp : null,
    depth: Number.isFinite(reply.depth) ? reply.depth : null,
    nodes: Number.isFinite(reply.nodes) ? reply.nodes : null,
    timeMs: Number.isFinite(reply.time_ms) ? reply.time_ms : null,
    pv: Array.isArray(reply.pv) ? reply.pv.filter(move => typeof move === 'string') : [],
    context: null,
    via: 'server',
  };
  if (typeof reply.engine_move_san === 'string' && reply.engine_move_san !== '') {
    result.engineSan = reply.engine_move_san;
  }
  if (reply.book !== null && typeof reply.book === 'object' && reply.book.game) {
    const count = Number.isFinite(reply.book.count) ? reply.book.count : 1;
    result.book = { game: reply.book.game, games: [reply.book.game], count };
  }
  return result;
}

function sameStart(fen) {
  const fields = text => String(text).trim().split(/\s+/).slice(0, 4).join(' ');
  return fields(fen) === fields(STARTING_FEN);
}

export class EngineClient {
  #urls;
  #createWorker;
  #fetch;
  #setTimeout;
  #clearTimeout;
  #worker = null;
  #mode = 'idle';                 // 'idle' | 'worker' | 'server'
  #nextId = 1;
  #pending = new Map();           // id -> { resolve, reject, request, timer }
  #initId = null;
  #initTimer = null;
  #info = null;
  #onMode;

  /**
   * @param {object} [options]
   * @param {object} [options.urls]           worker, api, book, style
   * @param {function(string): Worker} [options.createWorker]
   * @param {function} [options.fetch]
   * @param {function(string): void} [options.onMode]  told when the path changes ('worker' | 'server')
   */
  constructor({ urls = {}, createWorker = null, fetch: fetchImpl = null, onMode = null, timers = null } = {}) {
    this.#urls = { ...DEFAULT_URLS, ...urls };
    this.#createWorker = createWorker ?? (url => new Worker(url, { type: 'module' }));
    this.#fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.#setTimeout = timers?.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.#clearTimeout = timers?.clearTimeout ?? (handle => globalThis.clearTimeout(handle));
    this.#onMode = onMode;
  }

  /** 'worker' while the worker is (believed to be) alive, 'server' after it has failed. */
  get mode() {
    return this.#mode;
  }

  /** What the worker said about itself when it was ready ({ engine, bookGames, ... }), or null. */
  get info() {
    return this.#info;
  }

  /** Starts the worker and loads its data. Never throws: on failure the server takes over. */
  start() {
    if (this.#mode !== 'idle') return;
    try {
      this.#worker = this.#createWorker(this.#urls.worker);
    } catch {
      this.#abandonWorker();
      return;
    }
    this.#setMode('worker');
    this.#worker.onmessage = event => this.#receive(event.data);
    this.#worker.onerror = event => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      this.#abandonWorker();
    };
    this.#worker.onmessageerror = () => this.#abandonWorker();
    this.#initId = this.#nextId++;
    this.#initTimer = this.#setTimeout(() => {
      if (this.#info === null) this.#abandonWorker();
    }, INIT_TIMEOUT_MS);
    this.#post({ type: 'init', id: this.#initId, urls: { book: this.#urls.book, style: this.#urls.style } });
  }

  /** A new game: the engine forgets the last one. Nothing to wait for. */
  newGame() {
    if (this.#mode === 'worker') this.#post({ type: 'newgame', id: this.#nextId++ });
  }

  /**
   * His move in the game so far.
   *
   * @param {object} game
   * @param {string} game.fen       where the game started
   * @param {string[]} game.moves   the UCI moves played since
   * @param {string} game.level     a level id from LEVELS
   * @param {number} [game.timeMs]  how long that level thinks (to know when the worker has gone silent)
   * @returns {Promise<object>} the worker's result (see bot.js), plus `via: 'worker' | 'server'`
   */
  move({ fen = STARTING_FEN, moves = [], level, timeMs = 3000 }) {
    if (this.#mode === 'idle') this.start();
    const request = { fen, moves: [...moves], level };
    if (this.#mode !== 'worker') return this.#askServer(request);
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      const timer = this.#setTimeout(() => this.#fallBack(id), timeMs + MOVE_GRACE_MS + (this.#info === null ? INIT_TIMEOUT_MS : 0));
      this.#pending.set(id, { resolve, reject, request, timer });
      this.#post({ type: 'move', id, ...request });
    });
  }

  /** Stops the worker for good (page teardown, tests). */
  dispose() {
    if (this.#worker !== null) {
      try { this.#worker.terminate(); } catch { /* already gone */ }
    }
    this.#worker = null;
    this.#clearTimeout(this.#initTimer);
    for (const waiting of this.#pending.values()) {
      this.#clearTimeout(waiting.timer);
      waiting.reject(new Error('The engine was shut down'));
    }
    this.#pending.clear();
  }

  #setMode(mode) {
    if (this.#mode === mode) return;
    this.#mode = mode;
    if (typeof this.#onMode === 'function') this.#onMode(mode);
  }

  #post(message) {
    try {
      this.#worker.postMessage(message);
    } catch {
      this.#abandonWorker();
    }
  }

  #receive(message) {
    if (message === null || typeof message !== 'object') return;
    if (message.type === 'ready') {
      if (message.id === this.#initId) {
        this.#info = message.info ?? {};
        this.#clearTimeout(this.#initTimer);
      }
      return;
    }
    if (message.type === 'move') {
      const waiting = this.#pending.get(message.id);
      if (waiting === undefined) return;            // answered by the server meanwhile
      if (!isPlayable(waiting.request, message.result?.uci)) {
        this.#fallBack(message.id);                 // not a move: as good as an error
        return;
      }
      this.#pending.delete(message.id);
      this.#clearTimeout(waiting.timer);
      waiting.resolve({ ...message.result, via: 'worker' });
      return;
    }
    if (message.type === 'error') {
      if (message.id === this.#initId || message.id === null || message.id === undefined) {
        // it could not load its data, or something escaped: do not trust it again
        this.#abandonWorker();
      } else if (this.#pending.has(message.id)) {
        this.#fallBack(message.id);
      }
    }
  }

  /** The worker is of no use any more: every open question goes to the server instead. */
  #abandonWorker() {
    if (this.#worker !== null) {
      try { this.#worker.terminate(); } catch { /* already gone */ }
      this.#worker = null;
    }
    this.#clearTimeout(this.#initTimer);
    this.#setMode('server');
    for (const id of [...this.#pending.keys()]) this.#fallBack(id);
  }

  /** One question the worker did not answer goes to the server. */
  #fallBack(id) {
    const waiting = this.#pending.get(id);
    if (waiting === undefined) return;
    this.#pending.delete(id);
    this.#clearTimeout(waiting.timer);
    this.#askServer(waiting.request).then(waiting.resolve, waiting.reject);
  }

  async #askServer({ fen, moves, level }) {
    if (!sameStart(fen)) {
      throw failure('position', 'The server can only play from the starting position');
    }
    let response;
    try {
      response = await this.#fetch(this.#urls.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: moves, level }),
      });
    } catch (error) {
      throw failure('unreachable', `The server could not be reached (${error?.message ?? error})`);
    }
    let reply = null;
    try {
      reply = await response.json();
    } catch {
      reply = null;
    }
    if (!response.ok && (reply === null || typeof reply.error !== 'string')) {
      throw failure('server', `The server answered ${response.status}`);
    }
    const result = fromServerReply(reply);
    if (!isPlayable({ fen, moves }, result.uci)) {
      throw failure('move', `The server answered with a move that cannot be played (${result.uci})`);
    }
    return result;
  }
}
