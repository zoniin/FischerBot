// events.js - turning what happened on the board into things worth a remark.
//
// Pure logic on top of rules.js: no DOM, no timers. The controller calls
//
//   moveFacts(positionBefore, move)        what kind of move that was
//   eventsForBotMove({ result, ... })      the events of one exchange (your move, his reply)
//   outcomeOf(position)                    has the game ended, and how
//   capturedMaterial(start, now)           the pieces each side has lost
//
// and hands the events to commentary.js, which decides whether he speaks.

import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, WHITE, BLACK, popcount } from './rules.js';

export const BLUNDER_CP = 200;
export const MISTAKE_CP = 90;
export const INACCURACY_CP = 40;
export const BETTER_CP = 150;
export const WINNING_CP = 400;
export const MATE_SCORE = 99000;        // at or beyond this a score is a forced mate
export const SACRIFICE_SEE = -200;
export const SACRIFICE_MIN_EVAL = -50;

const PIECE_VALUES = Object.freeze({ [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9 });

export function isMateFor(score) {
  return Number.isFinite(score) && score >= MATE_SCORE;
}

export function isMateAgainst(score) {
  return Number.isFinite(score) && score <= -MATE_SCORE;
}

/** Moves to mate for a mate score of either sign: 99997 (three plies) is mate in two. */
export function mateMoves(score) {
  return Math.max(1, Math.ceil((100000 - Math.abs(score)) / 2));
}

/**
 * How good was the human's move, judged by the bot's two evaluations around it?
 *
 * @param {object} facts
 * @param {?number} facts.before    his evaluation with his previous move (centipawns, his side)
 * @param {?number} facts.after     his evaluation now, after the human's reply
 * @param {?string} facts.expected  the reply his previous principal variation expected (UCI)
 * @param {?string} facts.played    the move the human played (UCI)
 * @returns {'blunder'|'mistake'|'inaccuracy'|'good'|null}  null when there is nothing to say
 *   (or nothing to judge by: he gives no evaluation while he is in book)
 */
export function classifyPlayerMove({ before = null, after = null, expected = null, played = null } = {}) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  if (isMateFor(before)) return null;              // it was lost already; nothing new to point at
  const rise = after - before;
  if (rise >= BLUNDER_CP) return 'blunder';
  if (rise >= MISTAKE_CP) return 'mistake';
  if (rise >= INACCURACY_CP) return 'inaccuracy';
  if (typeof expected === 'string' && expected !== '' && expected === played && rise <= 0) return 'good';
  return null;
}

/**
 * What kind of move this is, in the position it is about to be played in.
 * `see` is the static exchange value (null for castling and promotions).
 */
export function moveFacts(position, move) {
  const castle = position.isCastling(move);
  const capture = position.isCapture(move);
  const mover = position.pieceTypeAt(move.from);
  const victim = position.isEnPassant(move) ? PAWN : position.pieceTypeAt(move.to);
  const promotion = move.promotion !== 0;
  let see = null;
  if (!castle && !promotion) {
    try {
      see = position.see(move);
    } catch {
      see = null;
    }
  }
  return {
    capture,
    check: position.givesCheck(move),
    castle,
    promotion,
    queenTrade: capture && mover === QUEEN && victim === QUEEN,
    see,
  };
}

/** What the commentary has to remember from move to move within one game (plain JSON). */
export function newMemory() {
  return {
    lastEval: null,        // his evaluation with his last move (null while in book)
    lastPv: [],            // his principal variation then (UCI)
    wasInBook: false,      // his last move came from the book
    bookMoves: 0,          // how many of his moves came from the book
    leftBook: false,       // he has had to think for himself at least once
    openings: [],          // opening families already mentioned
    tides: [],             // 'bot_better', 'bot_winning', ... already said
    sawMate: false,
    sawMated: false,
    endgame: false,
  };
}

/** Which book category cites this game, and with which variables. */
export function bookCategory(game) {
  if (game === null || typeof game !== 'object') return 'book_move';
  if (game.source === 'wc1972') return 'book_move_1972';
  if (game.source === 'm60mg') return 'book_move_memorable';
  return 'book_move';
}

