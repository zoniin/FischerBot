// bot.js - the FischerBot: opening book, then engine search, then style.
//
// A port of fischerbot/bot.py; the two make the same decisions.
//
// Move policy:
//   1. If the position appears in Fischer's real games with him to move, play
//      one of his actual moves (weighted by frequency and results), citing the
//      source game.
//   2. Otherwise search for the best move.
//   3. Then ask the style model which legal moves look more like Fischer than
//      the engine's choice. The model was trained with the engine's own verdict
//      as a feature, so it knows how many centipawns each stylistic preference
//      is worth; the most Fischer-like move is played if a verification search
//      at full depth - and then one ply deeper - proves it costs no more than
//      that (and never more than the level's margin, less in the endgame).
//      Style is never allowed to override tactics.
//
// The whole decision - search and verification together - stays inside the
// level's time budget.
//
// This module is pure: no DOM, no worker, no network. It drives an engine
// through the interface of engine.js (setPosition, search, scoreMove, newGame),
// a Book (book.js) and a StyleModel (style.js), all handed to it; worker.js
// puts the real ones together.

import { Position, Move, STARTING_FEN, PAWN, BLACK, parseSquare } from './rules.js';
import { gamePhase } from './style.js';

// ---------------------------------------------------------------------------
// Levels: four Fischers, youngest first
// ---------------------------------------------------------------------------

// The search settings of each level. `timeMs` bounds the whole reply; the three
// younger Fischers are held back by `maxDepth` and `nodeLimit` long before the
// clock. `styleMarginCp` is the most centipawns a Fischer-like move may cost
// against the engine's first choice. `strength` is what the page tells the
// player: an estimate from matches against Stockfish 16 held to fixed ratings
// (UCI_LimitStrength, 0.2-0.3 s a move) - see the README for the games behind it.
//
// The levels follow his own rise: his first published rating, in 1956, was
// 1726 and a year later he was a master at 2231; by 1958 he was a grandmaster
// and a Candidate; in 1963-64 he swept the U.S. Championship; in 1972 he was
// rated 2785.
const SEARCH_SETTINGS = {
  //             timeMs  maxDepth   nodeLimit  styleMarginCp  strength
  prodigy:     [    600,        6,      10000,            60, 'about 2000'],
  grandmaster: [   1000,       10,     100000,            50, 'about 2400'],
  champion:    [   1500,       12,     300000,            40, 'about 2650'],
  world:       [   2500,       64,   50000000,            30, 'about 2800'],
};

/** One level: who he is (for the chooser), which of his games the book may use, how hard he thinks. */
function defineLevel({ id, year, title, subtitle, blurb, later = false }) {
  const [timeMs, maxDepth, nodeLimit, styleMarginCp, strength] = SEARCH_SETTINGS[id];
  return Object.freeze({
    id, year, title, subtitle, blurb, strength,
    book: Object.freeze({ year, later }),
    timeMs, maxDepth, nodeLimit, styleMarginCp,
  });
}

/**
 * The levels, youngest first. Each is a frozen
 * { id, year, title, subtitle, blurb, strength, book: { year, later }, timeMs, maxDepth, nodeLimit, styleMarginCp }.
 * `book` is what the opening book is asked with: the games he had played by
 * `year`, and for the World Champion (`later`) every game he ever played.
 */
export const LEVELS = Object.freeze([
  defineLevel({
    id: 'prodigy',
    year: 1956,
    title: 'Bobby, age 13',
    subtitle: '1956 · the year of the Game of the Century',
    blurb: 'At thirteen he won the U.S. Junior Championship and, that October, sacrificed his queen against Donald Byrne in the “Game of the Century”.',
  }),
  defineLevel({
    id: 'grandmaster',
    year: 1958,
    title: 'Grandmaster at 15',
    subtitle: '1958 · Portorož, the youngest grandmaster yet',
    blurb: 'At the Portorož Interzonal he qualified for the Candidates and became, at fifteen, the youngest grandmaster the game had seen.',
  }),
  defineLevel({
    id: 'champion',
    year: 1963,
    title: 'U.S. Champion, 11–0',
    subtitle: '1963–64 · the only perfect score',
    blurb: 'He won the 1963–64 U.S. Championship with eleven wins in eleven games, the only perfect score in its history.',
  }),
  defineLevel({
    id: 'world',
    year: 1972,
    title: 'World Champion',
    subtitle: '1972 · Reykjavik',
    blurb: 'In Reykjavik he beat Boris Spassky, 12½–8½, and became the eleventh World Champion.',
    later: true,
  }),
]);

