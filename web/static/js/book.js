// book.js - the opening book: the moves Bobby Fischer actually played.
//
// A port of fischerbot/book.py; the two must give identical answers. The book
// is keyed by position (EPD), not by move sequence, so transpositions into his
// lines are recognised. For every position in the first twenty moves of his
// games it knows
//
//   * the moves Fischer played there (lookup, choose) - the bot follows his
//     choices, each with the games it comes from, and
//   * the moves his opponents played there (replies) - so the bot can say
//     "Spassky played Nf3 here" when you follow or leave one of his games.
//
// The book can be restricted to an era: { year: 1958 } uses only the games he
// had played by 1958 and favours the recent ones, which is how the "Grandmaster
// at 15" level gets a fifteen-year-old's repertoire.
//
// The data is web/static/data/book.json, written by tools/build_web_data.py:
//
//   { version: 2, maxPlies: 40,
//     weights:   { resultBase, resultBonus, recentYears, recencyDecay, recencyFloor },
//     games:     [ { key, cite, opponent, event, year, white, score, source, number, eco }, ... ],
//     positions: { '<epd>': [ ['e2e4', [0, 5, 7]], ... ] },    Fischer to move: move, indices into games
//     replies:   { '<epd>': [ ['c7c5', [0, 4]], ... ] } }      his opponent to move
//
// This module is pure: it needs a rules.js Position to ask about and nothing else.

/** The book file format this code reads. */
const BOOK_VERSION = 2;

// How much a game counts toward a move's weight when the book file does not
// say (it always does; these are the values of fischerbot/book.py).
const DEFAULT_WEIGHTS = Object.freeze({
  resultBase: 0.6,       // a loss still counts for something: he did play it
  resultBonus: 0.8,      // ... a win counts for 1.4
  recentYears: 4,        // games this close to the chosen era count in full
  recencyDecay: 0.08,    // each year older than that costs this much ...
  recencyFloor: 0.35,    // ... down to this
});

// Which game to cite first: the match of 1972, then My 60 Memorable Games, then the rest.
const SOURCE_RANK = new Map([['wc1972', 0], ['m60mg', 1], ['career', 2]]);
const UNKNOWN_SOURCE_RANK = 9;

/**
 * The sum of a list of numbers, computed exactly as Python's built-in sum()
 * computes it (CPython 3.12 and later): Neumaier's compensated summation, in
 * which the rounding error of every addition is collected and added back at
 * the end. The reference implementation adds up weights with sum(); a plain
 * loop here could differ from it in the last bit, which is enough to order
 * two equally weighted moves differently or to move a pick across a boundary.
 */
function pythonSum(values) {
  if (values.length === 0) return 0;
  let total = values[0];
  let lost = 0;                         // what the additions so far have rounded away
  for (let i = 1; i < values.length; i++) {
    const value = values[i];
    const next = total + value;
    if (Math.abs(total) >= Math.abs(value)) lost += (total - next) + value;
    else lost += (value - next) + total;
    total = next;
  }
  return lost !== 0 && Number.isFinite(lost) ? total + lost : total;
}

/** A book table as a Map from EPD to its list of [uci, game indices]. */
function tableOf(source, name) {
  if (source === null || typeof source !== 'object') throw new TypeError(`The book file has no '${name}' table`);
  return new Map(Object.entries(source));
}

export class Book {
  #positions;    // Fischer to move:     EPD -> [[uci, [game index, ...]], ...]
  #replies;      // his opponent to move, the same shape
  #weights;

  /**
   * @param {object} data  the parsed book.json. The book keeps references into
   *                       it, so it must not be modified afterwards.
   */
  constructor(data) {
    if (data === null || typeof data !== 'object') throw new TypeError('A Book needs the parsed book.json');
    if (data.version !== BOOK_VERSION) throw new Error('Unsupported book file version');
    if (!Array.isArray(data.games)) throw new TypeError("The book file has no 'games' list");

    /**
     * Every game the book was built from, in the order of the file:
     * { key, cite, opponent, event, year, white, score, source, number, eco }.
     * `white` says whether Fischer had White; `score` is his result (1, 0.5 or 0).
     * The objects are frozen: the same ones appear in every answer of the book.
     */
    this.games = Object.freeze(data.games.map(game => Object.freeze({ ...game, eco: game.eco ?? '' })));
    this.#positions = tableOf(data.positions, 'positions');
    this.#replies = tableOf(data.replies, 'replies');
    this.#weights = Object.freeze({ ...DEFAULT_WEIGHTS, ...data.weights });
  }

