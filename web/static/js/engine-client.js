// engine-client.js - asking Fischer for a move.
//
// The normal path is the Web Worker (worker.js: book, search and style in the
// browser). If the worker cannot start, fails, or goes silent, the same
// question goes to the server (POST /api/move) and its answer is reshaped to
// look like the worker's. The caller never learns which one answered unless
// it asks (`result.via`, `client.mode`); it hears of a failure only when both
// have failed - and then the error says what happened (`error.kind`:
// 'unreachable' | 'server' | 'move' | 'position'). The server is given twenty
// seconds for the whole exchange; after that it counts as unreachable.
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
//
// One question at a time, and the latest one wins. A search cannot be
// interrupted, and the worker answers strictly in order - so only one question
// is ever out (in the worker, or with the server). One that is asked meanwhile
// is held back, and a newer one takes its place: the page only ever wants the
// answer to its latest question. A question that was replaced before it was
// sent is never sent anywhere, the server included; its promise is rejected
// with `error.kind === 'superseded'`, which its caller, having asked again,
// ignores. The time a question is allowed before the worker counts as silent
// starts when it is really posted, not when it was asked.

import { Position, STARTING_FEN } from './rules.js';

const DEFAULT_URLS = Object.freeze({
  worker: '/static/js/worker.js',
  api: '/api/move',
  book: '/static/data/book.json',
  style: '/static/data/style.json',
});

const INIT_TIMEOUT_MS = 25000;      // the book is a large file on a slow line
const MOVE_GRACE_MS = 5000;         // on top of the level's own thinking time, before the worker counts as silent

/** What the server is allowed for the whole exchange: the request and the reading of its answer. */
export const SERVER_TIMEOUT_MS = 20000;