/**
 * The events of one exchange: the human's move (if any) and the bot's reply.
 *
 * @param {object} args
 * @param {object} args.result       the worker's result for his move ({ source, evalCp, pv, book, context })
 * @param {object} args.memory       newMemory() or what the last call returned
 * @param {object} args.botMove      moveFacts of his move
 * @param {?object} args.playerMove  moveFacts of the human's move before it (null if he moves first)
 * @param {?string} args.playerUci   that move in UCI
 * @param {function(object): object} [args.gameVariables]  book game -> template variables
 * @returns {{ events: object[], memory: object, verdict: ?string }}
 *   `events` in priority order for Commentator.pick; `memory` to keep for
 *   the next move; `verdict` is the judgement on the human's move.
 */
export function eventsForBotMove({
  result, memory = newMemory(), botMove = {}, playerMove = null, playerUci = null,
  gameVariables = () => ({}),
}) {
  const events = [];
  const next = {
    ...newMemory(), ...memory,
    openings: [...(memory.openings ?? [])],
    tides: [...(memory.tides ?? [])],
  };
  const add = (category, frequency, vars = {}) => events.push({ category, frequency, vars });

  const fromBook = result.source === 'book';
  const score = Number.isFinite(result.evalCp) ? result.evalCp : null;
  const context = result.context ?? null;
  const game = result.book?.game ?? null;

  const verdict = playerMove === null ? null : classifyPlayerMove({
    before: memory.lastEval,
    after: score,
    expected: Array.isArray(memory.lastPv) ? memory.lastPv[1] ?? null : null,
    played: playerUci,
  });

  // mate, one way or the other
  if (isMateFor(score) && !next.sawMate) {
    next.sawMate = true;
    add('mate_in_n', 'always', { n: mateMoves(score) });
  }
  if (isMateAgainst(score) && !next.sawMated) {
    next.sawMated = true;
    add('getting_mated', 'always');
  }

  if (verdict === 'blunder') add('player_blunder', 'always');

  // his own games
  const bookVars = gameVariables(game);
  const firstBookMove = fromBook && next.bookMoves === 0;
  if (firstBookMove) add(bookCategory(game), 'always', bookVars);

  const playerInHistory = context?.playerMove ?? null;
  if (playerInHistory?.kind === 'leaves') {
    add('player_leaves_history', 'always', {
      ...gameVariables(playerInHistory.game),
      san: playerInHistory.san,
    });
  }

  if (!fromBook && next.bookMoves > 0 && !next.leftBook) add('out_of_book', 'always');

  const family = context?.opening?.family ?? null;
  if (typeof family === 'string' && !next.openings.includes(family)) {
    next.openings.push(family);
    add(`opening_${family}`, 'always');
  }

  // the tide: the strongest new statement only, the weaker one is then old news
  if (score !== null) {
    const crossed = [];
    if (score >= BETTER_CP) crossed.push('bot_better');
    if (score >= WINNING_CP) crossed.push('bot_winning');
    if (score <= -BETTER_CP) crossed.push('bot_worse');
    if (score <= -WINNING_CP) crossed.push('bot_losing');
    const fresh = crossed.filter(name => !next.tides.includes(name));
    if (fresh.length > 0) {
      next.tides.push(...fresh);
      add(fresh[fresh.length - 1], 'always');
    }
  }

  if (context?.phase === 2 && !next.endgame) {
    next.endgame = true;
    add('endgame_reached', 'always');
  }

  if (botMove.promotion) add('bot_promotes', 'always');
  if (playerMove?.promotion) add('player_promotes', 'always');

  if (!fromBook && Number.isFinite(botMove.see) && botMove.see <= SACRIFICE_SEE
      && score !== null && score >= SACRIFICE_MIN_EVAL) {
    add('bot_sacrifice', 'often');
  }

  if (botMove.queenTrade) add('bot_queen_trade', 'often');
  if (playerMove?.queenTrade) add('player_queen_trade', 'often');

  if (verdict === 'mistake') add('player_mistake', 'often');
  if (verdict === 'inaccuracy') add('player_inaccuracy', 'sometimes');
  if (verdict === 'good') add('player_good_move', 'sometimes');

  if (playerInHistory?.kind === 'follows') {
    add('player_follows_history', 'sometimes', gameVariables(playerInHistory.game));
  }

  if (fromBook && !firstBookMove) add(bookCategory(game), 'sometimes', bookVars);

  if (botMove.capture) add('bot_capture', 'sometimes');
  if (botMove.check) add('bot_check', 'sometimes');
  if (botMove.castle) add('bot_castles', 'sometimes');
  if (playerMove?.capture) add('player_capture', 'sometimes');
  if (playerMove?.check) add('player_check', 'sometimes');
  if (playerMove?.castle) add('player_castles', 'sometimes');

  add('quotes', 'sometimes');

  // what to remember for the next move
  next.lastEval = score;
  next.lastPv = Array.isArray(result.pv) ? result.pv.slice(0, 4) : [];
  if (fromBook) next.bookMoves += 1;
  else if (next.bookMoves > 0) next.leftBook = true;
  next.wasInBook = fromBook;

  return { events, memory: next, verdict };
}

