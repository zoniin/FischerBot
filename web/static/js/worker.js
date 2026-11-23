// worker.js - the Web Worker that hosts the FischerBot.
//
//   const worker = new Worker('/static/js/worker.js', { type: 'module' });
//
// The page sends requests and gets exactly one answer to each, carrying the
// request's `id`:
//
//   in   { type: 'init', id, urls: { book, style } }   fetch the two JSON files, build the bot
//   out  { type: 'ready', id, info }                    info: { engine, bookGames, bookPositions, levels }
//
//   in   { type: 'move', id, fen, moves, level }        the game so far (start FEN, UCI moves) and a level id
//   out  { type: 'move', id, result }                   what FischerBot.choose returns, plus `context`
//                                                       (describeContext in bot.js, for the commentary)
//
//   in   { type: 'newgame', id }                        forget the last game (hash table, history)
//   out  { type: 'ready', id, info }
//
//   out  { type: 'error', id, message }                 the answer to any request that could not be served
//
// Requests are served one at a time, in the order they arrive. A request that
// arrives while 'init' is still loading simply waits its turn; one that arrives
// before any 'init', or after an 'init' that failed, is answered with an error.
// Nothing is ever dropped, and no failure goes unanswered: whatever is thrown
// while serving a request comes back as an 'error' with that request's id.
// (A search cannot be interrupted: a 'move' is always answered, even if the page
// has lost interest in it meanwhile. The page ignores answers whose id is stale -
// and, so that questions nobody wants do not queue up here in front of the one
// that matters, engine-client.js posts a 'move' only when the last one has been
// answered, and then only the latest question it has.)
//
// The protocol lives in BotHost, which knows nothing about workers: it is handed
// a `post` function and a `load` function and can be driven from a Node test.
// The few lines at the bottom connect it to the worker's message port.

import { Engine, ENGINE_NAME } from './engine.js';
import { Book } from './book.js';
import { StyleModel } from './style.js';
import { FischerBot, LEVELS, describeContext } from './bot.js';

const LEVEL_IDS = Object.freeze(LEVELS.map(level => level.id));

function isObject(value) {
  return value !== null && typeof value === 'object';
}

/** The text of whatever was thrown. */
function describe(error) {
  if (isObject(error) && typeof error.message === 'string' && error.message !== '') return error.message;
  return String(error);
}

export class BotHost {
  #post;
  #load;
  #random;
  #parts = null;                    // { bot, book, info } once an 'init' has succeeded
  #failure = null;                  // why the last 'init' failed, while there are no parts
  #queue = Promise.resolve();       // settles when every request received so far has been answered

  /**
   * @param {object} options
   * @param {function(object): void} options.post  delivers an answer to the page
   * @param {function({book: string, style: string}): Promise<{engine: object, book: ?object, style: ?object, engineName?: string}>} options.load
   *   called for 'init' with the URLs of the request: builds the engine, the
   *   Book and the StyleModel the bot is to play with
   * @param {function(): number} [options.random]  for the book's weighted choice (tests fix it)
   */
  constructor({ post, load, random = Math.random }) {
    if (typeof post !== 'function' || typeof load !== 'function') {
      throw new TypeError('BotHost needs a post function and a load function');
    }
    this.#post = post;
    this.#load = load;
    this.#random = random;
  }

  /**
   * Takes one message from the page. It is served after all earlier ones.
   * The promise returned is fulfilled (never rejected) once the answer has
   * been posted.
   */
  receive(message) {
    const served = this.#queue.then(() => this.#serve(message));
    this.#queue = served;
    return served;
  }

