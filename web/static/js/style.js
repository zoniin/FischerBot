// style.js - the Fischer style model: which of the sound moves would Fischer play?
//
// A port of fischerbot/style.py, written against rules.js.
//
// The engine decides which moves are *playable*; this model decides which of
// them looks most like Fischer. It is a conditional-logit ranker
//
//     P(move | position)  proportional to  exp(w . f(position, move))
//
// trained (see train_style.py) on the positions of his games where he was to
// move, with the choice restricted to the moves the engine scored within
// about half a pawn of its favourite. So the weights describe preference
// between reasonable moves; they do not re-learn "do not hang your queen".
//
// Two of the features come from the engine itself - how many centipawns a
// move gives up against the engine's first choice, and whether it *is* the
// first choice - so the trade-off between style and strength is learned from
// his games rather than set by hand. `allowedLoss` turns those two weights
// into the price the bot may pay for a more Fischer-like move.
//
// The Python code is the reference and the trainer: this file must give the
// same features with the same indices and values in the same order, and the
// same scores, whatever weights the model file holds. web/tests/style.test.js
// checks that against values computed by the Python. Change one side and the
// other has to follow.

import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  SQUARE_NAMES, parseSquare, squareDistance,
  BB_ALL, BB_SQUARES, BB_FILES, BB_RANKS, BB_KNIGHT_ATTACKS, BB_KING_ATTACKS, BB_PAWN_ATTACKS,
  bishopAttacks, rookAttacks, bbBetween, bbRay, popcount, bbSquares,
} from './rules.js';

// ---------------------------------------------------------------------------
// The features and where their weights live
// ---------------------------------------------------------------------------

export const PHASES = Object.freeze(['opening', 'middlegame', 'endgame']);

/** Full moves treated as "the opening". */
export const OPENING_MOVES = 12;

/** Features learned separately for each phase of the game. */
export const PHASE_FEATURES = Object.freeze([
  'piece_pawn',         // which piece moves: exactly one of these six
  'piece_knight',
  'piece_bishop',
  'piece_rook',
  'piece_queen',
  'piece_king',
  'capture',            // takes something
  'capture_value',      // what it takes, as a share of a queen (pawn 1/9 ... queen 1)
  'recapture',          // takes on the square the opponent has just moved to
  'even_trade',         // takes a piece worth what the capturing piece is worth
  'check',              // gives check
  'forward',            // ranks advanced, in sevenths of the board; negative when going back
  'retreat',            // a piece (not a pawn) goes backwards
  'to_centre',          // how central the destination is: 0 on the edge, 0.73 on d4, e4, d5, e5
  'centre_gain',        // how much more central than where the piece came from
  'near_enemy_king',    // how close the destination is to the enemy king: 6/7 next to him, 0 seven king moves off
  'king_approach',      // how much closer to the enemy king than before
  'escapes_attack',     // the piece was attacked by something cheaper, or attacked and unprotected
  'into_pawn_attack',   // a piece goes where an enemy pawn attacks it
  'to_defended',        // the destination is covered by another of the mover's pieces
  'creates_threat',     // from its new square the piece attacks something dearer or unprotected
  'quiet_move',         // no capture, check, threat, escape, castling or promotion
  'sacrifice',          // the exchanges on the destination square lose material
  'engine_loss',        // centipawns / 100 given up against the engine's first choice (added by the caller)
  'engine_best',        // the move is the engine's first choice (added by the caller)
]);