/**
 * Has the game ended? Checkmate, stalemate, insufficient material, and the two
 * claims (threefold repetition, fifty moves), which are made automatically.
 *
 * @returns {?{ kind: 'checkmate'|'stalemate'|'insufficient'|'repetition'|'fifty', winner: ?boolean }}
 *   `winner` is WHITE, BLACK or null for a draw; null if the game goes on.
 */
export function outcomeOf(position) {
  if (position.isCheckmate()) return { kind: 'checkmate', winner: position.turn === WHITE ? BLACK : WHITE };
  if (position.isStalemate()) return { kind: 'stalemate', winner: null };
  if (position.isInsufficientMaterial()) return { kind: 'insufficient', winner: null };
  if (position.canClaimFiftyMoves()) return { kind: 'fifty', winner: null };
  if (position.canClaimThreefoldRepetition()) return { kind: 'repetition', winner: null };
  return null;
}

/** The commentary category for the end of the game, from the bot's side of the board. */
export function gameOverCategory(outcome, botColor) {
  switch (outcome?.kind) {
    case 'checkmate': return outcome.winner === botColor ? 'win_checkmate' : 'loss_checkmate';
    case 'stalemate': return 'draw_stalemate';
    case 'repetition': return 'draw_repetition';
    case 'fifty': return 'draw_fifty_moves';
    case 'insufficient': return 'draw_insufficient';
    default: return null;
  }
}

function census(position, color) {
  const own = position.occupiedCo(color);
  return {
    [PAWN]: popcount(position.pawns & own),
    [KNIGHT]: popcount(position.knights & own),
    [BISHOP]: popcount(position.bishops & own),
    [ROOK]: popcount(position.rooks & own),
    [QUEEN]: popcount(position.queens & own),
  };
}

/**
 * The pieces each side has lost since `start`, and the material balance.
 *
 * @returns {{ lostByWhite: number[], lostByBlack: number[], balance: number }}
 *   piece types, most valuable first (a promoted pawn counts as a lost pawn,
 *   never as a negative queen); `balance` is White's material minus Black's
 *   in pawns (queen 9, rook 5, bishop 3, knight 3).
 */
export function capturedMaterial(start, now) {
  const lost = color => {
    const before = census(start, color), after = census(now, color);
    const pieces = [];
    for (const type of [QUEEN, ROOK, BISHOP, KNIGHT, PAWN]) {
      for (let i = after[type]; i < before[type]; i += 1) pieces.push(type);
    }
    return pieces;
  };
  const points = color => {
    const count = census(now, color);
    return Object.entries(PIECE_VALUES).reduce((sum, [type, value]) => sum + value * count[type], 0);
  };
  return { lostByWhite: lost(WHITE), lostByBlack: lost(BLACK), balance: points(WHITE) - points(BLACK) };
}