  /** Answers one request; never throws. */
  async #serve(message) {
    const id = isObject(message) ? message.id : undefined;
    let answer;
    try {
      answer = await this.#answer(message, id);
    } catch (error) {
      answer = { type: 'error', id, message: describe(error) };
    }
    try {
      this.#post(answer);
    } catch (error) {
      // An answer that cannot be delivered (it would not clone, say) must not vanish.
      try {
        this.#post({ type: 'error', id, message: `The answer could not be sent: ${describe(error)}` });
      } catch {
        // The port itself is gone; there is nobody left to tell.
      }
    }
  }

  async #answer(message, id) {
    if (!isObject(message)) throw new Error('A request must be an object with a type and an id');
    switch (message.type) {
      case 'init':
        return { type: 'ready', id, info: await this.#init(message.urls) };
      case 'newgame': {
        const { bot, info } = this.#started();
        bot.newGame();
        return { type: 'ready', id, info };
      }
      case 'move': {
        const { bot, book } = this.#started();
        // The level travels as its id; a whole level object is taken by its id too.
        const wanted = isObject(message.level) ? message.level.id : message.level;
        const level = LEVELS.find(candidate => candidate.id === wanted);
        if (level === undefined) {
          throw new Error(`Unknown level ${JSON.stringify(wanted) ?? String(wanted)} (the levels are ${LEVEL_IDS.join(', ')})`);
        }
        const game = { fen: message.fen, moves: message.moves };
        bot.setLevel(level);
        const choice = bot.choose(game);
        const context = describeContext({ book, level, ...game, choice });
        return { type: 'move', id, result: { ...choice, context } };
      }
      default:
        throw new Error(`Unknown request type ${JSON.stringify(message.type) ?? String(message.type)}`);
    }
  }

  /** Loads the data and builds the bot; returns the `info` of the 'ready' answer. */
  async #init(urls) {
    let loaded;
    try {
      loaded = await this.#load(isObject(urls) ? urls : {});
      if (!isObject(loaded) || !isObject(loaded.engine)) throw new Error('nothing to play with was loaded');
    } catch (error) {
      if (this.#parts === null) this.#failure = describe(error);   // a bot that was already running keeps running
      throw error;
    }
    const { engine, book = null, style = null, engineName = ENGINE_NAME } = loaded;
    const bot = new FischerBot({ engine, book, style, random: this.#random });
    const info = {
      engine: engineName,
      bookGames: book === null ? 0 : book.games.length,
      bookPositions: book === null ? 0 : book.size,
      levels: LEVEL_IDS.slice(),
    };
    this.#parts = { bot, book, info };
    this.#failure = null;
    return info;
  }

  /** The running bot, or an error that says why there is none. */
  #started() {
    if (this.#parts !== null) return this.#parts;
    throw new Error(this.#failure === null
      ? "The bot has not been started: send 'init' first"
      : `The bot could not be started: ${this.#failure}`);
  }
}

// ---------------------------------------------------------------------------
// The worker itself
// ---------------------------------------------------------------------------

// Where the data lives when the 'init' request does not say: beside the scripts.
const DEFAULT_URLS = Object.freeze({
  book: new URL('../data/book.json', import.meta.url).href,
  style: new URL('../data/style.json', import.meta.url).href,
});

async function fetchJson(url, what) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Could not load ${what} (${url}): ${describe(error)}`);
  }
  if (!response.ok) throw new Error(`Could not load ${what} (${url}): HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Could not read ${what} (${url}): ${describe(error)}`);
  }
}

/** Fetches the book and the style model and builds the three parts of the bot. */
async function loadParts(urls) {
  const [bookData, styleData] = await Promise.all([
    fetchJson(urls.book ?? DEFAULT_URLS.book, 'the opening book'),
    fetchJson(urls.style ?? DEFAULT_URLS.style, 'the style model'),
  ]);
  return {
    engine: new Engine(),
    book: new Book(bookData),
    style: StyleModel.fromJSON(styleData),
    engineName: ENGINE_NAME,
  };
}

// Only inside a worker: this file can also be imported (by a Node test, say) for BotHost alone.
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  const port = globalThis;
  const host = new BotHost({ post: message => port.postMessage(message), load: loadParts });
  port.addEventListener('message', event => {
    host.receive(event.data);
  });
  // BotHost answers every failure of a request itself. Anything that still
  // escapes is reported too, without an id, so that the worker never fails in silence.
  const report = (what, reason) => {
    port.postMessage({ type: 'error', id: null, message: `${what}: ${describe(reason)}` });
  };
  port.addEventListener('messageerror', () => report('A request arrived that could not be read', 'messageerror'));
  port.addEventListener('unhandledrejection', event => report('Unexpected failure in the worker', event.reason));
  port.addEventListener('error', event => report('Unexpected failure in the worker', event.error ?? event.message));
}