// ---------------------------------------------------------------------------
// The decision procedure
// ---------------------------------------------------------------------------

const DEFAULT_STYLE_MARGIN_CP = 40;   // for a level that does not say: most the bot will give up for style
const ENDGAME_STYLE_MARGIN_CP = 15;   // endgames punish small inaccuracies: stay closer to the engine
const MAX_STYLE_PROBES = 4;           // verification searches per move
const SEARCH_SHARE = 0.9;             // of the time budget; the rest is kept for verification
const MIN_STYLE_DEPTH = 3;            // a shallower search is too unreliable to deviate from (unless the level itself is shallower)
const STYLE_SCORE_LIMIT = 500;        // when winning or losing by this much, just play the best move

const ENDGAME = 2;                    // gamePhase(): 0 opening, 1 middlegame, 2 endgame

/** Milliseconds from some fixed moment, for measuring how long things take. */
const defaultNow = typeof performance === 'object' && typeof performance.now === 'function'
  ? () => performance.now()
  : () => Date.now();

/**
 * The position after the UCI moves `moves` have been played from `fen`, with
 * the moves as its history. Throws, naming the move, if one is not legal.
 */
function replay(fen, moves) {
  if (typeof fen !== 'string') throw new TypeError(`fen must be a string, not ${fen === null ? 'null' : typeof fen}`);
  if (!Array.isArray(moves)) throw new TypeError('moves must be an array of UCI move strings');
  const position = new Position(fen);
  moves.forEach((uci, index) => {
    let move;
    try {
      move = Move.fromUci(uci);
    } catch {
      throw new Error(`Malformed move at index ${index}: ${JSON.stringify(uci) ?? String(uci)}`);
    }
    if (!position.isLegal(move)) throw new Error(`Illegal move at index ${index}: '${uci}'`);
    position.push(move);
  });
  return position;
}

/**
 * Why the game is over in `position`, or null if it goes on. The game ends by
 * itself with mate, stalemate, insufficient material, seventy-five moves
 * without a capture or pawn move, or a fifth repetition; draws that have to be
 * claimed (threefold repetition, fifty moves) do not end it.
 */
function gameOverReason(position) {
  if (position.legalMoves().length === 0) return position.isCheck() ? 'checkmate' : 'stalemate';
  if (position.isInsufficientMaterial()) return 'insufficient material';
  if (position.halfmoveClock >= 150) return 'seventy-five moves without a capture or a pawn move';
  if (position.isRepetition(5)) return 'fivefold repetition';
  return null;
}

export class FischerBot {
  #now;

  /**
   * @param {object} parts
   * @param {object} parts.engine   an Engine (engine.js): setPosition, search, scoreMove, newGame
   * @param {?object} parts.book    a Book (book.js), or null to play without one
   * @param {?object} parts.style   a StyleModel (style.js), or null for the engine's own choice every time
   * @param {object} [parts.level]  one of LEVELS (or an object shaped like them); the World Champion if left out
   * @param {function(): number} [parts.random]  draws in [0, 1) for the book's weighted choice
   * @param {function(): number} [parts.now]     a millisecond clock (tests may replace it)
   */
  constructor({ engine, book = null, style = null, level = LEVELS[LEVELS.length - 1], random = Math.random, now = defaultNow } = {}) {
    if (engine === null || typeof engine !== 'object') throw new TypeError('FischerBot needs an engine');
    this.engine = engine;
    this.book = book ?? null;
    this.style = style ?? null;
    this.random = random;
    this.#now = now;
    this.setLevel(level);
  }

  /** Changes the level: a level object, as in LEVELS. Takes effect with the next move. */
  setLevel(level) {
    if (level === null || typeof level !== 'object' || !(level.timeMs > 0)) {
      throw new TypeError('A level is an object with a positive timeMs (see LEVELS)');
    }
    this.level = level;
  }