/** An Error with a `kind` the page can explain in plain words. */
function failure(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

/** How a question ends that was replaced by a newer one (or by a new game) before anyone answered it. */
function superseded() {
  return failure('superseded', 'A newer question took the place of this one');
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
  // a question: { id, request, timeMs, resolve, reject, place: null | 'worker' | 'server', timer, unwanted }
  #asked = null;                  // the one question that is out, in the worker or with the server
  #held = null;                   // the latest question, waiting for that one to be settled
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
   * @param {{setTimeout: function, clearTimeout: function}} [options.timers]  (tests bring their own clock)
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

  /**
   * A new game: the engine forgets the last one. Nothing to wait for. A
   * question of the last game that has not been sent yet never is; whatever
   * the worker is still working on comes before the 'newgame', whatever is
   * asked from now on comes after it.
   */
  newGame() {
    this.forget();
    if (this.#mode === 'worker') this.#post({ type: 'newgame', id: this.#nextId++ });
  }

  /**
   * The caller no longer wants an answer to anything it has asked (a move was
   * taken back, say). A question that is still held back is never sent, and
   * the one the worker is working on is not taken to the server if the worker
   * fails with it. Nothing has to call this - an answer nobody wants is simply
   * ignored - but it saves a search of a position nobody is looking at.
   */
  forget() {
    if (this.#asked !== null) this.#asked.unwanted = true;
    if (this.#held === null) return;
    const question = this.#held;
    this.#held = null;
    question.reject(superseded());
  }

  /**
   * His move in the game so far. The latest question wins: see the top of the file.
   *
   * @param {object} game
   * @param {string} game.fen       where the game started
   * @param {string[]} game.moves   the UCI moves played since
   * @param {string} game.level     a level id from LEVELS
   * @param {number} [game.timeMs]  how long that level thinks (to know when the worker has gone silent)
   * @returns {Promise<object>} the worker's result (see bot.js), plus `via: 'worker' | 'server'`;
   *   rejected with `kind: 'superseded'` if a newer question (or a new game) came before this one was answered
   *   and it was never sent, or could not be answered by the worker
   */
  move({ fen = STARTING_FEN, moves = [], level, timeMs = 3000 }) {
    if (this.#mode === 'idle') this.start();
    return new Promise((resolve, reject) => {
      if (this.#held !== null) this.#held.reject(superseded());
      this.#held = {
        id: this.#nextId++, request: { fen, moves: [...moves], level }, timeMs,
        resolve, reject, place: null, timer: null, unwanted: false,
      };
      this.#sendNext();
    });
  }

  /** Stops the worker for good (page teardown, tests). */
  dispose() {
    if (this.#worker !== null) {
      try { this.#worker.terminate(); } catch { /* already gone */ }
    }
    this.#worker = null;
    this.#clearTimeout(this.#initTimer);
    const open = [this.#asked, this.#held].filter(question => question !== null);
    this.#asked = null;
    this.#held = null;
    for (const question of open) {
      this.#clearTimeout(question.timer);
      question.reject(new Error('The engine was shut down'));
    }
  }

  /** Sends the question that is held back, if nothing else is out. */
  #sendNext() {
    if (this.#asked !== null || this.#held === null) return;
    const question = this.#held;
    this.#held = null;
    this.#asked = question;
    if (this.#mode === 'worker') this.#toWorker(question);
    else this.#toServer(question);
  }

  #toWorker(question) {
    question.place = 'worker';
    // the clock of a question starts here, when it is posted: while it was held back it was not the worker's
    const patience = question.timeMs + MOVE_GRACE_MS + (this.#info === null ? INIT_TIMEOUT_MS : 0);
    question.timer = this.#setTimeout(() => this.#workerFailed(question), patience);
    this.#post({ type: 'move', id: question.id, ...question.request });
  }

  #toServer(question) {
    question.place = 'server';
    this.#askServer(question.request).then(
      result => this.#settle(question, result, null),
      error => this.#settle(question, null, error),
    );
  }

  /**
   * The worker did not answer this question (an error, not a move, silence,
   * or no worker any more): the server is asked instead - unless a newer
   * question is waiting, or the caller has said that it has lost interest.
   */
  #workerFailed(question) {
    if (this.#asked !== question || question.place !== 'worker') return;
    this.#clearTimeout(question.timer);
    question.timer = null;
    if (this.#held !== null || question.unwanted) this.#settle(question, null, superseded());
    else this.#toServer(question);
  }

  /** The question that was out has its answer (or its failure); the next one may go. */
  #settle(question, result, error) {
    if (this.#asked !== question) return;           // dispose() has settled it already
    this.#asked = null;
    this.#clearTimeout(question.timer);
    if (error !== null) question.reject(error);
    else question.resolve(result);
    this.#sendNext();
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
    const asked = this.#asked !== null && this.#asked.place === 'worker' && this.#asked.id === message.id
      ? this.#asked : null;
    if (message.type === 'move') {
      if (asked === null) return;                   // answered by the server meanwhile, or nobody asked
      if (isPlayable(asked.request, message.result?.uci)) this.#settle(asked, { ...message.result, via: 'worker' }, null);
      else this.#workerFailed(asked);               // not a move: as good as an error
      return;
    }
    if (message.type === 'error') {
      if (message.id === this.#initId || message.id === null || message.id === undefined) {
        // it could not load its data, or something escaped: do not trust it again
        this.#abandonWorker();
      } else if (asked !== null) {
        this.#workerFailed(asked);
      }
    }
  }

  /** The worker is of no use any more: the open question goes to the server instead. */
  #abandonWorker() {
    if (this.#worker !== null) {
      try { this.#worker.terminate(); } catch { /* already gone */ }
      this.#worker = null;
    }
    this.#clearTimeout(this.#initTimer);
    this.#setMode('server');
    if (this.#asked !== null) this.#workerFailed(this.#asked);
  }

  /**
   * One question for the server. The whole exchange - the request and the
   * reading of the answer - has SERVER_TIMEOUT_MS; a line that has stalled
   * must not leave him "thinking" for ever.
   */
  async #askServer({ fen, moves, level }) {
    if (!sameStart(fen)) {
      throw failure('position', 'The server can only play from the starting position');
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    const limit = new Promise((_, reject) => {
      timer = this.#setTimeout(() => {
        reject(failure('unreachable', `The server did not answer within ${SERVER_TIMEOUT_MS / 1000} seconds`));
        if (controller !== null) controller.abort();
      }, SERVER_TIMEOUT_MS);
    });
    const exchange = this.#exchange({ fen, moves, level }, controller === null ? undefined : controller.signal);
    exchange.catch(() => {});           // once the limit has spoken, what becomes of the exchange interests nobody
    try {
      return await Promise.race([exchange, limit]);
    } finally {
      this.#clearTimeout(timer);
    }
  }

  async #exchange({ fen, moves, level }, signal) {
    let response;
    try {
      response = await this.#fetch(this.#urls.api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: moves, level }),
        signal,
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