  /** Number of positions in which the book knows a move of Fischer's. */
  get size() {
    return this.#positions.size;
  }

  /**
   * Fischer's moves in this position, best-weighted first.
   *
   * `year` restricts the book to the games he had played by then and favours
   * the recent ones; `later: true` keeps the later games as well (used by the
   * strongest level, which knows everything he ever played).
   *
   * @param {Position} position  a rules.js Position
   * @param {{year?: number|null, later?: boolean}} [options]
   * @returns {{uci: string, games: object[], count: number, points: number, weight: number}[]}
   *   for each move: the games (of the chosen era) it was played in, the one to
   *   cite first at the front; how many they are; the sum of Fischer's scores
   *   in them; and the weight choose() draws by. The list and its entries are
   *   new objects on every call; the games are the frozen ones of `this.games`.
   */
  lookup(position, options) {
    return this.#moves(this.#positions, position, options);
  }

  /** What Fischer's opponents played in this position: the same answer as lookup(), for their moves. */
  replies(position, options) {
    return this.#moves(this.#replies, position, options);
  }

  /**
   * A weighted choice among Fischer's moves here, or null if the book has none.
   *
   * `r` in [0, 1) fixes the draw: the moves are laid end to end in lookup()
   * order, each as long as its weight, and `r` says how far along the pick is.
   * Left out, the draw is random.
   */
  choose(position, r, options) {
    if (r !== undefined && r !== null && (typeof r !== 'number' || Number.isNaN(r))) {
      throw new TypeError(`The draw must be a number in [0, 1), not ${r}`);
    }
    const moves = this.lookup(position, options);
    if (moves.length === 0) return null;
    const draw = r === undefined || r === null ? Math.random() : r;
    const target = draw * pythonSum(moves.map(move => move.weight));
    let running = 0;
    for (const move of moves) {
      running += move.weight;
      if (running > target) return move;
    }
    return moves[moves.length - 1];
  }

  #moves(table, position, options) {
    const { year = null, later = false } = options ?? {};
    const entries = table.get(position.epd());
    if (entries === undefined) return [];

    const { resultBase, resultBonus } = this.#weights;
    const legal = new Set(position.legalMoves().map(move => move.uci()));
    const moves = [];
    for (const [uci, indices] of entries) {
      if (!legal.has(uci)) continue;
      let games = indices.map(index => this.games[index]);
      if (year !== null && !later) games = games.filter(game => game.year <= year);
      if (games.length === 0) continue;
      // The weight is summed in the order of the file, before the games are put in citation order.
      const weight = pythonSum(games.map(game => (resultBase + resultBonus * game.score) * this.#recency(year, game.year)));
      games.sort((a, b) => this.#citationOrder(a, b, year));
      moves.push({
        uci,
        games,
        count: games.length,
        points: pythonSum(games.map(game => game.score)),
        weight,
      });
    }
    moves.sort((a, b) => (b.weight - a.weight) || (a.uci < b.uci ? -1 : a.uci > b.uci ? 1 : 0));
    return moves;
  }

  /** Weight of a game played in `gameYear` for a bot set in `year` (null: no era). */
  #recency(year, gameYear) {
    if (year === null) return 1;
    const { recentYears, recencyDecay, recencyFloor } = this.#weights;
    const age = Math.max(0, year - gameYear);
    if (age <= recentYears) return 1;
    return Math.max(recencyFloor, 1 - recencyDecay * (age - recentYears));
  }

  /** Orders two games for citing: the famous ones first, then the era's, then his best results, then by number. */
  #citationOrder(a, b, year) {
    const rank = game => SOURCE_RANK.get(game.source) ?? UNKNOWN_SOURCE_RANK;
    const distance = game => (year === null ? 0 : Math.abs(year - game.year));
    return (rank(a) - rank(b)) || (distance(a) - distance(b)) || (b.score - a.score) || (a.number - b.number);
  }
}
