// rules.js - the rules of chess for the browser side of FischerBot.
//
// A small, exact rules library. The UI, the opening book and the style
// features are all written against it; the search engine has its own, faster
// board and does not use this file.
//
// Conventions
//   squares      integers 0..63: a1 = 0, h1 = 7, a8 = 56, h8 = 63
//                (file = sq & 7, rank = sq >> 3)
//   colours      booleans: WHITE = true, BLACK = false
//   piece types  PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6
//   moves        Move { from, to, promotion }. Castling is the king's move of
//                two files: e1g1, e1c1, e8g8, e8c8.
//   bitboards    BigInt, bit i = square i
//
// How it is built
//   A Position keeps the board as an array of 64 piece codes. Generating
//   moves, testing legality and making or taking back a move are plain
//   integer code over that array. The BigInt bitboards of the public API
//   (pawns, occupied, attackersMask, ...) are a view derived from the array
//   when first asked for and kept until the next move.
//
// This is original code. Its behaviour is checked against python-chess, which
// produced the reference answers in web/tests/fixtures/rules.json.gz.

// ---------------------------------------------------------------------------
// Colours, pieces, squares
// ---------------------------------------------------------------------------

export const WHITE = true;
export const BLACK = false;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILE_NAMES = 'abcdefgh';

/** The name of every square by index: 'a1', 'b1', ..., 'h8'. */
export const SQUARE_NAMES = Object.freeze(
  Array.from({ length: 64 }, (_, sq) => FILE_NAMES[sq & 7] + ((sq >> 3) + 1)));

/** File of a square, 0 (the a-file) to 7 (the h-file). */
export function squareFile(sq) {
  return sq & 7;
}

/** Rank of a square, 0 (the first rank) to 7 (the eighth). */
export function squareRank(sq) {
  return sq >> 3;
}

/** Index of the square called `name` ('e4' -> 28). Throws if there is no such square. */
export function parseSquare(name) {
  if (typeof name === 'string' && name.length === 2) {
    const file = name.charCodeAt(0) - 97;   // 'a'
    const rank = name.charCodeAt(1) - 49;   // '1'
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) return rank * 8 + file;
  }
  throw new Error(`Invalid square name: '${name}'`);
}

/** Number of king moves between two squares (Chebyshev distance). */
export function squareDistance(a, b) {
  return Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));
}

// Inside this file a colour is an index - 0 for Black, 1 for White, the same
// index BB_PAWN_ATTACKS takes - and a piece on the board is a small integer:
// the bit of its colour plus its type. An empty square is 0.
const BLACK_BIT = 8;    // 8 << 0
const WHITE_BIT = 16;   // 8 << 1
const TYPE_MASK = 7;

const A1 = 0, E1 = 4, H1 = 7, A8 = 56, E8 = 60, H8 = 63;

const PIECE_LETTERS = ['', 'p', 'n', 'b', 'r', 'q', 'k'];   // by piece type, as in UCI and FEN
const SAN_LETTERS = ['', '', 'N', 'B', 'R', 'Q', 'K'];      // by piece type; pawns have none

// FEN symbol of every piece code ('P' for a white pawn, 'p' for a black one), and back.
const SYMBOL_OF_PIECE = [];
const PIECE_OF_SYMBOL = new Map();
for (let type = PAWN; type <= KING; type++) {
  SYMBOL_OF_PIECE[BLACK_BIT | type] = PIECE_LETTERS[type];
  SYMBOL_OF_PIECE[WHITE_BIT | type] = PIECE_LETTERS[type].toUpperCase();
  PIECE_OF_SYMBOL.set(PIECE_LETTERS[type], BLACK_BIT | type);
  PIECE_OF_SYMBOL.set(PIECE_LETTERS[type].toUpperCase(), WHITE_BIT | type);
}

// ---------------------------------------------------------------------------
// Where the pieces can go: step and ray tables
// ---------------------------------------------------------------------------

/** The squares reached from `sq` by each [file, rank] step that stays on the board. */
function stepsFrom(sq, deltas) {
  const squares = [];
  for (const [df, dr] of deltas) {
    const file = (sq & 7) + df, rank = (sq >> 3) + dr;
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) squares.push(rank * 8 + file);
  }
  return squares;
}

/** The squares passed when sliding from `sq` in direction [df, dr], nearest first. */
function rayFrom(sq, [df, dr]) {
  const squares = [];
  let file = (sq & 7) + df, rank = (sq >> 3) + dr;
  while (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
    squares.push(rank * 8 + file);
    file += df;
    rank += dr;
  }
  return squares;
}

const ALL_SQUARES = Array.from({ length: 64 }, (_, sq) => sq);

const KNIGHT_STEPS = ALL_SQUARES.map(sq => stepsFrom(sq,
  [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]));

const KING_STEPS = ALL_SQUARES.map(sq => stepsFrom(sq,
  [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]]));

// PAWN_CAPTURES[colour][sq]: the squares a pawn of that colour on sq attacks.
// Read the other way round, PAWN_CAPTURES[colour][sq] are also the squares
// from which a pawn of the *other* colour attacks sq.
const PAWN_CAPTURES = [
  ALL_SQUARES.map(sq => stepsFrom(sq, [[-1, -1], [1, -1]])),   // Black's pawns capture down the board
  ALL_SQUARES.map(sq => stepsFrom(sq, [[-1, 1], [1, 1]])),     // White's capture up the board
];

// RAYS[sq][direction]: directions 0-3 are the rook's, 4-7 the bishop's, and
// direction ^ 1 is the opposite of direction.
const DIRECTIONS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]];
const ROOK_FIRST = 0, ROOK_LAST = 3, BISHOP_FIRST = 4, BISHOP_LAST = 7;
const RAYS = ALL_SQUARES.map(sq => DIRECTIONS.map(direction => rayFrom(sq, direction)));

// ---------------------------------------------------------------------------
// Bitboard helpers (BigInt; bit i = square i)
// ---------------------------------------------------------------------------

export const BB_ALL = 0xFFFF_FFFF_FFFF_FFFFn;

/** BB_SQUARES[sq]: the bitboard with only that square. */
export const BB_SQUARES = Object.freeze(ALL_SQUARES.map(sq => 1n << BigInt(sq)));