/** Features with one weight for the whole game. */
export const GLOBAL_FEATURES = Object.freeze([
  'castle_kingside',
  'castle_queenside',
  'promotion',
  'pawn_centre_push',         // a pawn advances on the d- or e-file
  'pawn_bishop_file_push',    // ... on the c- or f-file
  'pawn_flank_push',          // ... on the a-, b-, g- or h-file
  'pawn_double_step',         // a pawn advances two squares
  'pawn_lever',               // from its new square the pawn attacks an enemy pawn
  'pawn_passed_push',         // no enemy pawn ahead of it on its own or a neighbouring file
  'pawn_storm',               // a pawn on its fourth rank or beyond, within a file of the enemy king (not in the endgame)
  'pawn_shelter_push',        // a pawn on or next to the file of its own king, who stands on his home rank
  'knight_develops',          // a knight leaves the home rank
  'knight_to_rim',            // a knight goes to the a- or h-file
  'knight_outpost',           // a knight on its 4th-6th rank, protected by a pawn, that no enemy pawn can ever attack
  'bishop_develops',          // a bishop leaves the home rank
  'bishop_fianchetto',        // a bishop goes to b2, g2, b7 or g7
  'bishop_long_diagonal',     // a bishop goes to a1-h8 or h1-a8
  'bishop_takes_knight',
  'knight_takes_bishop',
  'rook_open_file',           // a rook changes to a file without pawns
  'rook_semi_open_file',      // ... to a file with enemy pawns only
  'rook_seventh_rank',        // a rook arrives on its seventh rank
  'queen_early',              // a queen move in the opening
  'queen_trade',              // queen takes queen
  'king_walk',                // a king move other than castling, before the endgame
  'king_to_centre_endgame',   // a king move towards the centre in the endgame
]);

// The weight vector: one block of phase features per phase, the whole-game
// features, then the opening repertoire - where each piece goes in the first
// moves, per colour: 2 colours x 6 piece types x 64 squares.
export const N_PHASE = PHASE_FEATURES.length;
export const N_GLOBAL = GLOBAL_FEATURES.length;
const GLOBAL_OFFSET = N_PHASE * PHASES.length;
const REPERTOIRE_OFFSET = GLOBAL_OFFSET + N_GLOBAL;
export const N_REPERTOIRE = 2 * 6 * 64;
export const N_FEATURES = REPERTOIRE_OFFSET + N_REPERTOIRE;

// Index of each feature by name: P.capture is its place inside a phase block
// (add phase * N_PHASE), G.pawn_lever its place in the weight vector.
const P = Object.freeze(Object.fromEntries(PHASE_FEATURES.map((name, i) => [name, i])));
const G = Object.freeze(Object.fromEntries(GLOBAL_FEATURES.map((name, i) => [name, GLOBAL_OFFSET + i])));

/** Place of the two engine features inside a phase block. */
export const ENGINE_LOSS = P.engine_loss;
export const ENGINE_BEST = P.engine_best;

const FEATURE_NAMES = [];
for (const phase of PHASES) {
  for (const name of PHASE_FEATURES) FEATURE_NAMES.push(`${phase}:${name}`);
}
FEATURE_NAMES.push(...GLOBAL_FEATURES);
for (const colour of ['white', 'black']) {
  for (const piece of 'PNBRQK') {
    for (let sq = 0; sq < 64; sq++) FEATURE_NAMES.push(`repertoire:${colour}:${piece}${SQUARE_NAMES[sq]}`);
  }
}
const FEATURE_INDEX = new Map(FEATURE_NAMES.map((name, i) => [name, i]));

/** Name of every weight, in order (for inspection of a trained model). */
export function featureNames() {
  return FEATURE_NAMES.slice();
}

