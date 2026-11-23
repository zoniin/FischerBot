// link.js - a game from a link: ?fen=<FEN> and/or ?moves=e2e4,e7e5, with
// ?level=<id> and ?color=white|black. Pure: it reads a query string and says
// which game it asks for, or null. It knows nothing about the page.
//
//   const asked = gameFromLink(window.location.search, { levels: LEVELS, levelId: prefs.levelId });
//   // null, or { level, human, startFen, moves }
//
// A link is somebody else's text. A FEN that parses is not yet a chess
// position (no kings, sixty-four queens, the side that has just moved left in
// check): such a FEN is ignored, and the link is read as if it had none.

import { Position, STARTING_FEN, WHITE, BLACK, BB_RANKS, popcount } from './rules.js';

const BACK_RANKS = BB_RANKS[0] | BB_RANKS[7];

/**
 * Could this position stand on a chessboard in a game? Each side has exactly one
 * king, at most eight pawns and sixteen men; no pawn stands on the first or the
 * eighth rank; and the side that is not to move is not in check.
 * @param {Position} position
 */
export function isChessPosition(position) {
  for (const color of [WHITE, BLACK]) {
    const men = position.occupiedCo(color);
    if (popcount(position.kings & men) !== 1) return false;
    if (popcount(men) > 16) return false;
    if (popcount(position.pawns & men) > 8) return false;
  }
  if ((position.pawns & BACK_RANKS) !== 0n) return false;
  const waiting = !position.turn;
  return !position.isAttackedBy(position.turn, position.king(waiting));
}

/** The FEN if it is one of a chess position, otherwise null. */
export function playableFen(fen) {
  if (typeof fen !== 'string' || fen.trim() === '') return null;
  try {
    return isChessPosition(new Position(fen)) ? fen : null;
  } catch {
    return null;
  }
}

/**
 * The game a query string asks for.
 * @param {string|URLSearchParams} search   window.location.search
 * @param {object} options
 * @param {{id: string}[]} options.levels   the levels, weakest first
 * @param {?string} [options.levelId]       the level to use when the link names none (the one played last)
 * @returns {?{level: object, human: boolean, startFen: string, moves: string[]}}
 *          null when the link asks for no game, or for moves that cannot be played
 */
export function gameFromLink(search, { levels, levelId = null }) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search);
  const byId = id => levels.find(level => level.id === id) ?? null;
  // a FEN that is not a chess position: the link is read as if it had none
  const fen = params.has('fen') ? playableFen(params.get('fen')) : null;
  if (fen === null && !params.has('moves') && !params.has('level')) return null;
  const level = byId(params.get('level')) ?? byId(levelId) ?? levels[levels.length - 1];
  const colour = (params.get('color') ?? params.get('colour') ?? 'white').toLowerCase();
  const startFen = fen ?? STARTING_FEN;
  const moves = (params.get('moves') ?? '').split(/[\s,]+/).filter(Boolean);
  try {
    Position.fromMoves(moves, startFen);
  } catch {
    return null;
  }
  return { level, human: colour.startsWith('b') ? BLACK : WHITE, startFen, moves };
}