/** BB_FILES[0] is the a-file, BB_FILES[7] the h-file. */
export const BB_FILES = Object.freeze(
  Array.from({ length: 8 }, (_, file) => 0x0101_0101_0101_0101n << BigInt(file)));

/** BB_RANKS[0] is the first rank, BB_RANKS[7] the eighth. */
export const BB_RANKS = Object.freeze(
  Array.from({ length: 8 }, (_, rank) => 0xFFn << BigInt(8 * rank)));

const BB_DARK_SQUARES = 0xAA55_AA55_AA55_AA55n;    // a1, c1, ..., h8
const BB_LIGHT_SQUARES = 0x55AA_55AA_55AA_55AAn;

function maskOf(squares) {
  let bb = 0n;
  for (const sq of squares) bb |= BB_SQUARES[sq];
  return bb;
}

/** BB_KNIGHT_ATTACKS[sq]: the squares a knight on sq attacks. */
export const BB_KNIGHT_ATTACKS = Object.freeze(KNIGHT_STEPS.map(maskOf));

/** BB_KING_ATTACKS[sq]: the squares a king on sq attacks. */
export const BB_KING_ATTACKS = Object.freeze(KING_STEPS.map(maskOf));

/** BB_PAWN_ATTACKS[color ? 1 : 0][sq]: the squares a pawn of that colour on sq attacks. */
export const BB_PAWN_ATTACKS = Object.freeze(
  PAWN_CAPTURES.map(table => Object.freeze(table.map(maskOf))));

// BigInt arithmetic allocates; 32-bit integer arithmetic does not. Whatever
// has to look at the single bits of a bitboard therefore writes it into this
// scratch word and works on its two halves: squares 0-31 and squares 32-63.
// (Writing also truncates to 64 bits, so `~bb` is handled like any other value.)
const WORD = new BigUint64Array(1);
const HALVES = new Uint32Array(WORD.buffer);
WORD[0] = 1n;
const LOW = HALVES[0] === 1 ? 0 : 1;   // which half comes first depends on the machine's byte order
const HIGH = 1 - LOW;

function joinHalves(low, high) {
  HALVES[LOW] = low;
  HALVES[HIGH] = high;
  return WORD[0];
}