/** 0 = opening, 1 = middlegame, 2 = endgame. */
export function gamePhase(position) {
  if (position.fullmoveNumber <= OPENING_MOVES) return 0;
  const minorsAndRooks = popcount(position.knights | position.bishops | position.rooks);
  if (position.queens === 0n || minorsAndRooks <= 4) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const VALUE = [0, 1, 3, 3, 5, 9, 0];   // by piece type, in pawns

// 0 on the edge of the board, rising to 9 / 12.25 on the four centre squares.
const CENTRALITY = Array.from({ length: 64 }, (_, sq) =>
  (3.5 - Math.abs((sq & 7) - 3.5)) * (3.5 - Math.abs((sq >> 3) - 3.5)) / 12.25);

const LONG_DIAGONALS = bbRay(parseSquare('a1'), parseSquare('h8')) | bbRay(parseSquare('h1'), parseSquare('a8'));
const FIANCHETTO = BB_SQUARES[parseSquare('b2')] | BB_SQUARES[parseSquare('g2')]
  | BB_SQUARES[parseSquare('b7')] | BB_SQUARES[parseSquare('g7')];
const RIM = BB_FILES[0] | BB_FILES[7];
const NOT_FILE_A = BB_ALL ^ BB_FILES[0];
const NOT_FILE_H = BB_ALL ^ BB_FILES[7];

// For a piece of each colour (0 Black, 1 White - the index BB_PAWN_ATTACKS
// takes) on each square, the squares in front of it:
const AHEAD = [[], []];         // on its own and the neighbouring files
const ATTACK_SPAN = [[], []];   // on the neighbouring files only: from where an enemy pawn could ever attack the square
for (let sq = 0; sq < 64; sq++) {
  const file = sq & 7, rank = sq >> 3;
  const adjacent = (file > 0 ? BB_FILES[file - 1] : 0n) | (file < 7 ? BB_FILES[file + 1] : 0n);
  let up = 0n, down = 0n;
  for (let r = rank + 1; r < 8; r++) up |= BB_RANKS[r];
  for (let r = 0; r < rank; r++) down |= BB_RANKS[r];
  AHEAD[1][sq] = (adjacent | BB_FILES[file]) & up;
  AHEAD[0][sq] = (adjacent | BB_FILES[file]) & down;
  ATTACK_SPAN[1][sq] = adjacent & up;
  ATTACK_SPAN[0][sq] = adjacent & down;
}

/**
 * The squares a piece of that type attacks from `sq` when the squares of
 * `occupied` hold pieces. `turn` is its colour, which matters for a pawn.
 */
function attacksFrom(pieceType, sq, occupied, turn) {
  switch (pieceType) {
    case PAWN: return BB_PAWN_ATTACKS[turn ? 1 : 0][sq];
    case KNIGHT: return BB_KNIGHT_ATTACKS[sq];
    case KING: return BB_KING_ATTACKS[sq];
    case BISHOP: return bishopAttacks(sq, occupied);
    case ROOK: return rookAttacks(sq, occupied);
    default: return bishopAttacks(sq, occupied) | rookAttacks(sq, occupied);   // the queen
  }
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/**
 * Everything about a position that is shared by all of its moves.
 *
 *   position, turn                 the position and the side to move in it
 *   phase, opening                 gamePhase(), and whether the opening repertoire applies
 *   own, them, occupied            bitboards: the mover's pieces, the opponent's, both
 *   ownPawns, enemyPawns           bitboards
 *   enemyPawnAttacks               bitboard of the squares the opponent's pawns attack
 *   ownKing, enemyKing             squares
 *   homeRank                       the mover's first rank: 0 for White, 7 for Black
 *   lastTo                         the square the opponent has just moved to, -1 without a move history
 *   checkSquares[pieceType]        bitboard of the squares from which such a piece would give check
 *   discoverers                    bitboard of the mover's pieces that shield the enemy king from a line piece
 */
export class PositionContext {
  /** @param position  a rules.js Position. It must not be moved on while the context is in use. */
  constructor(position) {
    this.position = position;
    const turn = this.turn = position.turn;
    this.phase = gamePhase(position);
    this.opening = position.fullmoveNumber <= OPENING_MOVES;
    const own = this.own = position.occupiedCo(turn);
    const them = this.them = position.occupiedCo(!turn);
    const occupied = this.occupied = position.occupied;
    this.ownPawns = position.pawns & own;
    const enemyPawns = this.enemyPawns = position.pawns & them;
    // Every square an enemy pawn attacks. Black's pawns attack down the board, White's up.
    this.enemyPawnAttacks = turn
      ? ((enemyPawns >> 7n) & NOT_FILE_A) | ((enemyPawns >> 9n) & NOT_FILE_H)
      : (((enemyPawns << 7n) & NOT_FILE_H) | ((enemyPawns << 9n) & NOT_FILE_A)) & BB_ALL;
    const king = this.enemyKing = position.king(!turn);
    if (king === null) throw new Error(`No ${turn ? 'black' : 'white'} king on the board: ${position.fen()}`);
    const ownKing = position.king(turn);
    this.ownKing = ownKing === null ? -1 : ownKing;
    const played = position.moveStack;
    this.lastTo = played.length > 0 ? played[played.length - 1].to : -1;
    this.homeRank = turn ? 0 : 7;
    this.attackedCache = new Map();   // what escapesAttack() answered, by square

    // Squares from which each piece type would give check: where a piece of
    // that type standing on the enemy king's square would attack.
    const diagonal = bishopAttacks(king, occupied);
    const straight = rookAttacks(king, occupied);
    this.checkSquares = [0n, BB_PAWN_ATTACKS[turn ? 0 : 1][king], BB_KNIGHT_ATTACKS[king],
      diagonal, straight, diagonal | straight, 0n];

    // The mover's bishops, rooks and queens on a line with the enemy king
    // ("snipers"). An own piece standing alone between one of them and the
    // king discovers check when it leaves that line.
    const snipers = ((bishopAttacks(king, 0n) & (position.bishops | position.queens))
      | (rookAttacks(king, 0n) & (position.rooks | position.queens))) & own;
    let discoverers = 0n;
    for (const sniper of bbSquares(snipers)) {
      const between = bbBetween(king, sniper) & occupied;
      if (between !== 0n && (between & (between - 1n)) === 0n) discoverers |= between;   // exactly one piece
    }
    this.discoverers = discoverers & own;
  }

  /** Is the piece on `from` attacked by something cheaper, or loose and attacked? */
  escapesAttack(from, pieceType) {
    const cached = this.attackedCache.get(from);
    if (cached !== undefined) return cached;
    const position = this.position;
    const attackers = position.attackersMask(!this.turn, from);
    let result = false;
    if (attackers !== 0n) {
      const value = VALUE[pieceType];
      if (((attackers & position.pawns) !== 0n && value > 1)
          || ((attackers & (position.knights | position.bishops)) !== 0n && value > 3)
          || ((attackers & position.rooks) !== 0n && value > 5)) {
        result = true;    // attacked by something cheaper
      } else if (pieceType !== KING && position.attackersMask(this.turn, from) === 0n) {
        result = true;    // attacked and without a protector
      }
    }
    this.attackedCache.set(from, result);
    return result;
  }
}

/**
 * Sparse style features of one legal move: [[weight index, value], ...].
 *
 * The two engine features (`engine_loss`, `engine_best`) are not included;
 * the caller adds them once the engine has scored the move.
 *
 * @param {PositionContext} ctx  the context of the position the move is played in
 * @param move                   a legal Move of that position
 */
export function moveFeatures(ctx, move) {
  const position = ctx.position;
  const turn = ctx.turn;
  const us = turn ? 1 : 0;   // the mover's colour as a table index
  const from = move.from, to = move.to;
  const fromBB = BB_SQUARES[from], toBB = BB_SQUARES[to];
  const piece = position.pieceTypeAt(from);
  const base = ctx.phase * N_PHASE;
  const feats = [[base + piece - 1, 1]];   // piece_pawn .. piece_king
  const add = (index, value = 1) => {
    feats.push([index, value]);
  };

  const fromRank = from >> 3, toRank = to >> 3;
  const toFile = to & 7;
  const forward = turn ? toRank - fromRank : fromRank - toRank;
  const castling = piece === KING && Math.abs(from - to) === 2;
  const enPassant = piece === PAWN && to === position.epSquare && (ctx.occupied & toBB) === 0n;
  const capture = (ctx.them & toBB) !== 0n || enPassant;
  const victim = enPassant ? PAWN : (capture ? position.pieceTypeAt(to) : 0);

  // ---- phase-dependent features
  if (capture) {
    add(base + P.capture);
    add(base + P.capture_value, VALUE[victim] / 9);
    if (to === ctx.lastTo) add(base + P.recapture);
    if (VALUE[victim] === VALUE[piece]) add(base + P.even_trade);
  }

  // The board as the moved piece sees it, and what it attacks from its new
  // square (a promoting pawn still counts as the pawn; the king is not asked).
  const occupiedAfter = (ctx.occupied ^ fromBB) | toBB;
  const attacks = piece === KING ? 0n : attacksFrom(piece, to, occupiedAfter, turn);

  let check;
  if (move.promotion || castling || enPassant) {
    check = position.givesCheck(move);
  } else if ((fromBB & ctx.discoverers) !== 0n && (bbRay(from, ctx.enemyKing) & toBB) === 0n) {
    check = true;    // discovered: the piece leaves the line between a slider and the king
  } else if (piece === BISHOP || piece === ROOK || piece === QUEEN) {
    // A slider's checking squares must be recomputed once it has moved off its line.
    check = (attacks & BB_SQUARES[ctx.enemyKing]) !== 0n;
  } else {
    check = (ctx.checkSquares[piece] & toBB) !== 0n;
  }
  if (check) add(base + P.check);

  if (forward !== 0) {
    add(base + P.forward, forward / 7);
    if (forward < 0 && piece !== PAWN) add(base + P.retreat);
  }
  const centreTo = CENTRALITY[to], centreFrom = CENTRALITY[from];
  add(base + P.to_centre, centreTo);
  if (centreTo !== centreFrom) add(base + P.centre_gain, centreTo - centreFrom);
  const nearTo = (7 - squareDistance(to, ctx.enemyKing)) / 7;
  const nearFrom = (7 - squareDistance(from, ctx.enemyKing)) / 7;
  add(base + P.near_enemy_king, nearTo);
  if (nearTo !== nearFrom) add(base + P.king_approach, nearTo - nearFrom);

  const escapes = ctx.escapesAttack(from, piece);
  if (escapes) add(base + P.escapes_attack);
  if (piece !== PAWN && (ctx.enemyPawnAttacks & toBB) !== 0n) add(base + P.into_pawn_attack);
  if ((position.attackersMask(turn, to) & ~fromBB) !== 0n) add(base + P.to_defended);

  // creates_threat: something attacked from the new square is worth more than
  // the piece, or has no protector. (Kings neither make threats nor count as targets.)
  let threat = false;
  if (piece !== KING) {
    const targets = attacks & ctx.them & ~toBB & ~position.kings;
    const value = VALUE[piece];
    for (const target of bbSquares(targets)) {
      if (VALUE[position.pieceTypeAt(target)] > value || position.attackersMask(!turn, target) === 0n) {
        threat = true;
        break;
      }
    }
  }
  if (threat) add(base + P.creates_threat);
  if (!(capture || check || threat || escapes || castling || move.promotion)) add(base + P.quiet_move);
  if (!castling && !move.promotion && position.see(move) < 0) add(base + P.sacrifice);

  // ---- whole-game features
  if (castling) add(toFile === 6 ? G.castle_kingside : G.castle_queenside);
  if (move.promotion) add(G.promotion);

  if (piece === PAWN) {
    if (!capture) {
      if (toFile === 3 || toFile === 4) add(G.pawn_centre_push);
      else if (toFile === 2 || toFile === 5) add(G.pawn_bishop_file_push);
      else add(G.pawn_flank_push);
      if (forward === 2) add(G.pawn_double_step);
    }
    if ((BB_PAWN_ATTACKS[us][to] & ctx.enemyPawns) !== 0n) add(G.pawn_lever);
    if ((AHEAD[us][to] & ctx.enemyPawns) === 0n) add(G.pawn_passed_push);
    const relativeRank = turn ? toRank : 7 - toRank;
    if (relativeRank >= 3 && Math.abs(toFile - (ctx.enemyKing & 7)) <= 1 && ctx.phase !== 2) add(G.pawn_storm);
    if (Math.abs((from & 7) - (ctx.ownKing & 7)) <= 1 && (ctx.ownKing >> 3) === ctx.homeRank) {
      add(G.pawn_shelter_push);
    }
  } else if (piece === KNIGHT) {
    if (fromRank === ctx.homeRank && toRank !== ctx.homeRank) add(G.knight_develops);
    if ((toBB & RIM) !== 0n) add(G.knight_to_rim);
    const relativeRank = turn ? toRank : 7 - toRank;
    if (relativeRank >= 3 && relativeRank <= 5
        && (BB_PAWN_ATTACKS[1 - us][to] & ctx.ownPawns) !== 0n       // an own pawn protects the square
        && (ATTACK_SPAN[us][to] & ctx.enemyPawns) === 0n) {          // and no enemy pawn can ever attack it
      add(G.knight_outpost);
    }
    if (capture && victim === BISHOP) add(G.knight_takes_bishop);
  } else if (piece === BISHOP) {
    if (fromRank === ctx.homeRank && toRank !== ctx.homeRank) add(G.bishop_develops);
    if ((toBB & FIANCHETTO) !== 0n) add(G.bishop_fianchetto);
    if ((toBB & LONG_DIAGONALS) !== 0n) add(G.bishop_long_diagonal);
    if (capture && victim === KNIGHT) add(G.bishop_takes_knight);
  } else if (piece === ROOK) {
    const fileBB = BB_FILES[toFile];
    if ((from & 7) !== toFile && (ctx.ownPawns & fileBB) === 0n) {
      add((ctx.enemyPawns & fileBB) !== 0n ? G.rook_semi_open_file : G.rook_open_file);
    }
    if ((turn ? toRank : 7 - toRank) === 6 && fromRank !== toRank) add(G.rook_seventh_rank);
  } else if (piece === QUEEN) {
    if (ctx.opening) add(G.queen_early);
    if (capture && victim === QUEEN) add(G.queen_trade);
  } else if (!castling) {
    if (ctx.phase === 2) {
      if (centreTo > centreFrom) add(G.king_to_centre_endgame);
    } else {
      add(G.king_walk);
    }
  }

  // ---- opening repertoire: where this piece goes in the first moves
  if (ctx.opening) {
    const square = turn ? to : to ^ 56;   // Black's squares are mirrored: his g7 counts as g2
    add(REPERTOIRE_OFFSET + (turn ? 0 : 384) + (piece - 1) * 64 + square);
  }
  return feats;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * weight . features, added up exactly as the Python model does it with
 * `sum(w[i] * v for i, v in features)`: in the order of the list, and - as
 * sum() does for floats since Python 3.12 - carrying the rounding error of
 * every addition along (Neumaier's compensated summation). Repeating that
 * here makes the scores equal to the reference to the last bit.
 */
function weightedSum(weights, features) {
  let total = 0, correction = 0;
  for (let k = 0; k < features.length; k++) {
    const term = weights[features[k][0]] * features[k][1];
    const next = total + term;
    correction += Math.abs(total) >= Math.abs(term) ? (total - next) + term : (term - next) + total;
    total = next;
  }
  if (correction !== 0 && Number.isFinite(correction)) total += correction;
  return total;
}

function sameList(list, expected) {
  return Array.isArray(list) && list.length === expected.length && list.every((item, i) => item === expected[i]);
}

/** Linear conditional-logit scorer over move features. */
export class StyleModel {
  /**
   * @param weights   N_FEATURES numbers in the order of featureNames() (all zero if left out)
   * @param metadata  what the model file says about itself; `engine_preference` is used
   */
  constructor(weights = null, metadata = {}) {
    this.weights = weights == null ? new Array(N_FEATURES).fill(0) : Array.from(weights);
    if (this.weights.length !== N_FEATURES) {
      throw new Error(`Weight vector has ${this.weights.length} entries, expected ${N_FEATURES}`);
    }
    if (metadata == null) metadata = {};
    if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Model metadata is not a table');
    this.metadata = metadata;
    /** Extra reluctance to leave the engine's first choice (chosen by cross-validation). */
    this.enginePreference = 0;
    if (metadata.engine_preference !== undefined) {
      if (typeof metadata.engine_preference !== 'number') throw new Error('engine_preference is not a number');
      this.enginePreference = metadata.engine_preference;
    }
  }

  /**
   * The model in a parsed model file (web/static/data/style.json, the format
   * StyleModel.save writes in Python). Throws if the file was written for
   * another version of the features.
   */
  static fromJSON(payload) {
    if (payload === null || typeof payload !== 'object'
        || payload.format !== 2
        || !sameList(payload.phase_features, PHASE_FEATURES)
        || !sameList(payload.global_features, GLOBAL_FEATURES)) {
      throw new Error('Model file feature set does not match this code version');
    }
    const weights = new Array(N_FEATURES).fill(0);
    for (const block of ['weights', 'repertoire']) {   // the repertoire block is sparse: only the squares visited
      if (payload[block] === undefined) continue;
      if (payload[block] === null || typeof payload[block] !== 'object' || Array.isArray(payload[block])) {
        throw new Error(`Model file: '${block}' is not a table of weights by name`);
      }
      for (const [name, value] of Object.entries(payload[block])) {
        const index = FEATURE_INDEX.get(name);
        if (index === undefined) throw new Error(`Model file: unknown feature '${name}'`);
        if (typeof value !== 'number') throw new Error(`Model file: the weight of '${name}' is not a number`);
        weights[index] = value;
      }
    }
    return new StyleModel(weights, payload.metadata);
  }

  // ------------------------------------------------------------- scoring

  /**
   * { move, score } for every legal move, most Fischer-like first.
   *
   * Engine features are left out: this is pure stylistic preference.
   * Moves with equal scores stay in the order legalMoves() gave them.
   *
   * @param position  a rules.js Position; one that knows the moves played so
   *                  far (Position.fromMoves), or `recapture` cannot be seen
   */
  styleScores(position) {
    const ctx = new PositionContext(position);
    const weights = this.weights;
    const scored = [];
    for (const move of position.legalMoves()) {
      scored.push({ move, score: weightedSum(weights, moveFeatures(ctx, move)) });
    }
    // Best first; exact ties in UCI order, as fischerbot/style.py does, so the
    // ranking does not depend on the order the moves were generated in.
    for (const entry of scored) entry.uci = entry.move.uci();
    scored.sort((a, b) => (a.score < b.score ? 1 : a.score > b.score ? -1 : a.uci < b.uci ? -1 : a.uci > b.uci ? 1 : 0));
    for (const entry of scored) delete entry.uci;
    return scored;
  }

  /** { move, probability } for every legal move by style alone, most likely first. */
  rankMoves(position) {
    const scored = this.styleScores(position);
    if (scored.length === 0) return [];
    const peak = scored[0].score;
    const exps = scored.map(({ score }) => Math.exp(score - peak));
    let total = 0;
    for (const e of exps) total += e;
    return scored.map(({ move }, k) => ({ move, probability: exps[k] / total }));
  }

  /**
   * Centipawns the bot may give up for a move that is `styleGain` more Fischer-like.
   *
   * Derived from the learned weights: a move replaces the engine's first
   * choice when  styleGain + engine_loss weight * loss / 100  exceeds the
   * engine_best weight plus `enginePreference`. Returns -1 when the gain is
   * not worth a switch at any price (and Infinity for a model in which losing
   * centipawns costs nothing).
   *
   * @param phase      0, 1 or 2: see gamePhase()
   * @param styleGain  style score of the move minus that of the engine's choice
   */
  allowedLoss(phase, styleGain) {
    const base = phase * N_PHASE;
    const lossWeight = this.weights[base + ENGINE_LOSS];   // negative: losing centipawns is bad
    const bestBonus = this.weights[base + ENGINE_BEST] + this.enginePreference;
    const margin = styleGain - bestBonus;
    if (margin <= 0) return -1;   // not Fischer-like enough to displace the engine's choice
    if (lossWeight >= -1e-9) return Infinity;
    return 100 * margin / -lossWeight;
  }
}