  /** Forgets everything the engine remembers from the last game. */
  newGame() {
    this.engine.newGame();
  }

  /**
   * Chooses a move for the side to move.
   *
   * @param {object} game
   * @param {string} [game.fen]      where the game started
   * @param {string[]} [game.moves]  the UCI moves played since
   * @returns {{uci: string, san: string, source: 'book'|'search'|'search+style',
   *            evalCp: ?number, depth: ?number, nodes: ?number, timeMs: number, pv: string[],
   *            engineSan?: string, book?: {game: object, games: object[], count: number}}}
   *   `evalCp` (centipawns, from the mover's side: the engine's verdict on its
   *   own first choice), `depth` and `nodes` are null and `pv` is empty for a
   *   book move, which comes with `book` instead: the game cited first, all
   *   the games with this move, and how many they are. `engineSan` is there
   *   only when style replaced the engine's move, and names that move.
   *   `timeMs` is how long the whole decision took.
   * Throws if the history is not legal or the game is already over.
   */
  choose({ fen = STARTING_FEN, moves = [] } = {}) {
    const start = this.#now();
    const level = this.level;
    const deadline = start + level.timeMs;

    const position = replay(fen, moves);
    const over = gameOverReason(position);
    if (over !== null) throw new Error(`Game is already over (${over})`);

    // 1. The book.
    if (this.book !== null) {
      const entry = this.book.choose(position, this.random(), level.book);
      if (entry !== null) {
        return {
          uci: entry.uci,
          san: position.san(position.parseUci(entry.uci)),
          source: 'book',
          evalCp: null,
          depth: null,
          nodes: null,
          timeMs: Math.floor(this.#now() - start),
          pv: [],
          book: { game: entry.games[0], games: entry.games, count: entry.count },
        };
      }
    }

    // 2. The search. It gets most of the budget - and never more than is left of it.
    this.engine.setPosition(fen, moves);
    const searchMs = Math.max(1, Math.min(Math.floor(level.timeMs * SEARCH_SHARE), deadline - this.#now()));
    const result = this.engine.search({ timeMs: searchMs, maxDepth: level.maxDepth, nodeLimit: level.nodeLimit });
    if (result === null || typeof result !== 'object' || typeof result.move !== 'string') {
      throw new Error('The engine found no move');
    }
    const choice = {
      uci: result.move,
      san: position.san(position.parseUci(result.move)),   // throws if the engine's move is not legal
      source: 'search',
      evalCp: result.scoreCp,
      depth: result.depth,
      nodes: result.nodes,
      timeMs: 0,
      pv: Array.isArray(result.pv) ? result.pv.slice() : [result.move],
    };

    // 3. Style, with whatever time is left.
    const alternative = this.#styleAlternative(position, result, deadline);
    if (alternative !== null && alternative !== result.move) {
      choice.engineSan = choice.san;
      choice.uci = alternative;
      choice.san = position.san(position.parseUci(alternative));
      choice.source = 'search+style';
      choice.pv = [alternative];
    }
    choice.timeMs = Math.floor(this.#now() - start);
    return choice;
  }

  /** Hard cap, in centipawns, on what a style choice may cost in this phase of the game. */
  styleMargin(phase) {
    const margin = this.level.styleMarginCp ?? DEFAULT_STYLE_MARGIN_CP;
    return phase === ENDGAME ? Math.min(margin, ENDGAME_STYLE_MARGIN_CP) : margin;
  }

  /**
   * The move (UCI) with the best balance of Fischer-likeness and engine score,
   * or null to stay with the engine's.
   *
   * Candidates are the moves the style model prefers to the engine's choice.
   * Each is searched at full depth to learn exactly what it costs; it wins if
   * its style outweighs that cost by more than any other candidate's does, and
   * is then confirmed one ply deeper. A move whose cost exceeds what its style
   * is worth - or the phase's margin - is never played.
   */
  #styleAlternative(position, result, deadline) {
    const style = this.style;
    if (style === null || result.depth < Math.min(MIN_STYLE_DEPTH, this.level.maxDepth ?? MIN_STYLE_DEPTH)) return null;
    const best = result.scoreCp;
    if (Math.abs(best) >= STYLE_SCORE_LIMIT) return null;

    const ranked = style.styleScores(position);
    const engineChoice = ranked.find(({ move }) => move.uci() === result.move);
    if (engineChoice === undefined) return null;

    const phase = gamePhase(position);
    const margin = this.styleMargin(phase);
    let chosen = null;
    let chosenSurplus = 0;    // how far the chosen move is past break-even, in centipawns
    let chosenFloor = 0;      // the lowest score the chosen move was allowed to have
    let probes = 0;
    for (const { move, score } of ranked) {
      const uci = move.uci();
      // Everything from the engine's pick down is less Fischer-like than it.
      if (uci === result.move || probes >= MAX_STYLE_PROBES) break;
      const allowed = style.allowedLoss(phase, score - engineChoice.score);
      // Moves come in order of style, so once even a free move could not beat
      // the current choice, nothing further down can either.
      if (allowed < 0 || allowed <= chosenSurplus) break;
      const left = deadline - this.#now();
      if (left <= 0) break;
      probes++;
      const limit = Math.trunc(Math.min(allowed, margin));
      const value = this.engine.scoreMove(uci, best - limit - 1, best + 1, result.depth, { timeMs: left });
      if (value === null || value === undefined || value < best - limit) continue;   // costs more than its style is worth (or time ran out)
      const surplus = allowed - Math.max(0, best - value);
      if (surplus > chosenSurplus) {
        chosen = uci;
        chosenSurplus = surplus;
        chosenFloor = best - limit;
      }
    }
    if (chosen === null) return null;

    // The engine's own move was the best of everything at this depth; the style
    // move was only shown to be close. Before deviating, make sure it still
    // holds up one ply deeper - if not (or if time is up), don't.
    const left = deadline - this.#now();
    if (left <= 0) return null;
    const deeper = this.engine.scoreMove(chosen, chosenFloor - 1, chosenFloor, result.depth + 1, { timeMs: left });
    if (deeper === null || deeper === undefined || deeper < chosenFloor) return null;
    return chosen;
  }
}

// ---------------------------------------------------------------------------
// Context for the commentary: whose game is being followed, which opening it is
// ---------------------------------------------------------------------------

// Opening families by ECO code: [volume, first, last, family]. The first row
// that contains the code wins, so the special cases come before the catch-alls.
const OPENING_FAMILIES = [
  ['B', 90, 99, 'sicilian_najdorf'],
  ['B', 20, 89, 'sicilian'],
  ['C', 60, 99, 'ruy_lopez'],
  ['E', 60, 99, 'kings_indian'],
  ['D', 70, 99, 'grunfeld'],
  ['C', 0, 19, 'french'],
  ['B', 10, 19, 'caro_kann'],
  ['C', 30, 39, 'kings_gambit'],
  ['D', 6, 69, 'queens_gambit'],
  ['E', 20, 59, 'nimzo_indian'],
  ['A', 10, 39, 'english'],
  ['B', 2, 5, 'alekhine'],
  ['B', 6, 9, 'pirc_modern'],
  ['C', 50, 59, 'italian'],
  ['B', 1, 1, 'scandinavian'],
  ['B', 0, 99, 'other_e4'],
  ['C', 0, 99, 'other_e4'],
  ['A', 0, 9, 'flank'],
  ['A', 40, 99, 'other_d4'],
  ['D', 0, 5, 'other_d4'],
  ['E', 0, 19, 'other_d4'],
];

const ECO_PATTERN = /^([A-E])(\d\d)$/;

/**
 * The opening family of an ECO code: 'B97' -> 'sicilian_najdorf', 'C95' ->
 * 'ruy_lopez', 'A77' -> 'other_d4'. Null for anything that is not an ECO code.
 */
export function openingFamily(eco) {
  const match = typeof eco === 'string' ? ECO_PATTERN.exec(eco) : null;
  if (match === null) return null;
  const volume = match[1];
  const number = Number(match[2]);
  for (const [letter, first, last, family] of OPENING_FAMILIES) {
    if (letter === volume && number >= first && number <= last) return family;
  }
  return null;   // not reached: the table covers every code
}

const MIN_OPENING_PLY = 4;        // before that it is too early to name an opening
const OPENING_SHARE = [3, 4];     // one family must account for at least 3/4 of the games
const A6 = parseSquare('a6');
const D6 = parseSquare('d6');

function hasBlackPawn(position, square) {
  return position.pieceTypeAt(square) === PAWN && position.colorAt(square) === BLACK;
}

/**
 * The opening the bot's book move belongs to, { eco, family }, once it can be
 * named: from the fifth half-move on, when one family accounts for at least
 * three quarters of the games the move was played in. `eco` is the code of the
 * game cited first. A Najdorf game counts as a plain Sicilian until ...a6 and
 * ...d6 are really on the board.
 */
function describeOpening(position, choice) {
  if (choice === null || typeof choice !== 'object' || choice.source !== 'book' || !choice.book) return null;
  if (position.moveStack.length < MIN_OPENING_PLY) return null;
  const games = choice.book.games;

  const after = position.copy();
  after.push(after.parseUci(choice.uci));
  const najdorfOnBoard = hasBlackPawn(after, A6) && hasBlackPawn(after, D6);

  const counts = new Map();
  for (const game of games) {
    let family = openingFamily(game.eco);
    if (family === 'sicilian_najdorf' && !najdorfOnBoard) family = 'sicilian';
    if (family !== null) counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  const [share, whole] = OPENING_SHARE;
  for (const [family, count] of counts) {
    if (whole * count >= share * games.length) return { eco: choice.book.game.eco, family };
  }
  return null;
}

/**
 * How the last move of the game - the human's - relates to Fischer's games:
 * { kind: 'follows', game, san } if one of his opponents played it in this
 * position, { kind: 'leaves', game, san } if it departs from the game the bot
 * was following (`san` is then the move that was played in that game), null
 * if there is nothing to say. `position` is the position after that move.
 */
function describePlayerMove(book, era, position) {
  if (book === null || book === undefined || position.moveStack.length === 0) return null;
  const before = position.copy();
  const played = before.pop();                  // `before` is now the position the human moved in
  const entries = book.replies(before, era);
  if (entries.length === 0) return null;

  // The game the bot's own previous move was cited from, if that was a book move.
  let followed = null;
  if (before.moveStack.length > 0) {
    const earlier = before.copy();
    const mine = earlier.pop().uci();
    const entry = book.lookup(earlier, era).find(candidate => candidate.uci === mine);
    if (entry !== undefined) followed = entry.games[0];
  }

  const uci = played.uci();
  const same = entries.find(entry => entry.uci === uci);
  if (same !== undefined) {
    const game = followed !== null && same.games.includes(followed) ? followed : same.games[0];
    return { kind: 'follows', game, san: before.san(played) };
  }
  if (followed === null) return null;   // a move nobody played against him is not "leaving" anything
  const his = entries.find(entry => entry.games.includes(followed));
  const entry = his ?? entries[0];
  const game = his !== undefined ? followed : entry.games[0];
  return { kind: 'leaves', game, san: before.san(before.parseUci(entry.uci)) };
}

/**
 * What the commentary is told about a move of the bot's. Pure and stateless:
 * everything is worked out from the game so far.
 *
 * @param {object} args
 * @param {?object} args.book     the Book the bot plays from, or null
 * @param {object} args.level     the level it plays at (its `book` settings pick the era)
 * @param {string} [args.fen]     where the game started
 * @param {string[]} [args.moves] the UCI moves played before the bot's move
 * @param {object} args.choice    what FischerBot.choose returned for this position
 * @returns {{ply: number, phase: number, playerMove: ?object, opening: ?object}}
 *   ply         number of half-moves played before the bot's move
 *   phase       gamePhase() of the position the bot moves in: 0 opening, 1 middlegame, 2 endgame
 *   playerMove  see describePlayerMove
 *   opening     see describeOpening
 */
export function describeContext({ book = null, level = null, fen = STARTING_FEN, moves = [], choice = null } = {}) {
  const position = replay(fen, moves);
  const era = level !== null && typeof level === 'object' ? level.book : undefined;
  return {
    ply: moves.length,
    phase: gamePhase(position),
    playerMove: describePlayerMove(book, era, position),
    opening: describeOpening(position, choice),
  };
}