function popcount32(n) {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return Math.imul((n + (n >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
}

/** Number of squares in a bitboard. */
export function popcount(bb) {
  WORD[0] = bb;
  return popcount32(HALVES[0]) + popcount32(HALVES[1]);
}

/** The squares of a bitboard as integers, ascending. */
export function bbSquares(bb) {
  WORD[0] = bb;
  const high = HALVES[HIGH] | 0;
  const squares = [];
  for (let bits = HALVES[LOW] | 0; bits !== 0; bits &= bits - 1) squares.push(31 - Math.clz32(bits & -bits));
  for (let bits = high; bits !== 0; bits &= bits - 1) squares.push(63 - Math.clz32(bits & -bits));
  return squares;
}

/** Slide from `sq` along the given range of directions until something in `occupied` is hit (and included). */
function slidingAttacks(sq, occupied, firstDirection, lastDirection) {
  WORD[0] = occupied;
  const occupiedLow = HALVES[LOW], occupiedHigh = HALVES[HIGH];
  const rays = RAYS[sq];
  let low = 0, high = 0;
  for (let direction = firstDirection; direction <= lastDirection; direction++) {
    const ray = rays[direction];
    for (let i = 0; i < ray.length; i++) {
      const target = ray[i];
      const bit = 1 << target;   // shift counts wrap at 32: the right bit of whichever half
      if (target < 32) {
        low |= bit;
        if (occupiedLow & bit) break;
      } else {
        high |= bit;
        if (occupiedHigh & bit) break;
      }
    }
  }
  return joinHalves(low, high);
}

/** The squares a rook on `sq` attacks when the squares of `occupied` hold pieces (the first piece in each direction is included). */
export function rookAttacks(sq, occupied) {
  return slidingAttacks(sq, occupied, ROOK_FIRST, ROOK_LAST);
}

/** The squares a bishop on `sq` attacks when the squares of `occupied` hold pieces (the first piece in each direction is included). */
export function bishopAttacks(sq, occupied) {
  return slidingAttacks(sq, occupied, BISHOP_FIRST, BISHOP_LAST);
}

// For every pair of squares on a common rank, file or diagonal: the squares
// strictly between them and the whole line through them. 0n for other pairs.
const BETWEEN = new Array(64 * 64).fill(0n);
const LINES = new Array(64 * 64).fill(0n);
for (const sq of ALL_SQUARES) {
  for (let direction = 0; direction < 8; direction++) {
    const ray = RAYS[sq][direction];
    const line = BB_SQUARES[sq] | maskOf(ray) | maskOf(RAYS[sq][direction ^ 1]);
    let passed = 0n;
    for (const target of ray) {
      BETWEEN[sq * 64 + target] = passed;
      LINES[sq * 64 + target] = line;
      passed |= BB_SQUARES[target];
    }
  }
}

/** The squares strictly between two squares on a common rank, file or diagonal; 0n for any other pair. */
export function bbBetween(a, b) {
  return BETWEEN[a * 64 + b];
}

/** The whole line (edge to edge, both squares included) through two squares on a common rank, file or diagonal; 0n for any other pair. */
export function bbRay(a, b) {
  return LINES[a * 64 + b];
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

const UCI_PATTERN = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/;

export class Move {
  /**
   * @param {number} from       origin square
   * @param {number} to         destination square
   * @param {number} promotion  piece type a pawn promotes to, or 0
   */
  constructor(from, to, promotion = 0) {
    this.from = from;
    this.to = to;
    this.promotion = promotion || 0;
  }

  /** The move in UCI notation: 'e2e4', 'e7e8q'. */
  uci() {
    return SQUARE_NAMES[this.from] + SQUARE_NAMES[this.to] + PIECE_LETTERS[this.promotion];
  }

  /** Reads a UCI move string. Only the syntax is checked; throws if it is malformed. */
  static fromUci(uci) {
    const match = typeof uci === 'string' ? UCI_PATTERN.exec(uci) : null;
    if (!match || match[1] === match[2]) throw new Error(`Invalid UCI move: '${uci}'`);
    return new Move(parseSquare(match[1]), parseSquare(match[2]), match[3] ? PIECE_LETTERS.indexOf(match[3]) : 0);
  }

  equals(other) {
    return other != null && this.from === other.from && this.to === other.to
      && this.promotion === (other.promotion || 0);
  }

  toString() {
    return this.uci();
  }
}

function addPawnMove(moves, from, to, promotes) {
  if (promotes) {
    moves.push(new Move(from, to, QUEEN), new Move(from, to, ROOK), new Move(from, to, BISHOP), new Move(from, to, KNIGHT));
  } else {
    moves.push(new Move(from, to));
  }
}

// ---------------------------------------------------------------------------
// Castling rights
// ---------------------------------------------------------------------------

// Four bits inside a Position. The public `castlingRights` shows them the way
// the style features expect: as the bitboard of the rooks that may still castle.
const WHITE_KINGSIDE = 1, WHITE_QUEENSIDE = 2, BLACK_KINGSIDE = 4, BLACK_QUEENSIDE = 8;

const CASTLING = [
  { right: WHITE_KINGSIDE, symbol: 'K', color: 1, king: E1, rook: H1 },
  { right: WHITE_QUEENSIDE, symbol: 'Q', color: 1, king: E1, rook: A1 },
  { right: BLACK_KINGSIDE, symbol: 'k', color: 0, king: E8, rook: H8 },
  { right: BLACK_QUEENSIDE, symbol: 'q', color: 0, king: E8, rook: A8 },
];

// CASTLING_KEPT[sq]: the rights that survive a move from or to sq. Moving the
// king or a rook loses rights, and so does capturing a rook on its corner.
const CASTLING_KEPT = new Uint8Array(64).fill(15);
for (const { right, king, rook } of CASTLING) {
  CASTLING_KEPT[king] &= ~right;
  CASTLING_KEPT[rook] &= ~right;
}

// By the four bits: the FEN field ('KQkq', 'Kq', '-') and the rook bitboard.
const CASTLING_FEN = [];
const CASTLING_MASK = [];
for (let rights = 0; rights < 16; rights++) {
  const held = CASTLING.filter(({ right }) => rights & right);
  CASTLING_FEN[rights] = held.map(({ symbol }) => symbol).join('') || '-';
  CASTLING_MASK[rights] = maskOf(held.map(({ rook }) => rook));
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

// ALIGNED[a * 64 + b] is 1 when two different squares share a rank, file or
// diagonal. A piece that is not aligned with its king cannot be pinned.
const ALIGNED = new Uint8Array(64 * 64);
for (const sq of ALL_SQUARES) {
  for (const ray of RAYS[sq]) {
    for (const target of ray) ALIGNED[sq * 64 + target] = 1;
  }
}

// Slots of the cached bitboard view (see Position._view): piece types 1-6, then:
const VIEW_BLACK = 7, VIEW_WHITE = 8, VIEW_OCCUPIED = 9;
const VIEW_HALVES = new Int32Array(2 * VIEW_OCCUPIED);

// Piece values of the exchange evaluation, by piece type (see Position.see).
const SEE_VALUES = [0, 100, 320, 330, 500, 950, 20000];

const SAN_PATTERN = /^([NBRQK])?([a-h])?([1-8])?[x-]?([a-h][1-8])(?:=?([NBRQnbrq]))?[+#]?$/;
const SAN_CASTLING_PATTERN = /^(O-O-O|0-0-0|O-O|0-0)[+#]?$/;

const NO_SETUP = Symbol('no setup');   // tells the constructor that copy() will fill in the fields

export class Position {
  /**
   * Public state (read it freely; change it only through push and pop):
   *
   *   turn             side to move, WHITE or BLACK
   *   epSquare         the square behind a pawn that has just advanced two, else null
   *                    (set after every double step, whether or not a capture is possible)
   *   halfmoveClock    half-moves since the last capture or pawn move
   *   fullmoveNumber   starts at 1 and goes up after each move of Black's
   *   moveStack        the Moves played since construction
   *   castlingRights   bitboard of the rooks that may still castle (a1, h1, a8, h8)
   *
   * @param {string} fen  the position in Forsyth-Edwards Notation. Trailing fields may be
   *                      left out (so an EPD will do); they default to `w - - 0 1`.
   */
  constructor(fen = STARTING_FEN) {
    this._board = new Uint8Array(64);   // the piece code on every square
    this._castling = 0;                 // castling right bits
    this._undo = [];                    // for each move of moveStack, what pop() needs to take it back
    this._bitboards = null;             // cached BigInt view of _board, see _view()
    this.turn = WHITE;
    this.epSquare = null;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.moveStack = [];
    if (fen !== NO_SETUP) this._setFen(fen);
  }

  /** The position after playing the given UCI moves from `fen`. Throws on an illegal move. */
  static fromMoves(uciList, fen = STARTING_FEN) {
    const position = new Position(fen);
    for (const uci of uciList) position.push(position.parseUci(uci));
    return position;
  }

  /** An independent copy, history included. */
  copy() {
    const twin = new Position(NO_SETUP);
    twin._board.set(this._board);
    twin._castling = this._castling;
    twin._undo = this._undo.slice();
    twin._bitboards = this._bitboards;   // never modified once built, so it can be shared
    twin.turn = this.turn;
    twin.epSquare = this.epSquare;
    twin.halfmoveClock = this.halfmoveClock;
    twin.fullmoveNumber = this.fullmoveNumber;
    twin.moveStack = this.moveStack.slice();
    return twin;
  }

  _setFen(fen) {
    if (typeof fen !== 'string') throw new TypeError(`A FEN must be a string, not ${typeof fen}`);
    const fail = reason => {
      throw new Error(`Invalid FEN (${reason}): '${fen}'`);
    };
    const fields = fen.trim().split(/\s+/);
    if (fields.length > 6) fail('more than six fields');
    const [placement, turn = 'w', castling = '-', enPassant = '-', halfmove = '0', fullmove = '1'] = fields;

    // 1. Piece placement, rank 8 first.
    const board = this._board;
    board.fill(0);
    const rows = placement.split('/');
    if (rows.length !== 8) fail('expected eight ranks');
    for (let row = 0; row < 8; row++) {
      const end = (8 - row) * 8;
      let sq = end - 8;
      for (const symbol of rows[row]) {
        if (symbol >= '1' && symbol <= '8') {
          sq += Number(symbol);
          continue;
        }
        const piece = PIECE_OF_SYMBOL.get(symbol);
        if (piece === undefined) fail(`unknown piece '${symbol}'`);
        if (sq >= end) fail(`rank ${8 - row} is too long`);
        board[sq] = piece;
        sq++;
      }
      if (sq !== end) fail(`rank ${8 - row} does not have eight squares`);
    }

    // 2. Side to move.
    if (turn !== 'w' && turn !== 'b') fail("the side to move must be 'w' or 'b'");
    this.turn = turn === 'w';

    // 3. Castling rights. A right only counts while the king and that rook
    //    still stand on their original squares.
    if (!/^(?:-|K?Q?k?q?)$/.test(castling)) fail('bad castling field');
    this._castling = 0;
    for (const { right, symbol, color, king, rook } of CASTLING) {
      if (castling.includes(symbol) && board[king] === ((8 << color) | KING) && board[rook] === ((8 << color) | ROOK)) {
        this._castling |= right;
      }
    }

    // 4. En-passant square. It is kept only if a pawn can really have just
    //    jumped over it: an enemy pawn in front, nothing on it or behind it.
    this.epSquare = null;
    if (enPassant !== '-') {
      const sq = SQUARE_NAMES.indexOf(enPassant);
      if (sq < 0) fail('bad en-passant square');
      const us = this.turn ? 1 : 0;
      const forward = us ? 8 : -8;
      if ((sq >> 3) === (us ? 5 : 2) && board[sq] === 0 && board[sq + forward] === 0
          && board[sq - forward] === ((8 << (1 - us)) | PAWN)) {
        this.epSquare = sq;
      }
    }

    // 5. Clocks.
    if (!/^\d+$/.test(halfmove)) fail('bad halfmove clock');
    if (!/^\d+$/.test(fullmove)) fail('bad fullmove number');
    this.halfmoveClock = Number(halfmove);
    this.fullmoveNumber = Math.max(1, Number(fullmove));

    this.moveStack = [];
    this._undo = [];
    this._bitboards = null;
  }

  // ------------------------------------------------------------- pieces

  /** Piece type on a square, 0 if it is empty. */
  pieceTypeAt(sq) {
    return this._board[sq] & TYPE_MASK;
  }

  /** Colour of the piece on a square (true for White, false for Black), null if it is empty. */
  colorAt(sq) {
    const piece = this._board[sq];
    return piece === 0 ? null : piece >= WHITE_BIT;
  }

  /** The square of that colour's king (null if the position has none). */
  king(color) {
    const sq = this._kingSquare(color ? 1 : 0);
    return sq < 0 ? null : sq;
  }

  /** The king's square by colour index, -1 if there is none. */
  _kingSquare(side) {
    return this._board.lastIndexOf((8 << side) | KING);
  }

  /**
   * The bitboards behind the getters below, built from the board array when
   * first needed after a move: [unused, pawns, knights, bishops, rooks, queens,
   * kings, Black's pieces, White's pieces, all pieces].
   */
  _view() {
    if (this._bitboards === null) {
      const board = this._board;
      const halves = VIEW_HALVES;
      halves.fill(0);
      for (let sq = 0; sq < 64; sq++) {
        const piece = board[sq];
        if (piece === 0) continue;
        const bit = 1 << sq;     // shift counts wrap at 32
        const half = sq >> 5;    // 0: squares 0-31, 1: squares 32-63
        halves[2 * (piece & TYPE_MASK) + half] |= bit;
        halves[2 * (VIEW_BLACK + (piece >> 4)) + half] |= bit;
      }
      const view = [0n];
      for (let slot = 1; slot <= VIEW_WHITE; slot++) view.push(joinHalves(halves[2 * slot], halves[2 * slot + 1]));
      view.push(view[VIEW_BLACK] | view[VIEW_WHITE]);
      this._bitboards = view;
    }
    return this._bitboards;
  }

  /** Bitboards of the pieces of each type, both colours together. */
  get pawns() { return this._view()[PAWN]; }
  get knights() { return this._view()[KNIGHT]; }
  get bishops() { return this._view()[BISHOP]; }
  get rooks() { return this._view()[ROOK]; }
  get queens() { return this._view()[QUEEN]; }
  get kings() { return this._view()[KING]; }

  /** Bitboard of all pieces. */
  get occupied() { return this._view()[VIEW_OCCUPIED]; }

  /** Bitboard of the pieces of one colour. */
  occupiedCo(color) {
    return this._view()[color ? VIEW_WHITE : VIEW_BLACK];
  }

  /** Bitboard of the rooks that may still castle: a subset of a1, h1, a8, h8. */
  get castlingRights() {
    return CASTLING_MASK[this._castling];
  }

  // ------------------------------------------------------------ attacks

  /** Bitboard of the squares attacked by the piece on `sq` (0n if the square is empty). */
  attacksMask(sq) {
    const piece = this._board[sq];
    switch (piece & TYPE_MASK) {
      case PAWN: return BB_PAWN_ATTACKS[piece >> 4][sq];
      case KNIGHT: return BB_KNIGHT_ATTACKS[sq];
      case BISHOP: return bishopAttacks(sq, this.occupied);
      case ROOK: return rookAttacks(sq, this.occupied);
      case QUEEN: return slidingAttacks(sq, this.occupied, ROOK_FIRST, BISHOP_LAST);
      case KING: return BB_KING_ATTACKS[sq];
      default: return 0n;
    }
  }

  /**
   * Bitboard of the pieces of `color` that attack `sq`. Pinned pieces count,
   * kings count, pawns attack diagonally. With `occupied` given, bishops, rooks
   * and queens see through every square that is absent from it (and are stopped
   * by every square in it); which pieces exist is still decided by the board.
   */
  attackersMask(color, sq, occupied = null) {
    const view = this._view();
    if (occupied === null) occupied = view[VIEW_OCCUPIED];
    const queens = view[QUEEN];
    return (
      (BB_KING_ATTACKS[sq] & view[KING])
      | (BB_KNIGHT_ATTACKS[sq] & view[KNIGHT])
      | (rookAttacks(sq, occupied) & (view[ROOK] | queens))
      | (bishopAttacks(sq, occupied) & (view[BISHOP] | queens))
      | (BB_PAWN_ATTACKS[color ? 0 : 1][sq] & view[PAWN])   // where a pawn of the other colour on sq would capture
    ) & view[color ? VIEW_WHITE : VIEW_BLACK];
  }

  /** The squares of the pieces of `color` that attack `sq`, ascending. */
  attackers(color, sq) {
    return bbSquares(this.attackersMask(color, sq));
  }

  /** Does any piece of `color` attack `sq`? */
  isAttackedBy(color, sq) {
    return this._isAttacked(sq, color ? 1 : 0);
  }

  /** Is the side to move in check? */
  isCheck() {
    const us = this.turn ? 1 : 0;
    const king = this._kingSquare(us);
    return king >= 0 && this._isAttacked(king, 1 - us);
  }

  /** The same question as isAttackedBy, answered on the board array (`by` is a colour index). */
  _isAttacked(sq, by) {
    const board = this._board;
    const color = 8 << by;

    const pawn = color | PAWN;
    const pawnSquares = PAWN_CAPTURES[1 - by][sq];
    for (let i = 0; i < pawnSquares.length; i++) {
      if (board[pawnSquares[i]] === pawn) return true;
    }
    const knight = color | KNIGHT;
    const knightSquares = KNIGHT_STEPS[sq];
    for (let i = 0; i < knightSquares.length; i++) {
      if (board[knightSquares[i]] === knight) return true;
    }
    const king = color | KING;
    const kingSquares = KING_STEPS[sq];
    for (let i = 0; i < kingSquares.length; i++) {
      if (board[kingSquares[i]] === king) return true;
    }
    // Along each line the first piece met decides.
    const queen = color | QUEEN;
    const rays = RAYS[sq];
    for (let direction = 0; direction < 8; direction++) {
      const slider = color | (direction <= ROOK_LAST ? ROOK : BISHOP);
      const ray = rays[direction];
      for (let i = 0; i < ray.length; i++) {
        const piece = board[ray[i]];
        if (piece === 0) continue;
        if (piece === slider || piece === queen) return true;
        break;
      }
    }
    return false;
  }

  // -------------------------------------------------------------- moves

  /** Every legal move, in no particular order. */
  legalMoves() {
    return this._legalMoves(-1);
  }

  /** Is this move legal here? */
  isLegal(move) {
    if (move == null || !(move.from >= 0 && move.from < 64)) return false;
    return this._legalMoves(move.from).some(legal => legal.equals(move));
  }

  /** The legal moves of the piece on `onlyFrom`, or of all pieces if it is -1. */
  _legalMoves(onlyFrom) {
    const board = this._board;
    const us = this.turn ? 1 : 0;
    const own = 8 << us;

    // Moves that obey how the pieces move, whatever happens to the king.
    const candidates = [];
    if (onlyFrom >= 0) {
      if (board[onlyFrom] & own) this._addMovesFrom(onlyFrom, candidates);
    } else {
      for (let from = 0; from < 64; from++) {
        if (board[from] & own) this._addMovesFrom(from, candidates);
      }
    }
    const king = this._kingSquare(us);
    if (king < 0) return candidates;   // no king to look after (hand-made positions only)

    // Keep those that leave the king safe. Without a check on the board only
    // three kinds of move can expose him and have to be tried out: a move of
    // the king himself, a move of a piece standing on a line with him (it may
    // be pinned) and an en-passant capture (it empties two squares at once).
    const inCheck = this._isAttacked(king, 1 - us);
    const ep = this.epSquare;
    const moves = [];
    for (let i = 0; i < candidates.length; i++) {
      const move = candidates[i];
      const from = move.from;
      const risky = inCheck || from === king || move.to === ep || ALIGNED[king * 64 + from] === 1;
      if (!risky || this._leavesKingSafe(from, move.to, king)) moves.push(move);
    }
    if (!inCheck && (onlyFrom < 0 || onlyFrom === king)) this._addCastling(moves);
    return moves;
  }

  /** Appends the moves of the piece on `from` that obey how it moves (castling apart; the king's safety is not looked at). */
  _addMovesFrom(from, moves) {
    const board = this._board;
    const piece = board[from];
    const us = piece >> 4;
    const own = 8 << us, enemy = 8 << (1 - us);
    const type = piece & TYPE_MASK;

    if (type === PAWN) {
      const rank = from >> 3;
      if (rank === (us ? 7 : 0)) return;   // a pawn on its last rank cannot arise in play and has no moves
      const forward = us ? 8 : -8;
      const promotes = rank === (us ? 6 : 1);
      const ahead = from + forward;
      if (board[ahead] === 0) {
        addPawnMove(moves, from, ahead, promotes);
        if (rank === (us ? 1 : 6) && board[ahead + forward] === 0) moves.push(new Move(from, ahead + forward));
      }
      const captures = PAWN_CAPTURES[us][from];
      for (let i = 0; i < captures.length; i++) {
        const to = captures[i];
        if ((board[to] & enemy) || to === this.epSquare) addPawnMove(moves, from, to, promotes);
      }
    } else if (type === KNIGHT || type === KING) {
      const targets = type === KNIGHT ? KNIGHT_STEPS[from] : KING_STEPS[from];
      for (let i = 0; i < targets.length; i++) {
        if (!(board[targets[i]] & own)) moves.push(new Move(from, targets[i]));
      }
    } else {
      const rays = RAYS[from];
      const first = type === BISHOP ? BISHOP_FIRST : ROOK_FIRST;
      const last = type === ROOK ? ROOK_LAST : BISHOP_LAST;
      for (let direction = first; direction <= last; direction++) {
        const ray = rays[direction];
        for (let i = 0; i < ray.length; i++) {
          const to = ray[i];
          const target = board[to];
          if (target & own) break;
          moves.push(new Move(from, to));
          if (target) break;
        }
      }
    }
  }

  /**
   * Appends the castling moves of the side to move, which the caller has found
   * not to be in check. Castling needs the right, empty squares between king
   * and rook, and a king that neither crosses nor lands on an attacked square.
   */
  _addCastling(moves) {
    const us = this.turn ? 1 : 0;
    const rights = us ? this._castling & 3 : this._castling >> 2;   // bit 0: kingside, bit 1: queenside
    if (rights === 0) return;
    const board = this._board;
    const them = 1 - us;
    const king = us ? E1 : E8;   // holding a right means the king has never moved
    if ((rights & 1) && board[king + 1] === 0 && board[king + 2] === 0
        && !this._isAttacked(king + 1, them) && !this._isAttacked(king + 2, them)) {
      moves.push(new Move(king, king + 2));
    }
    if ((rights & 2) && board[king - 1] === 0 && board[king - 2] === 0 && board[king - 3] === 0
        && !this._isAttacked(king - 1, them) && !this._isAttacked(king - 2, them)) {
      moves.push(new Move(king, king - 2));
    }
  }

  /**
   * Would the king of the side to move, now on `king`, be safe once the piece
   * on `from` has gone to `to`? The move is tried on the board array and taken back.
   */
  _leavesKingSafe(from, to, king) {
    const board = this._board;
    const us = this.turn ? 1 : 0;
    const piece = board[from];
    const target = board[to];
    // An en-passant capture removes a pawn that does not stand on the destination square.
    const passed = (piece & TYPE_MASK) === PAWN && to === this.epSquare ? to + (us ? -8 : 8) : -1;
    const passedPawn = passed >= 0 ? board[passed] : 0;

    board[from] = 0;
    board[to] = piece;
    if (passed >= 0) board[passed] = 0;
    const safe = !this._isAttacked(from === king ? to : king, 1 - us);
    board[from] = piece;
    board[to] = target;
    if (passed >= 0) board[passed] = passedPawn;
    return safe;
  }

  /** Does the move take something? En passant counts. */
  isCapture(move) {
    const enemy = this.turn ? BLACK_BIT : WHITE_BIT;
    return (this._board[move.to] & enemy) !== 0 || this.isEnPassant(move);
  }

  /** Is the move a pawn capturing en passant? */
  isEnPassant(move) {
    const step = Math.abs(move.to - move.from);
    return move.to === this.epSquare && (step === 7 || step === 9)
      && (this._board[move.from] & TYPE_MASK) === PAWN && this._board[move.to] === 0;
  }

  /** Is the move castling (the king moving two files)? */
  isCastling(move) {
    return (this._board[move.from] & TYPE_MASK) === KING && Math.abs((move.to & 7) - (move.from & 7)) === 2;
  }

  isKingsideCastling(move) {
    return this.isCastling(move) && (move.to & 7) > (move.from & 7);
  }

  isQueensideCastling(move) {
    return this.isCastling(move) && (move.to & 7) < (move.from & 7);
  }

  /** Does the move put the opponent in check? */
  givesCheck(move) {
    this.push(move);
    const check = this.isCheck();
    this.pop();
    return check;
  }

  /**
   * Plays a move. The move must be legal here (take it from legalMoves,
   * parseUci or parseSan, or ask isLegal first): push does not check.
   */
  push(move) {
    const board = this._board;
    const from = move.from, to = move.to;
    const us = this.turn ? 1 : 0;
    const piece = board[from];
    if (!(piece & (8 << us))) {
      throw new Error(`Cannot play ${move.uci()}: no ${us ? 'white' : 'black'} piece on ${SQUARE_NAMES[from]}`);
    }
    const type = piece & TYPE_MASK;

    // What is captured, and where: en passant takes the pawn beside the capturer.
    let captured = board[to];
    let capturedOn = to;
    if (type === PAWN && to === this.epSquare && captured === 0) {
      capturedOn = to + (us ? -8 : 8);
      captured = board[capturedOn];
      board[capturedOn] = 0;
    }
    this._undo.push({
      captured,
      capturedOn,
      castling: this._castling,
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
    });

    board[from] = 0;
    board[to] = move.promotion ? (8 << us) | move.promotion : piece;
    if (type === KING) {
      if (to - from === 2) {            // O-O: the rook comes from the corner to the king's other side
        board[to - 1] = board[to + 1];
        board[to + 1] = 0;
      } else if (from - to === 2) {     // O-O-O
        board[to + 1] = board[to - 2];
        board[to - 2] = 0;
      }
    }

    this._castling &= CASTLING_KEPT[from] & CASTLING_KEPT[to];
    this.epSquare = type === PAWN && Math.abs(to - from) === 16 ? (from + to) >> 1 : null;
    this.halfmoveClock = type === PAWN || captured !== 0 ? 0 : this.halfmoveClock + 1;
    if (!this.turn) this.fullmoveNumber++;
    this.turn = !this.turn;
    this.moveStack.push(move);
    this._bitboards = null;
  }

  /** Takes back the last move and returns it. */
  pop() {
    if (this.moveStack.length === 0) throw new Error('No move to take back');
    const move = this.moveStack.pop();
    const undo = this._undo.pop();
    const board = this._board;
    const from = move.from, to = move.to;

    this.turn = !this.turn;
    const us = this.turn ? 1 : 0;
    if (!this.turn) this.fullmoveNumber--;
    this._castling = undo.castling;
    this.epSquare = undo.epSquare;
    this.halfmoveClock = undo.halfmoveClock;

    const piece = move.promotion ? (8 << us) | PAWN : board[to];
    board[to] = 0;
    board[from] = piece;
    if (undo.captured !== 0) board[undo.capturedOn] = undo.captured;
    if ((piece & TYPE_MASK) === KING) {
      if (to - from === 2) {            // O-O: the rook goes back to the corner
        board[to + 1] = board[to - 1];
        board[to - 1] = 0;
      } else if (from - to === 2) {     // O-O-O
        board[to - 2] = board[to + 1];
        board[to + 1] = 0;
      }
    }
    this._bitboards = null;
    return move;
  }

  // ----------------------------------------------------------- notation

  /**
   * The move in standard algebraic notation: 'e4', 'Nbd7', 'exd6', 'e8=Q+',
   * 'O-O', 'Qh4#'. Throws if the move is not legal here.
   */
  san(move) {
    const legal = this.legalMoves();
    if (!legal.some(other => other.equals(move))) {
      throw new Error(`Illegal move ${move && typeof move.uci === 'function' ? move.uci() : move} in ${this.fen()}`);
    }
    const from = move.from, to = move.to;
    const type = this._board[from] & TYPE_MASK;
    let san;
    if (this.isCastling(move)) {
      san = to > from ? 'O-O' : 'O-O-O';
    } else {
      const capture = this.isCapture(move);
      if (type === PAWN) {
        san = capture ? FILE_NAMES[from & 7] : '';
      } else {
        san = SAN_LETTERS[type];
        // If other pieces of the same kind can legally go to the same square,
        // say which one this is: by its file if that settles it, otherwise by
        // its rank, and if neither does by both.
        let rivals = false, fileShared = false, rankShared = false;
        for (const other of legal) {
          if (other.to !== to || other.from === from || (this._board[other.from] & TYPE_MASK) !== type) continue;
          rivals = true;
          if ((other.from & 7) === (from & 7)) fileShared = true;
          if ((other.from >> 3) === (from >> 3)) rankShared = true;
        }
        if (rivals) {
          if (!fileShared) san += FILE_NAMES[from & 7];
          else if (!rankShared) san += (from >> 3) + 1;
          else san += SQUARE_NAMES[from];
        }
      }
      if (capture) san += 'x';
      san += SQUARE_NAMES[to];
      if (move.promotion) san += '=' + SAN_LETTERS[move.promotion];
    }
    this.push(move);
    if (this.isCheck()) san += this._hasLegalMove() ? '+' : '#';
    this.pop();
    return san;
  }

  /**
   * The legal move written as `san`. Besides what san() writes this accepts
   * the usual variations: '0-0' for castling, a missing or superfluous 'x',
   * '+' or '#', more disambiguation than necessary ('Ngf3', 'e2e4') and a
   * promotion without '=' ('e8Q'). Throws if the text is not a move, matches
   * no legal move or matches more than one.
   */
  parseSan(san) {
    const legal = this.legalMoves();
    const castling = typeof san === 'string' ? SAN_CASTLING_PATTERN.exec(san) : null;
    if (castling) {
      const kingside = castling[1].length === 3;
      const move = legal.find(candidate => this.isCastling(candidate) && (candidate.to > candidate.from) === kingside);
      if (!move) throw new Error(`Illegal move ${san} in ${this.fen()}`);
      return move;
    }
    const match = typeof san === 'string' ? SAN_PATTERN.exec(san) : null;
    if (!match) throw new Error(`Invalid SAN: '${san}'`);
    const [, letter, fromFile, fromRank, toName, promotionLetter] = match;
    const type = letter ? SAN_LETTERS.indexOf(letter) : PAWN;
    const to = parseSquare(toName);
    const promotion = promotionLetter ? SAN_LETTERS.indexOf(promotionLetter.toUpperCase()) : 0;

    const matches = legal.filter(move => {
      const from = move.from;
      if (move.to !== to || move.promotion !== promotion || (this._board[from] & TYPE_MASK) !== type) return false;
      if (fromFile && FILE_NAMES[from & 7] !== fromFile) return false;
      if (fromRank && (from >> 3) + 1 !== Number(fromRank)) return false;
      if (type === KING && this.isCastling(move)) return false;                // castling is written O-O
      if (type === PAWN && !fromFile && (from & 7) !== (to & 7)) return false;   // a capture names the pawn's file
      return true;
    });
    if (matches.length === 0) throw new Error(`Illegal move ${san} in ${this.fen()}`);
    if (matches.length > 1) throw new Error(`Ambiguous move ${san} in ${this.fen()}`);
    return matches[0];
  }

  /** The legal move written as `uci` ('e2e4', 'e7e8q'). Throws if it is malformed or not legal here. */
  parseUci(uci) {
    const wanted = Move.fromUci(uci);
    const move = this._legalMoves(wanted.from).find(legal => legal.equals(wanted));
    if (!move) throw new Error(`Illegal move ${uci} in ${this.fen()}`);
    return move;
  }

  /** The position in Forsyth-Edwards Notation. */
  fen() {
    return `${this.epd()} ${this.halfmoveClock} ${this.fullmoveNumber}`;
  }

  /**
   * The first four FEN fields: pieces, side to move, castling rights and the
   * en-passant square. The square is written only if an en-passant capture is
   * legal, so two positions have the same EPD exactly when they are the same
   * position for the purposes of repetition (and of the opening book).
   */
  epd() {
    const board = this._board;
    let placement = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let sq = rank * 8; sq < rank * 8 + 8; sq++) {
        const piece = board[sq];
        if (piece === 0) {
          empty++;
          continue;
        }
        if (empty > 0) placement += empty;
        empty = 0;
        placement += SYMBOL_OF_PIECE[piece];
      }
      if (empty > 0) placement += empty;
      if (rank > 0) placement += '/';
    }
    const enPassant = this._hasLegalEnPassant() ? SQUARE_NAMES[this.epSquare] : '-';
    return `${placement} ${this.turn ? 'w' : 'b'} ${CASTLING_FEN[this._castling]} ${enPassant}`;
  }

  /** Can a pawn of the side to move legally capture en passant? */
  _hasLegalEnPassant() {
    const ep = this.epSquare;
    if (ep === null) return false;
    const us = this.turn ? 1 : 0;
    const pawn = (8 << us) | PAWN;
    const king = this._kingSquare(us);
    const from = PAWN_CAPTURES[1 - us][ep];   // the squares from which our pawns attack the en-passant square
    for (let i = 0; i < from.length; i++) {
      if (this._board[from[i]] === pawn && (king < 0 || this._leavesKingSafe(from[i], ep, king))) return true;
    }
    return false;
  }

  toString() {
    return this.fen();
  }

  // --------------------------------------------------------- game state

  _hasLegalMove() {
    return this._legalMoves(-1).length > 0;
  }

  /** Is the side to move checkmated? */
  isCheckmate() {
    return this.isCheck() && !this._hasLegalMove();
  }

  /** Is the side to move stalemated? */
  isStalemate() {
    return !this.isCheck() && !this._hasLegalMove();
  }

  /** True if neither side could ever deliver mate, however badly the other played. */
  isInsufficientMaterial() {
    return this._cannotMate(WHITE) && this._cannotMate(BLACK);
  }

  _cannotMate(color) {
    const view = this._view();
    const own = view[color ? VIEW_WHITE : VIEW_BLACK];
    const theirs = view[color ? VIEW_BLACK : VIEW_WHITE];
    // A pawn (it may promote), a rook or a queen can always mate.
    if (own & (view[PAWN] | view[ROOK] | view[QUEEN])) return false;
    // A knight mates only with help: another piece of its own side, or an
    // enemy piece other than a queen to take away the king's flight square.
    if (own & view[KNIGHT]) {
      return popcount(own) <= 2 && !(theirs & ~view[KING] & ~view[QUEEN]);
    }
    // Bishops mate only if some bishop (of either side) runs on the other
    // colour of square, or a pawn or knight is there to help.
    if (own & view[BISHOP]) {
      const oneColour = !(view[BISHOP] & BB_DARK_SQUARES) || !(view[BISHOP] & BB_LIGHT_SQUARES);
      return oneColour && !view[PAWN] && !view[KNIGHT];
    }
    return true;   // a bare king
  }

  /**
   * How often each position that could still recur has stood on the board in
   * this game, the present one included, keyed by epd(). A capture or a pawn
   * move can never be undone, so nothing before the last of them matters; the
   * halfmove clock says how far back that is.
   */
  _occurrences() {
    const counts = new Map();
    const past = this.copy();
    let plies = Math.min(this.halfmoveClock, this.moveStack.length);
    for (;;) {
      const key = past.epd();
      counts.set(key, (counts.get(key) || 0) + 1);
      if (plies-- === 0) break;
      past.pop();
    }
    return counts;
  }

  /** Has the current position occurred at least `count` times in the game (the moves since construction)? */
  isRepetition(count = 3) {
    if (count <= 1) return true;
    // The same position cannot come back in fewer than four half-moves.
    if (Math.min(this.halfmoveClock, this.moveStack.length) < 4 * (count - 1)) return false;
    return this._occurrences().get(this.epd()) >= count;
  }

  /**
   * May the side to move claim a draw by threefold repetition? Yes if the
   * current position has occurred three times, or if some legal move leads to
   * a position that will then have occurred three times.
   */
  canClaimThreefoldRepetition() {
    // Two earlier occurrences of the position after a move need seven
    // reversible half-moves behind us (and three of the current one need eight).
    if (Math.min(this.halfmoveClock, this.moveStack.length) < 7) return false;
    const seen = this._occurrences();
    if (seen.get(this.epd()) >= 3) return true;
    for (const move of this.legalMoves()) {
      this.push(move);
      const before = seen.get(this.epd()) || 0;
      this.pop();
      if (before >= 2) return true;
    }
    return false;
  }

  /**
   * May the side to move claim a draw by the fifty-move rule? Yes if fifty
   * moves by each side have passed without a capture or pawn move (and the
   * game is not over), or if a legal move that is neither would complete them.
   */
  canClaimFiftyMoves() {
    if (this.halfmoveClock >= 100) return this._hasLegalMove();
    if (this.halfmoveClock < 99) return false;
    for (const move of this.legalMoves()) {
      if ((this._board[move.from] & TYPE_MASK) === PAWN || this.isCapture(move)) continue;
      this.push(move);
      const playable = this._hasLegalMove();
      this.pop();
      if (playable) return true;
    }
    return false;
  }

  // ------------------------------------------------- exchange evaluation

  /**
   * Static exchange evaluation: the material `move` wins (or loses, if
   * negative) once every worthwhile recapture on its destination square has
   * been played, each side always taking with its least valuable piece.
   * Pawn 100, knight 320, bishop 330, rook 500, queen 950, king 20000.
   * A port of static_exchange in fischerbot/engine.py, used by the style
   * features; not meant for promotions or castling.
   */
  see(move) {
    const view = this._view();
    const pawns = view[PAWN], knights = view[KNIGHT], bishops = view[BISHOP];
    const rooks = view[ROOK], queens = view[QUEEN], kings = view[KING];
    const from = move.from, to = move.to;
    const mover = this._board[from] & TYPE_MASK;
    let occupied = view[VIEW_OCCUPIED];

    // gain[i] is the material balance, seen by the side that made capture i,
    // if the exchange stopped right after that capture.
    const gain = [];
    if (this._board[to] !== 0) {
      gain.push(SEE_VALUES[this._board[to] & TYPE_MASK]);
    } else if (mover === PAWN && to === this.epSquare) {
      gain.push(SEE_VALUES[PAWN]);
      occupied ^= BB_SQUARES[to + (this.turn ? -8 : 8)];
    } else {
      gain.push(0);
    }
    occupied ^= BB_SQUARES[from];

    let onSquare = SEE_VALUES[mover];   // value of the piece now standing on the square
    let side = !this.turn;              // whose turn it is to recapture
    for (;;) {
      // Pieces already used are gone from `occupied`, which also lets the
      // sliders behind them join in.
      const attackers = this.attackersMask(side, to, occupied) & occupied;
      if (!attackers) break;
      let pieces, value;
      if (attackers & pawns) {
        pieces = attackers & pawns;
        value = SEE_VALUES[PAWN];
      } else if (attackers & knights) {
        pieces = attackers & knights;
        value = SEE_VALUES[KNIGHT];
      } else if (attackers & bishops) {
        pieces = attackers & bishops;
        value = SEE_VALUES[BISHOP];
      } else if (attackers & rooks) {
        pieces = attackers & rooks;
        value = SEE_VALUES[ROOK];
      } else if (attackers & queens) {
        pieces = attackers & queens;
        value = SEE_VALUES[QUEEN];
      } else {
        pieces = attackers & kings;
        value = SEE_VALUES[KING];
      }
      const capturer = pieces & -pieces;   // the one on the lowest square
      gain.push(onSquare - gain[gain.length - 1]);
      if (value === SEE_VALUES[KING]) {
        // A king may only recapture when nothing defends the square.
        const without = occupied ^ capturer;
        if (this.attackersMask(!side, to, without) & without) {
          gain.pop();
          break;
        }
      }
      onSquare = value;
      occupied ^= capturer;
      side = !side;
    }

    // Walk back from the end: each side stops capturing when going on would cost material.
    for (let i = gain.length - 1; i > 0; i--) {
      const ifRecaptured = 0 - gain[i];   // not `-gain[i]`, which could be a negative zero
      if (ifRecaptured < gain[i - 1]) gain[i - 1] = ifRecaptured;
    }
    return gain[0];
  }
}

// ---------------------------------------------------------------------------
// Perft
// ---------------------------------------------------------------------------

/** Number of move sequences of exactly `depth` half-moves from `position` - the standard test of a move generator. */
export function perft(position, depth) {
  if (depth <= 0) return 1;
  const moves = position.legalMoves();
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    position.push(move);
    nodes += perft(position, depth - 1);
    position.pop();
  }
  return nodes;
}
