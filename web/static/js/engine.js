/**
 * FischerBot search engine.
 *
 * A self-contained chess engine for the browser (Web Worker) and Node: its own
 * board, move generator, evaluation and search, written for speed in V8. It
 * shares nothing with rules.js.
 *
 * Board: a 16x16 mailbox with sentinel squares around the real board, piece
 * lists per piece kind, and moves packed into integers. All position state
 * lives in module-level typed arrays, because V8 turns `const` typed arrays
 * into direct memory accesses; an `Engine` object owns only what must not be
 * shared between engines (its hash table, its history tables, the game it was
 * given) and loads itself into the module state before it works.
 *
 * The piece-square tables are PeSTO's (Ronald Friederich), as published on the
 * Chess Programming Wiki: https://www.chessprogramming.org/PeSTO%27s_Evaluation_Function
 * Everything else in this file was written for FischerBot.
 */

export const ENGINE_NAME = 'FischerBot 3';

// ---------------------------------------------------------------------------
// Pieces and squares
// ---------------------------------------------------------------------------

const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;

// A piece code is its colour bit plus its type, so "is it theirs?" is one AND.
// EDGE marks the squares off the board; it carries neither colour bit.
const WBIT = 8, BBIT = 16, EDGE = 32;
const WP = 9, WN = 10, WB = 11, WR = 12, WQ = 13, WK = 14;
const BP = 17, BN = 18, BB = 19, BR = 20, BQ = 21, BK = 22;

// Square = 64 + 16 * rank + file: a1 = 64, h1 = 71, a8 = 176, h8 = 183. Rows
// are 16 apart, so the difference between two squares tells the direction from
// one to the other (the 0x88 property), and every square a piece can step to
// from the real board - two ranks beyond each edge, and the files 8..15
// between the rows - exists in the array and holds EDGE. No bounds tests.
const A1 = 64, B1 = 65, C1 = 66, D1 = 67, E1 = 68, F1 = 69, G1 = 70, H1 = 71;
const A8 = 176, B8 = 177, C8 = 178, D8 = 179, E8 = 180, F8 = 181, G8 = 182, H8 = 183;
const RANK_3 = 96, RANK_7 = 160;       // first square of those ranks

const KNIGHT_STEPS = new Int8Array([33, 31, 18, 14, -14, -18, -31, -33]);
const BISHOP_STEPS = new Int8Array([17, 15, -15, -17]);
const ROOK_STEPS = new Int8Array([16, 1, -1, -16]);
const QUEEN_STEPS = new Int8Array([16, 1, -1, -16, 17, 15, -15, -17]);

/** Mailbox square -> 0..63 (a1 = 0, h8 = 63). */
const SQ64 = new Int8Array(256).fill(-1);
/** 0..63 -> mailbox square. */
const SQ256 = new Uint8Array(64);
for (let s = 0; s < 64; s++) {
  SQ256[s] = 64 + ((s >> 3) << 4) + (s & 7);
  SQ64[SQ256[s]] = s;
}

// Move = from | to << 8 | piece << 16 | captured type << 21 | promotion type << 24 | flags.
// 29 bits, so a move is always a small integer for V8.
const M_EP = 1 << 27, M_CASTLE = 1 << 28;
const M_CAPTURE = 7 << 21, M_PROMO = 7 << 24;
const M_NOISY = M_CAPTURE | M_PROMO;   // en passant carries a captured pawn too

// ---------------------------------------------------------------------------
// Tables indexed by the difference of two squares (to - from + 119)
// ---------------------------------------------------------------------------

const A_N = 1, A_B = 2, A_R = 4, A_K = 8, A_WP = 16, A_BP = 32;
/** Unit step from `from` towards `to` when they share a line, else 0. */
const DIR = new Int8Array(240);
/** Which kinds of piece standing on `from` attack `to` on an empty board. */
const ATT = new Uint8Array(240);
/** King-move distance. */
const DIST = new Uint8Array(240);
/** The attack bits of each piece code. */
const PATT = new Uint8Array(32);

for (let dr = -7; dr <= 7; dr++) {
  for (let df = -7; df <= 7; df++) {
    if (dr === 0 && df === 0) continue;
    const d = 119 + dr * 16 + df;
    const adr = Math.abs(dr), adf = Math.abs(df);
    DIST[d] = Math.max(adr, adf);
    let a = 0;
    if (dr === 0 || df === 0) a |= A_R;
    if (adr === adf) a |= A_B;
    if (a) DIR[d] = Math.sign(dr) * 16 + Math.sign(df);
    if (adr <= 1 && adf <= 1) a |= A_K;
    if (adr * adf === 2) a |= A_N;
    if (adf === 1 && dr === 1) a |= A_WP;
    if (adf === 1 && dr === -1) a |= A_BP;
    ATT[d] = a;
  }
}
PATT[WP] = A_WP; PATT[BP] = A_BP;
PATT[WN] = PATT[BN] = A_N;
PATT[WB] = PATT[BB] = A_B;
PATT[WR] = PATT[BR] = A_R;
PATT[WQ] = PATT[BQ] = A_B | A_R;
PATT[WK] = PATT[BK] = A_K;
const A_SLIDE = A_B | A_R;

// ---------------------------------------------------------------------------
// Zobrist keys (two 32-bit halves)
// ---------------------------------------------------------------------------

const ZLO = new Int32Array(24 * 256), ZHI = new Int32Array(24 * 256);   // [piece << 8 | square]
const ZCASTLE_LO = new Int32Array(16), ZCASTLE_HI = new Int32Array(16);
const ZEP_LO = new Int32Array(8), ZEP_HI = new Int32Array(8);           // by file

// A fixed stream of well-mixed 32-bit numbers (a counter pushed through
// multiply/xor-shift rounds). Deterministic: the engine never uses Math.random().
let zobristCounter = 0x1F83D9AB;
function nextRandom() {
  zobristCounter = (zobristCounter + 0x6A09E667) | 0;
  let x = zobristCounter;
  x = Math.imul(x ^ (x >>> 16), 0x21F0AAAD);
  x = Math.imul(x ^ (x >>> 15), 0x735A2D97);
  x = Math.imul(x ^ (x >>> 13), 0x3C6EF372 | 1);
  return x ^ (x >>> 16);
}
for (const piece of [WP, WN, WB, WR, WQ, WK, BP, BN, BB, BR, BQ, BK]) {
  for (let s = 0; s < 64; s++) {
    ZLO[(piece << 8) | SQ256[s]] = nextRandom();
    ZHI[(piece << 8) | SQ256[s]] = nextRandom();
  }
}
for (let i = 1; i < 16; i++) { ZCASTLE_LO[i] = nextRandom(); ZCASTLE_HI[i] = nextRandom(); }
for (let i = 0; i < 8; i++) { ZEP_LO[i] = nextRandom(); ZEP_HI[i] = nextRandom(); }
const ZSIDE_LO = nextRandom(), ZSIDE_HI = nextRandom();   // xor-ed in when Black is to move

// ---------------------------------------------------------------------------
// Material and piece-square tables
// ---------------------------------------------------------------------------

// PeSTO piece-square tables and piece values (Ronald Friederich), a8 first.
const PESTO_MG = [
  [ // pawn
       0,   0,   0,   0,   0,   0,   0,   0,
      98, 134,  61,  95,  68, 126,  34, -11,
      -6,   7,  26,  31,  65,  56,  25, -20,
     -14,  13,   6,  21,  23,  12,  17, -23,
     -27,  -2,  -5,  12,  17,   6,  10, -25,
     -26,  -4,  -4, -10,   3,   3,  33, -12,
     -35,  -1, -20, -23, -15,  24,  38, -22,
       0,   0,   0,   0,   0,   0,   0,   0,
  ],
  [ // knight
    -167, -89, -34, -49,  61, -97, -15,-107,
     -73, -41,  72,  36,  23,  62,   7, -17,
     -47,  60,  37,  65,  84, 129,  73,  44,
      -9,  17,  19,  53,  37,  69,  18,  22,
     -13,   4,  16,  13,  28,  19,  21,  -8,
     -23,  -9,  12,  10,  19,  17,  25, -16,
     -29, -53, -12,  -3,  -1,  18, -14, -19,
    -105, -21, -58, -33, -17, -28, -19, -23,
  ],
  [ // bishop
     -29,   4, -82, -37, -25, -42,   7,  -8,
     -26,  16, -18, -13,  30,  59,  18, -47,
     -16,  37,  43,  40,  35,  50,  37,  -2,
      -4,   5,  19,  50,  37,  37,   7,  -2,
      -6,  13,  13,  26,  34,  12,  10,   4,
       0,  15,  15,  15,  14,  27,  18,  10,
       4,  15,  16,   0,   7,  21,  33,   1,
     -33,  -3, -14, -21, -13, -12, -39, -21,
  ],
  [ // rook
      32,  42,  32,  51,  63,   9,  31,  43,
      27,  32,  58,  62,  80,  67,  26,  44,
      -5,  19,  26,  36,  17,  45,  61,  16,
     -24, -11,   7,  26,  24,  35,  -8, -20,
     -36, -26, -12,  -1,   9,  -7,   6, -23,
     -45, -25, -16, -17,   3,   0,  -5, -33,
     -44, -16, -20,  -9,  -1,  11,  -6, -71,
     -19, -13,   1,  17,  16,   7, -37, -26,
  ],
  [ // queen
     -28,   0,  29,  12,  59,  44,  43,  45,
     -24, -39,  -5,   1, -16,  57,  28,  54,
     -13, -17,   7,   8,  29,  56,  47,  57,
     -27, -27, -16, -16,  -1,  17,  -2,   1,
      -9, -26,  -9, -10,  -2,  -4,   3,  -3,
     -14,   2, -11,  -2,  -5,   2,  14,   5,
     -35,  -8,  11,   2,   8,  15,  -3,   1,
      -1, -18,  -9,  10, -15, -25, -31, -50,
  ],
  [ // king
     -65,  23,  16, -15, -56, -34,   2,  13,
      29,  -1, -20,  -7,  -8,  -4, -38, -29,
      -9,  24,   2, -16, -20,   6,  22, -22,
     -17, -20, -12, -27, -30, -25, -14, -36,
     -49,  -1, -27, -39, -46, -44, -33, -51,
     -14, -14, -22, -46, -44, -30, -15, -27,
       1,   7,  -8, -64, -43, -16,   9,   8,
     -15,  36,  12, -54,   8, -28,  24,  14,
  ],
];
const PESTO_EG = [
  [ // pawn
       0,   0,   0,   0,   0,   0,   0,   0,
     178, 173, 158, 134, 147, 132, 165, 187,
      94, 100,  85,  67,  56,  53,  82,  84,
      32,  24,  13,   5,  -2,   4,  17,  17,
      13,   9,  -3,  -7,  -7,  -8,   3,  -1,
       4,   7,  -6,   1,   0,  -5,  -1,  -8,
      13,   8,   8,  10,  13,   0,   2,  -7,
       0,   0,   0,   0,   0,   0,   0,   0,
  ],
  [ // knight
     -58, -38, -13, -28, -31, -27, -63, -99,
     -25,  -8, -25,  -2,  -9, -25, -24, -52,
     -24, -20,  10,   9,  -1,  -9, -19, -41,
     -17,   3,  22,  22,  22,  11,   8, -18,
     -18,  -6,  16,  25,  16,  17,   4, -18,
     -23,  -3,  -1,  15,  10,  -3, -20, -22,
     -42, -20, -10,  -5,  -2, -20, -23, -44,
     -29, -51, -23, -15, -22, -18, -50, -64,
  ],
  [ // bishop
     -14, -21, -11,  -8,  -7,  -9, -17, -24,
      -8,  -4,   7, -12,  -3, -13,  -4, -14,
       2,  -8,   0,  -1,  -2,   6,   0,   4,
      -3,   9,  12,   9,  14,  10,   3,   2,
      -6,   3,  13,  19,   7,  10,  -3,  -9,
     -12,  -3,   8,  10,  13,   3,  -7, -15,
     -14, -18,  -7,  -1,   4,  -9, -15, -27,
     -23,  -9, -23,  -5,  -9, -16,  -5, -17,
  ],
  [ // rook
      13,  10,  18,  15,  12,  12,   8,   5,
      11,  13,  13,  11,  -3,   3,   8,   3,
       7,   7,   7,   5,   4,  -3,  -5,  -3,
       4,   3,  13,   1,   2,   1,  -1,   2,
       3,   5,   8,   4,  -5,  -6,  -8, -11,
      -4,   0,  -5,  -1,  -7, -12,  -8, -16,
      -6,  -6,   0,   2,  -9,  -9, -11,  -3,
      -9,   2,   3,  -1,  -5, -13,   4, -20,
  ],
  [ // queen
      -9,  22,  22,  27,  27,  19,  10,  20,
     -17,  20,  32,  41,  58,  25,  30,   0,
     -20,   6,   9,  49,  47,  35,  19,   9,
       3,  22,  24,  45,  57,  40,  57,  36,
     -18,  28,  19,  47,  31,  34,  39,  23,
     -16, -27,  15,   6,   9,  17,  10,   5,
     -22, -23, -30, -16, -16, -23, -36, -32,
     -33, -28, -22, -43,  -5, -32, -20, -41,
  ],
  [ // king
     -74, -35, -18, -18, -11,  15,   4, -17,
     -12,  17,  14,  17,  17,  38,  23,  11,
      10,  17,  23,  15,  20,  45,  44,  13,
      -8,  22,  24,  27,  26,  33,  26,   3,
     -18,  -4,  21,  24,  27,  23,   9, -11,
     -19,  -3,  11,  21,  23,  16,   7,  -9,
     -27, -11,   4,  13,  14,   4,  -5, -17,
     -53, -34, -21, -11, -28, -14, -24, -43,
  ],
];
const PESTO_MG_VALUE = [82, 337, 365, 477, 1025, 0];
const PESTO_EG_VALUE = [94, 281, 297, 512, 936, 0];

/**
 * A middlegame and an endgame score packed into one integer so both are
 * updated with a single addition: mg in the high half, eg in the low half.
 */
function S(mg, eg) { return mg * 65536 + eg; }
function egOf(packed) { return (packed << 16) >> 16; }
function mgOf(packed) { return (packed - ((packed << 16) >> 16)) >> 16; }

/** Material + piece-square value of [piece << 8 | square], White positive, Black negative. */
const PSQ = new Int32Array(24 * 256);
for (let type = PAWN; type <= KING; type++) {
  for (let s = 0; s < 64; s++) {
    const file = s & 7, rank = s >> 3;
    // The tables are printed with a8 first: a white piece reads them upside down.
    const w = (7 - rank) * 8 + file, b = rank * 8 + file;
    PSQ[((WBIT | type) << 8) | SQ256[s]] =
      S(PESTO_MG_VALUE[type - 1] + PESTO_MG[type - 1][w], PESTO_EG_VALUE[type - 1] + PESTO_EG[type - 1][w]);
    PSQ[((BBIT | type) << 8) | SQ256[s]] =
      -S(PESTO_MG_VALUE[type - 1] + PESTO_MG[type - 1][b], PESTO_EG_VALUE[type - 1] + PESTO_EG[type - 1][b]);
  }
}

/** Game phase weight by piece type: 24 with all pieces on, 0 with none. */
const PHASE_OF = new Uint8Array([0, 0, 1, 1, 2, 4, 0, 0]);
const MAX_PHASE = 24;

// ---------------------------------------------------------------------------
// Position state
// ---------------------------------------------------------------------------

const board = new Uint8Array(256);
/** Squares of the pieces of each kind: plist[piece << 4 | i], i < pcount[piece]. */
const plist = new Uint8Array(24 * 16);
const pcount = new Uint8Array(24);
/** Where in its list the piece standing on a square is. */
const pindex = new Uint8Array(256);
/** How many pawns attack a square: pawnAtt[sq] White's, pawnAtt[256 + sq] Black's. */
const pawnAtt = new Uint8Array(512);
const KING_SLOT = WK << 4;             // plist[KING_SLOT + (colour << 7)] is that side's king

// Everything else about a position is kept in a frame of the stack U, one
// frame per move played: making a move writes the next frame, taking it back
// just steps down. The frames below the search root are the game so far,
// which is what repetition detection looks through.
const FR = 16;
const F_KEYLO = 0, F_KEYHI = 1;        // Zobrist key
const F_PAWNLO = 2, F_PAWNHI = 3;      // key of the pawns alone
const F_PSQ = 4;                       // packed material + piece-square score, White's view
const F_PHASE = 5;
const F_CASTLE = 6;                    // 1 = K, 2 = Q, 4 = k, 8 = q
const F_EP = 7;                        // en-passant square, only when a capture there is legal
const F_HALF = 8;                      // half-move clock
const F_CAPIDX = 9, F_PROMOIDX = 10;   // piece-list slots to restore when the move is taken back
const F_MOVE = 11;                     // the move that led here (0 at the root and after a null move)

const MAX_PLY = 128;
const MAX_GAME = 2048;
const U = new Int32Array((MAX_GAME + MAX_PLY + 8) * FR);
let sp = 0;                            // offset of the current frame
let stm = 0;                           // side to move: 0 White, 1 Black

/** Castling rights that survive a move touching each square. */
const CASTLE_KEEP = new Uint8Array(256).fill(15);
CASTLE_KEEP[A1] = 13; CASTLE_KEEP[E1] = 12; CASTLE_KEEP[H1] = 14;
CASTLE_KEEP[A8] = 7; CASTLE_KEEP[E8] = 3; CASTLE_KEEP[H8] = 11;

/** Move lists: 256 slots per ply. */
const mlist = new Int32Array(MAX_PLY * 256);
const mscore = new Int32Array(MAX_PLY * 256);

function putPiece(piece, s) {
  board[s] = piece;
  const n = pcount[piece]++;
  plist[(piece << 4) | n] = s;
  pindex[s] = n;
  if (piece === WP) { pawnAtt[s + 15]++; pawnAtt[s + 17]++; }
  else if (piece === BP) { pawnAtt[256 + s - 15]++; pawnAtt[256 + s - 17]++; }
}

// ---------------------------------------------------------------------------
// Attacks
// ---------------------------------------------------------------------------

/** Is `sq` attacked by a piece of colour `by`? */
function attacked(sq, by) {
  const bit = 8 << by;
  if (by === 0) {
    if (board[sq - 15] === WP || board[sq - 17] === WP) return true;
  } else if (board[sq + 15] === BP || board[sq + 17] === BP) return true;
  let i, s, d, step;
  let base = (bit | KNIGHT) << 4;
  for (i = pcount[bit | KNIGHT] - 1; i >= 0; i--) {
    if (ATT[sq - plist[base | i] + 119] & A_N) return true;
  }
  if (ATT[sq - plist[(bit | KING) << 4] + 119] & A_K) return true;
  base = (bit | BISHOP) << 4;
  for (i = pcount[bit | BISHOP] - 1; i >= 0; i--) {
    s = plist[base | i];
    d = sq - s + 119;
    if (ATT[d] & A_B) {
      step = DIR[d];
      for (s += step; s !== sq && board[s] === 0; s += step);
      if (s === sq) return true;
    }
  }
  base = (bit | ROOK) << 4;
  for (i = pcount[bit | ROOK] - 1; i >= 0; i--) {
    s = plist[base | i];
    d = sq - s + 119;
    if (ATT[d] & A_R) {
      step = DIR[d];
      for (s += step; s !== sq && board[s] === 0; s += step);
      if (s === sq) return true;
    }
  }
  base = (bit | QUEEN) << 4;
  for (i = pcount[bit | QUEEN] - 1; i >= 0; i--) {
    s = plist[base | i];
    d = sq - s + 119;
    if (ATT[d] & A_SLIDE) {
      step = DIR[d];
      for (s += step; s !== sq && board[s] === 0; s += step);
      if (s === sq) return true;
    }
  }
  return false;
}

/**
 * The piece checking the side to move: 0 if there is none, its square if
 * there is one, 255 for a double check (only the king can move then).
 */
function findChecker() {
  const us = stm, bit = 16 >> us;                    // the opponent's colour bit
  const ksq = plist[KING_SLOT + (us << 7)];
  let found = 0, i, s, d, step, t;
  if (us === 0) {
    if (board[ksq + 15] === BP) found = ksq + 15;
    else if (board[ksq + 17] === BP) found = ksq + 17;
  } else if (board[ksq - 15] === WP) found = ksq - 15;
  else if (board[ksq - 17] === WP) found = ksq - 17;
  let base = (bit | KNIGHT) << 4;
  for (i = pcount[bit | KNIGHT] - 1; i >= 0; i--) {
    s = plist[base | i];
    if (ATT[ksq - s + 119] & A_N) { if (found) return 255; found = s; }
  }
  for (let type = BISHOP; type <= QUEEN; type++) {
    const mask = type === BISHOP ? A_B : type === ROOK ? A_R : A_SLIDE;
    base = (bit | type) << 4;
    for (i = pcount[bit | type] - 1; i >= 0; i--) {
      s = plist[base | i];
      d = ksq - s + 119;
      if (ATT[d] & mask) {
        step = DIR[d];
        for (t = s + step; t !== ksq && board[t] === 0; t += step);
        if (t === ksq) { if (found) return 255; found = s; }
      }
    }
  }
  return found;
}

/** Would the en-passant capture from `from` to `ep` leave the mover's king safe? */
function epLegalFrom(from, ep) {
  const us = stm;
  const cap = us === 0 ? ep - 16 : ep + 16;
  const pawn = board[from], victim = board[cap];
  board[from] = 0; board[cap] = 0; board[ep] = pawn;
  const exposed = attacked(plist[KING_SLOT + (us << 7)], us ^ 1);
  board[from] = pawn; board[cap] = victim; board[ep] = 0;
  return !exposed;
}

/** Can the side to move legally capture en passant on `ep`? */
function epCapturable(ep) {
  const pawn = (8 << stm) | PAWN;
  const a = stm === 0 ? ep - 15 : ep + 15, b = stm === 0 ? ep - 17 : ep + 17;
  return (board[a] === pawn && epLegalFrom(a, ep)) || (board[b] === pawn && epLegalFrom(b, ep));
}

// ---------------------------------------------------------------------------
// Making and unmaking moves
// ---------------------------------------------------------------------------

function makeMove(m) {
  const from = m & 255, to = (m >> 8) & 255, piece = (m >> 16) & 31;
  const capt = (m >> 21) & 7, promo = (m >> 24) & 7;
  const us = stm, usBit = 8 << us;
  const s0 = sp, s1 = sp + FR;
  let kl = U[s0 + F_KEYLO] ^ ZSIDE_LO, kh = U[s0 + F_KEYHI] ^ ZSIDE_HI;
  let pl = U[s0 + F_PAWNLO], ph = U[s0 + F_PAWNHI];
  let psq = U[s0 + F_PSQ], phase = U[s0 + F_PHASE], half = U[s0 + F_HALF] + 1;
  const ep = U[s0 + F_EP];
  if (ep !== 0) { kl ^= ZEP_LO[ep & 7]; kh ^= ZEP_HI[ep & 7]; }
  const castle = U[s0 + F_CASTLE];
  const newCastle = castle & CASTLE_KEEP[from] & CASTLE_KEEP[to];
  if (newCastle !== castle) {
    kl ^= ZCASTLE_LO[castle] ^ ZCASTLE_LO[newCastle];
    kh ^= ZCASTLE_HI[castle] ^ ZCASTLE_HI[newCastle];
  }
  let z, idx, base, last, moved;

  if (capt !== 0) {
    const cp = capt | (usBit ^ 24);
    let cs = to;
    if (m & M_EP) { cs = us === 0 ? to - 16 : to + 16; board[cs] = 0; }
    // Take the captured piece out of its list: the last entry fills its slot.
    idx = pindex[cs]; base = cp << 4; last = --pcount[cp];
    moved = plist[base | last];
    plist[base | idx] = moved; pindex[moved] = idx;
    U[s1 + F_CAPIDX] = idx;
    z = (cp << 8) | cs;
    kl ^= ZLO[z]; kh ^= ZHI[z];
    psq -= PSQ[z]; phase -= PHASE_OF[capt];
    if (capt === PAWN) {
      pl ^= ZLO[z]; ph ^= ZHI[z];
      if (us === 0) { pawnAtt[256 + cs - 15]--; pawnAtt[256 + cs - 17]--; }
      else { pawnAtt[cs + 15]--; pawnAtt[cs + 17]--; }
    }
    half = 0;
  }

  board[from] = 0;
  const zf = (piece << 8) | from;
  let epTry = 0;
  if (promo !== 0) {
    // The pawn leaves the board and the new piece joins the end of its list.
    idx = pindex[from]; base = piece << 4; last = --pcount[piece];
    moved = plist[base | last];
    plist[base | idx] = moved; pindex[moved] = idx;
    U[s1 + F_PROMOIDX] = idx;
    const pp = usBit | promo;
    last = pcount[pp]++;
    plist[(pp << 4) | last] = to; pindex[to] = last; board[to] = pp;
    z = (pp << 8) | to;
    kl ^= ZLO[zf] ^ ZLO[z]; kh ^= ZHI[zf] ^ ZHI[z];
    pl ^= ZLO[zf]; ph ^= ZHI[zf];
    psq += PSQ[z] - PSQ[zf]; phase += PHASE_OF[promo];
    if (us === 0) { pawnAtt[from + 15]--; pawnAtt[from + 17]--; }
    else { pawnAtt[256 + from - 15]--; pawnAtt[256 + from - 17]--; }
    half = 0;
  } else {
    idx = pindex[from];
    plist[(piece << 4) | idx] = to; pindex[to] = idx; board[to] = piece;
    z = (piece << 8) | to;
    kl ^= ZLO[zf] ^ ZLO[z]; kh ^= ZHI[zf] ^ ZHI[z];
    psq += PSQ[z] - PSQ[zf];
    if (piece === WP) {
      half = 0;
      pl ^= ZLO[zf] ^ ZLO[z]; ph ^= ZHI[zf] ^ ZHI[z];
      pawnAtt[from + 15]--; pawnAtt[from + 17]--; pawnAtt[to + 15]++; pawnAtt[to + 17]++;
      if (to - from === 32 && (board[to - 1] === BP || board[to + 1] === BP)) epTry = from + 16;
    } else if (piece === BP) {
      half = 0;
      pl ^= ZLO[zf] ^ ZLO[z]; ph ^= ZHI[zf] ^ ZHI[z];
      pawnAtt[256 + from - 15]--; pawnAtt[256 + from - 17]--;
      pawnAtt[256 + to - 15]++; pawnAtt[256 + to - 17]++;
      if (from - to === 32 && (board[to - 1] === WP || board[to + 1] === WP)) epTry = from - 16;
    } else if (m & M_CASTLE) {
      // The rook jumps over the king: h-rook to the f-file, a-rook to the d-file.
      const rook = usBit | ROOK;
      const rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1;
      idx = pindex[rf];
      plist[(rook << 4) | idx] = rt; pindex[rt] = idx; board[rt] = rook; board[rf] = 0;
      const z1 = (rook << 8) | rf, z2 = (rook << 8) | rt;
      kl ^= ZLO[z1] ^ ZLO[z2]; kh ^= ZHI[z1] ^ ZHI[z2];
      psq += PSQ[z2] - PSQ[z1];
    }
  }

  U[s1 + F_KEYLO] = kl; U[s1 + F_KEYHI] = kh;
  U[s1 + F_PAWNLO] = pl; U[s1 + F_PAWNHI] = ph;
  U[s1 + F_PSQ] = psq; U[s1 + F_PHASE] = phase;
  U[s1 + F_CASTLE] = newCastle; U[s1 + F_EP] = 0; U[s1 + F_HALF] = half;
  U[s1 + F_MOVE] = m;
  sp = s1;
  stm = us ^ 1;
  // A double step sets the en-passant square only if the capture is really
  // legal, so that positions which differ in nothing playable hash alike.
  if (epTry !== 0 && epCapturable(epTry)) {
    U[s1 + F_EP] = epTry;
    U[s1 + F_KEYLO] = kl ^ ZEP_LO[epTry & 7];
    U[s1 + F_KEYHI] = kh ^ ZEP_HI[epTry & 7];
  }
}

function unmakeMove(m) {
  const from = m & 255, to = (m >> 8) & 255, piece = (m >> 16) & 31;
  const capt = (m >> 21) & 7, promo = (m >> 24) & 7;
  const s1 = sp;
  sp = s1 - FR;
  const us = stm ^ 1, usBit = 8 << us;
  stm = us;
  let idx, base, last, moved;

  if (promo !== 0) {
    pcount[usBit | promo]--;
    // Put the pawn back into the slot it came from.
    idx = U[s1 + F_PROMOIDX]; base = piece << 4; last = pcount[piece]++;
    if (idx !== last) { moved = plist[base | idx]; plist[base | last] = moved; pindex[moved] = last; }
    plist[base | idx] = from; pindex[from] = idx; board[from] = piece;
    if (us === 0) { pawnAtt[from + 15]++; pawnAtt[from + 17]++; }
    else { pawnAtt[256 + from - 15]++; pawnAtt[256 + from - 17]++; }
  } else {
    idx = pindex[to];
    plist[(piece << 4) | idx] = from; pindex[from] = idx; board[from] = piece;
    if (piece === WP) {
      pawnAtt[from + 15]++; pawnAtt[from + 17]++; pawnAtt[to + 15]--; pawnAtt[to + 17]--;
    } else if (piece === BP) {
      pawnAtt[256 + from - 15]++; pawnAtt[256 + from - 17]++;
      pawnAtt[256 + to - 15]--; pawnAtt[256 + to - 17]--;
    } else if (m & M_CASTLE) {
      const rook = usBit | ROOK;
      const rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1;
      idx = pindex[rt];
      plist[(rook << 4) | idx] = rf; pindex[rf] = idx; board[rf] = rook; board[rt] = 0;
    }
  }

  if (capt !== 0) {
    const cp = capt | (usBit ^ 24);
    let cs = to;
    if (m & M_EP) { cs = us === 0 ? to - 16 : to + 16; board[to] = 0; }
    idx = U[s1 + F_CAPIDX]; base = cp << 4; last = pcount[cp]++;
    if (idx !== last) { moved = plist[base | idx]; plist[base | last] = moved; pindex[moved] = last; }
    plist[base | idx] = cs; pindex[cs] = idx; board[cs] = cp;
    if (capt === PAWN) {
      if (us === 0) { pawnAtt[256 + cs - 15]++; pawnAtt[256 + cs - 17]++; }
      else { pawnAtt[cs + 15]++; pawnAtt[cs + 17]++; }
    }
  } else {
    board[to] = 0;
  }
}

/** Pass the move. Repetition detection never looks back across a null move. */
function makeNull() {
  const s0 = sp, s1 = sp + FR;
  let kl = U[s0 + F_KEYLO] ^ ZSIDE_LO, kh = U[s0 + F_KEYHI] ^ ZSIDE_HI;
  const ep = U[s0 + F_EP];
  if (ep !== 0) { kl ^= ZEP_LO[ep & 7]; kh ^= ZEP_HI[ep & 7]; }
  U[s1 + F_KEYLO] = kl; U[s1 + F_KEYHI] = kh;
  U[s1 + F_PAWNLO] = U[s0 + F_PAWNLO]; U[s1 + F_PAWNHI] = U[s0 + F_PAWNHI];
  U[s1 + F_PSQ] = U[s0 + F_PSQ]; U[s1 + F_PHASE] = U[s0 + F_PHASE];
  U[s1 + F_CASTLE] = U[s0 + F_CASTLE]; U[s1 + F_EP] = 0; U[s1 + F_HALF] = 0;
  U[s1 + F_MOVE] = 0;
  sp = s1;
  stm ^= 1;
}

function unmakeNull() {
  sp -= FR;
  stm ^= 1;
}

// ---------------------------------------------------------------------------
// Move generation (pseudo-legal; isLegal() decides before a move is made)
// ---------------------------------------------------------------------------

function addPromotions(n, mv) {
  mlist[n] = mv | (QUEEN << 24);
  mlist[n + 1] = mv | (KNIGHT << 24);
  mlist[n + 2] = mv | (ROOK << 24);
  mlist[n + 3] = mv | (BISHOP << 24);
  return n + 4;
}

/** Captures, en passant and every promotion, written from mlist[n]; returns the new end. */
function genNoisy(n) {
  const us = stm, usBit = 8 << us, themBit = usBit ^ 24;
  const ep = U[sp + F_EP];
  let i, k, from, to, p, mv, cnt, base, piece, step;

  if (us === 0) {
    cnt = pcount[WP];
    for (i = 0; i < cnt; i++) {
      from = plist[(WP << 4) | i];
      mv = from | (WP << 16);
      if (from >= RANK_7) {
        to = from + 16;
        if (board[to] === 0) n = addPromotions(n, mv | (to << 8));
        to = from + 15; p = board[to];
        if (p & BBIT) n = addPromotions(n, mv | (to << 8) | ((p & 7) << 21));
        to = from + 17; p = board[to];
        if (p & BBIT) n = addPromotions(n, mv | (to << 8) | ((p & 7) << 21));
      } else {
        to = from + 15; p = board[to];
        if (p & BBIT) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
        else if (to === ep) mlist[n++] = mv | (to << 8) | (PAWN << 21) | M_EP;
        to = from + 17; p = board[to];
        if (p & BBIT) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
        else if (to === ep) mlist[n++] = mv | (to << 8) | (PAWN << 21) | M_EP;
      }
    }
  } else {
    cnt = pcount[BP];
    for (i = 0; i < cnt; i++) {
      from = plist[(BP << 4) | i];
      mv = from | (BP << 16);
      if (from < RANK_3) {
        to = from - 16;
        if (board[to] === 0) n = addPromotions(n, mv | (to << 8));
        to = from - 15; p = board[to];
        if (p & WBIT) n = addPromotions(n, mv | (to << 8) | ((p & 7) << 21));
        to = from - 17; p = board[to];
        if (p & WBIT) n = addPromotions(n, mv | (to << 8) | ((p & 7) << 21));
      } else {
        to = from - 15; p = board[to];
        if (p & WBIT) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
        else if (to === ep) mlist[n++] = mv | (to << 8) | (PAWN << 21) | M_EP;
        to = from - 17; p = board[to];
        if (p & WBIT) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
        else if (to === ep) mlist[n++] = mv | (to << 8) | (PAWN << 21) | M_EP;
      }
    }
  }

  piece = usBit | KNIGHT; base = piece << 4; cnt = pcount[piece];
  for (i = 0; i < cnt; i++) {
    from = plist[base | i];
    mv = from | (piece << 16);
    for (k = 0; k < 8; k++) {
      to = from + KNIGHT_STEPS[k]; p = board[to];
      if (p & themBit) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
    }
  }
  piece = usBit | BISHOP; base = piece << 4; cnt = pcount[piece];
  for (i = 0; i < cnt; i++) {
    from = plist[base | i];
    mv = from | (piece << 16);
    for (k = 0; k < 4; k++) {
      step = BISHOP_STEPS[k];
      for (to = from + step; (p = board[to]) === 0; to += step);
      if (p & themBit) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
    }
  }
  piece = usBit | ROOK; base = piece << 4; cnt = pcount[piece];
  for (i = 0; i < cnt; i++) {
    from = plist[base | i];
    mv = from | (piece << 16);
    for (k = 0; k < 4; k++) {
      step = ROOK_STEPS[k];
      for (to = from + step; (p = board[to]) === 0; to += step);
      if (p & themBit) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
    }
  }
  piece = usBit | QUEEN; base = piece << 4; cnt = pcount[piece];
  for (i = 0; i < cnt; i++) {
    from = plist[base | i];
    mv = from | (piece << 16);
    for (k = 0; k < 8; k++) {
      step = QUEEN_STEPS[k];
      for (to = from + step; (p = board[to]) === 0; to += step);
      if (p & themBit) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
    }
  }
  piece = usBit | KING;
  from = plist[piece << 4];
  mv = from | (piece << 16);
  for (k = 0; k < 8; k++) {
    to = from + QUEEN_STEPS[k]; p = board[to];
    if (p & themBit) mlist[n++] = mv | (to << 8) | ((p & 7) << 21);
  }
  return n;
}

/** Moves that neither capture nor promote, written from mlist[n]; returns the new end. */
function genQuiets(n, inCheck) {
  const us = stm, usBit = 8 << us;
  let i, k, from, to, mv, cnt, base, piece, step;

  if (us === 0) {
    cnt = pcount[WP];
    for (i = 0; i < cnt; i++) {
      from = plist[(WP << 4) | i];
      if (from >= RANK_7) continue;
      to = from + 16;
      if (board[to] === 0) {
        mlist[n++] = from | (to << 8) | (WP << 16);
        if (from < RANK_3 && board[to + 16] === 0) mlist[n++] = from | ((to + 16) << 8) | (WP << 16);
      }
    }
    if (!inCheck) {
      // Castling is generated fully legal: the king may not pass over an attacked square.
      const castle = U[sp + F_CASTLE];
      if ((castle & 1) && board[F1] === 0 && board[G1] === 0 && !attacked(F1, 1) && !attacked(G1, 1)) {
        mlist[n++] = E1 | (G1 << 8) | (WK << 16) | M_CASTLE;
      }
      if ((castle & 2) && board[D1] === 0 && board[C1] === 0 && board[B1] === 0
          && !attacked(D1, 1) && !attacked(C1, 1)) {
        mlist[n++] = E1 | (C1 << 8) | (WK << 16) | M_CASTLE;
      }
    }
  } else {
    cnt = pcount[BP];
    for (i = 0; i < cnt; i++) {
      from = plist[(BP << 4) | i];
      if (from < RANK_3) continue;
      to = from - 16;
      if (board[to] === 0) {
        mlist[n++] = from | (to << 8) | (BP << 16);
        if (from >= RANK_7 && board[to - 16] === 0) mlist[n++] = from | ((to - 16) << 8) | (BP << 16);
      }
    }
    if (!inCheck) {
      const castle = U[sp + F_CASTLE];
      if ((castle & 4) && board[F8] === 0 && board[G8] === 0 && !attacked(F8, 0) && !attacked(G8, 0)) {
        mlist[n++] = E8 | (G8 << 8) | (BK << 16) | M_CASTLE;
      }
      if ((castle & 8) && board[D8] === 0 && board[C8] === 0 && board[B8] === 0
          && !attacked(D8, 0) && !attacked(C8, 0)) {
        mlist[n++] = E8 | (C8 << 8) | (BK << 16) | M_CASTLE;
      }
    }
  }

  piece = usBit | KNIGHT; base = piece << 4; cnt = pcount[piece];
  for (i = 0; i < cnt; i++) {
    from = plist[base | i];
    mv = from | (piece << 16);
    for (k = 0; k < 8; k++) {
      to = from + KNIGHT_STEPS[k];
      if (board[to] === 0) mlist[n++] = mv | (to << 8);
    }
  }
  piece = usBit | BISHOP; base = piece << 4; cnt = pcount[piece];
  for (i = 0; i < cnt; i++) {
    from = plist[base | i];
    mv = from | (piece << 16);
    for (k = 0; k < 4; k++) {
      step = BISHOP_STEPS[k];
      for (to = from + step; board[to] === 0; to += step) mlist[n++] = mv | (to << 8);
    }
  }
  piece = usBit | ROOK; base = piece << 4; cnt = pcount[piece];
  for (i = 0; i < cnt; i++) {
    from = plist[base | i];
    mv = from | (piece << 16);
    for (k = 0; k < 4; k++) {
      step = ROOK_STEPS[k];
      for (to = from + step; board[to] === 0; to += step) mlist[n++] = mv | (to << 8);
    }
  }
  piece = usBit | QUEEN; base = piece << 4; cnt = pcount[piece];
  for (i = 0; i < cnt; i++) {
    from = plist[base | i];
    mv = from | (piece << 16);
    for (k = 0; k < 8; k++) {
      step = QUEEN_STEPS[k];
      for (to = from + step; board[to] === 0; to += step) mlist[n++] = mv | (to << 8);
    }
  }
  piece = usBit | KING;
  from = plist[piece << 4];
  mv = from | (piece << 16);
  for (k = 0; k < 8; k++) {
    to = from + QUEEN_STEPS[k];
    if (board[to] === 0) mlist[n++] = mv | (to << 8);
  }
  return n;
}

/**
 * Is the pseudo-legal move `m` legal? `checker` is findChecker() for this
 * position. Nothing is moved on the board except for the two rare cases that
 * need it (king steps and en passant).
 */
function isLegal(m, checker) {
  const from = m & 255, to = (m >> 8) & 255;
  const us = stm;
  const ksq = plist[KING_SLOT + (us << 7)];
  if (from === ksq) {
    if (m & M_CASTLE) return true;
    // Lift the king so that a slider checking it also covers the square behind.
    const king = board[from];
    board[from] = 0;
    const unsafe = attacked(to, us ^ 1);
    board[from] = king;
    return !unsafe;
  }
  if (m & M_EP) return epLegalFrom(from, to);
  let step;
  if (checker !== 0) {
    if (checker === 255) return false;
    if (to !== checker) {
      // Not a capture of the checking piece: the move must land between it and the king.
      step = DIR[to - ksq + 119];
      if (step === 0 || step !== DIR[checker - ksq + 119]) return false;
      if (step > 0 ? to > checker : to < checker) return false;
    }
  }
  // A piece on a line with its king may be pinned.
  step = DIR[from - ksq + 119];
  if (step === 0 || step === DIR[to - ksq + 119]) return true;   // not on a line, or moving along it
  let s = ksq + step;
  while (s !== from) {
    if (board[s] !== 0) return true;
    s += step;
  }
  let p;
  for (s = from + step; (p = board[s]) === 0; s += step);
  if ((p & (16 >> us)) === 0) return true;
  return (PATT[p] & ATT[step + 119] & A_SLIDE) === 0;
}

/** Counts the leaf nodes of the legal move tree to `depth`. */
function perftCount(depth, ply) {
  const checker = findChecker();
  const first = ply << 8;
  const end = genQuiets(genNoisy(first), checker !== 0);
  let count = 0;
  for (let i = first; i < end; i++) {
    const m = mlist[i];
    if (!isLegal(m, checker)) continue;
    if (depth <= 1) count++;
    else {
      makeMove(m);
      count += perftCount(depth - 1, ply + 1);
      unmakeMove(m);
    }
  }
  return count;
}

/** Is there any legal move? (`checker` is findChecker() for this position.) */
function anyLegalMove(checker) {
  const first = (MAX_PLY - 1) << 8;
  const end = genQuiets(genNoisy(first), checker !== 0);
  for (let i = first; i < end; i++) if (isLegal(mlist[i], checker)) return true;
  return false;
}

/**
 * Could `m` have been generated in this position? Used for moves remembered
 * from elsewhere (the hash table): `m` is always a move the generator once
 * produced, so only what depends on the present board has to be checked.
 */
function isPseudoLegal(m) {
  const from = m & 255, to = (m >> 8) & 255, piece = (m >> 16) & 31, capt = (m >> 21) & 7;
  const us = stm, usBit = 8 << us;
  if (board[from] !== piece || (piece & usBit) === 0) return false;
  if (m & M_EP) return to === U[sp + F_EP];
  const target = board[to];
  if (capt !== 0) {
    if (target !== (capt | (usBit ^ 24))) return false;
  } else if (target !== 0) return false;
  const type = piece & 7;
  if (type === PAWN) {
    if (capt !== 0) return true;
    const d = to - from;
    return d === 16 || d === -16 || board[(from + to) >> 1] === 0;
  }
  if (type === KNIGHT) return true;
  if (type === KING) {
    if ((m & M_CASTLE) === 0) return true;
    const them = us ^ 1;
    const right = to > from ? (us === 0 ? 1 : 4) : (us === 0 ? 2 : 8);
    if ((U[sp + F_CASTLE] & right) === 0 || attacked(from, them)) return false;
    if (to > from) return board[from + 1] === 0 && !attacked(from + 1, them) && !attacked(to, them);
    return board[from - 1] === 0 && board[from - 3] === 0 && !attacked(from - 1, them) && !attacked(to, them);
  }
  const step = DIR[to - from + 119];
  if (step === 0) return false;
  for (let s = from + step; s !== to; s += step) if (board[s] !== 0) return false;
  return true;
}

/** Does the legal move `m` (not yet made) give check? */
function givesCheck(m) {
  const from = m & 255, to = (m >> 8) & 255;
  const us = stm;
  const ek = plist[KING_SLOT + ((us ^ 1) << 7)];
  if (m & (M_EP | M_CASTLE)) {
    // Two pieces leave or change their lines at once: just make the move and look.
    makeMove(m);
    const check = attacked(ek, us);
    unmakeMove(m);
    return check;
  }
  let piece = (m >> 16) & 31;
  const promo = (m >> 24) & 7;
  if (promo !== 0) piece = (piece & 24) | promo;
  let step, s, p;
  // Direct check from the square the piece arrives on.
  const d = ek - to + 119;
  const a = ATT[d] & PATT[piece];
  if (a !== 0) {
    if ((a & A_SLIDE) === 0) return (a & A_K) === 0;      // knight or pawn (a king never checks)
    step = DIR[d];
    // The square the piece leaves counts as empty (a promoting pawn's own file).
    for (s = to + step; s !== ek && (board[s] === 0 || s === from); s += step);
    if (s === ek) return true;
  }
  // Discovered check: the piece leaves a line between one of our sliders and their king.
  step = DIR[from - ek + 119];
  if (step !== 0 && step !== DIR[to - ek + 119]) {
    for (s = ek + step; board[s] === 0; s += step);
    if (s === from) {
      for (s += step; (p = board[s]) === 0; s += step);
      if ((p & (8 << us)) !== 0 && (PATT[p] & ATT[step + 119] & A_SLIDE) !== 0) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Static exchange evaluation
// ---------------------------------------------------------------------------

const SEE_VALUE = new Int32Array([0, 100, 320, 330, 500, 950, 20000, 0]);
const seeGain = new Int32Array(40);
/** First occupied (or EDGE) square from the target along each of QUEEN_STEPS. */
const seeHead = new Uint8Array(8);
const seeKnights = new Int32Array(2);
let seeValue = 0;

/**
 * The least valuable piece of `side` that attacks `to`, given the ray heads:
 * returns 0..7 for the piece heading that ray, 8 for a knight, -1 for none,
 * and leaves its value in seeValue.
 */
function seePick(side, to) {
  const bit = 8 << side;
  let bestK = -1, bestV = 100000, k, s, p, t, v;
  for (k = 0; k < 8; k++) {
    s = seeHead[k];
    p = board[s];
    if ((p & bit) === 0) continue;
    t = p & 7;
    if (t === QUEEN || (t === ROOK && k < 4) || (t === BISHOP && k >= 4)) v = SEE_VALUE[t];
    else if (t === KING) {
      if (DIST[s - to + 119] !== 1) continue;
      v = SEE_VALUE[KING];
    } else if (t === PAWN) {
      // A pawn attacks from one step diagonally behind the square, seen from its own side.
      if (side === 0 ? (s !== to - 15 && s !== to - 17) : (s !== to + 15 && s !== to + 17)) continue;
      v = SEE_VALUE[PAWN];
    } else continue;
    if (v < bestV) { bestV = v; bestK = k; }
  }
  if (seeKnights[side] > 0 && SEE_VALUE[KNIGHT] < bestV) { bestV = SEE_VALUE[KNIGHT]; bestK = 8; }
  seeValue = bestV;
  return bestK;
}

/**
 * Material the side to move wins (or loses) by playing `m`, once the
 * exchanges on its target square are played out with the least valuable
 * attacker each time and either side free to stop. Pins are ignored.
 */
function see(m) {
  const from = m & 255, to = (m >> 8) & 255;
  const piece = (m >> 16) & 31, capt = (m >> 21) & 7, promo = (m >> 24) & 7;
  let side = stm ^ 1;
  let onSquare = SEE_VALUE[piece & 7];          // what the next capture would win
  let gain = SEE_VALUE[capt];
  if (promo !== 0) { gain += SEE_VALUE[promo] - SEE_VALUE[PAWN]; onSquare = SEE_VALUE[promo]; }
  seeGain[0] = gain;

  // While the exchange is worked out the mover is off its square, so that
  // whatever stood behind it joins in.
  board[from] = 0;
  let epSquare = 0;
  if (m & M_EP) { epSquare = stm === 0 ? to - 16 : to + 16; board[epSquare] = 0; }
  let k, s, step, i, base;
  for (k = 0; k < 8; k++) {
    step = QUEEN_STEPS[k];
    for (s = to + step; board[s] === 0; s += step);
    seeHead[k] = s;
  }
  let n = 0;
  base = WN << 4;
  for (i = pcount[WN] - 1; i >= 0; i--) {
    s = plist[base | i];
    if (s !== from && (ATT[to - s + 119] & A_N)) n++;
  }
  seeKnights[0] = n;
  n = 0;
  base = BN << 4;
  for (i = pcount[BN] - 1; i >= 0; i--) {
    s = plist[base | i];
    if (s !== from && (ATT[to - s + 119] & A_N)) n++;
  }
  seeKnights[1] = n;

  let d = 0;
  for (;;) {
    k = seePick(side, to);
    if (k < 0) break;
    const v = seeValue;
    // A king may only recapture when nothing covers the square any more.
    if (v === SEE_VALUE[KING] && seePick(side ^ 1, to) >= 0) break;
    d++;
    seeGain[d] = onSquare - seeGain[d - 1];
    onSquare = v;
    if (k === 8) seeKnights[side]--;
    else {
      // The piece behind the one that captured now bears on the square.
      step = QUEEN_STEPS[k];
      for (s = seeHead[k] + step; board[s] === 0; s += step);
      seeHead[k] = s;
    }
    side ^= 1;
  }
  board[from] = piece;
  if (epSquare !== 0) board[epSquare] = (16 >> stm) | PAWN;

  // Each side stops capturing where going on would lose material.
  for (; d > 0; d--) {
    if (seeGain[d] > -seeGain[d - 1]) seeGain[d - 1] = -seeGain[d];
  }
  return seeGain[0];
}

/** see(m) >= threshold, answered without the full exchange where that is obvious. */
function seeGE(m, threshold) {
  if ((m & (M_PROMO | M_EP | M_CASTLE)) === 0) {
    const balance = SEE_VALUE[(m >> 21) & 7] - threshold;
    if (balance < 0) return false;                         // even winning the piece for free is too little
    const mover = SEE_VALUE[(m >> 16) & 7];
    if (balance - mover >= 0) return true;                 // even losing the mover is enough
    // A pawn recaptures: at best we get that pawn back afterwards.
    if (balance - mover + SEE_VALUE[PAWN] < 0 && pawnAtt[(stm === 0 ? 256 : 0) + ((m >> 8) & 255)] !== 0) return false;
  }
  return see(m) >= threshold;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
//
// Tapered: every term has a middlegame and an endgame value, blended by the
// material left. Material and piece-square values are kept up to date move by
// move (F_PSQ); pawn structure and king shelter are cached by pawn placement;
// mobility and king attacks are counted on the board each time.
// Everything is computed as White minus Black with the same code for both
// sides and rounded towards zero, so a position and its mirror image score
// exactly the same for the side to move.

const TEMPO = 14;
const BISHOP_PAIR = S(24, 42);
const ROOK_OPEN_FILE = S(24, 8);
const ROOK_SEMI_OPEN_FILE = S(11, 5);

const PAWN_DOUBLED = S(-9, -20);
const PAWN_ISOLATED = S(-9, -12);          // an enemy pawn stands in front of it
const PAWN_ISOLATED_OPEN = S(-17, -15);    // on a half-open file: a target for rooks
const PAWN_BACKWARD = S(-6, -9);
const PAWN_BACKWARD_OPEN = S(-14, -11);
/** Pawns defended by or standing beside a pawn, by rank reached (0 = own back rank). */
const PAWN_CONNECTED = new Int32Array([0, S(2, 0), S(5, 2), S(8, 5), S(14, 10), S(26, 20), S(45, 34), 0]);
/** Passed pawns, by rank reached. The piece-square tables already pay for advancing. */
const PAWN_PASSED = new Int32Array([0, S(0, 6), S(0, 10), S(5, 22), S(15, 40), S(30, 70), S(50, 100), 0]);
/** How much the kings' distances to the square in front of a passed pawn matter, by rank reached. */
const PASSED_KING_WEIGHT = new Int32Array([0, 0, 0, 1, 2, 4, 6, 0]);
const PASSED_FREE = new Int32Array([0, 0, 0, 2, 6, 14, 28, 0]);    // endgame bonus when that square is empty

/** Mobility: packed bonus by number of squares a piece can safely go to. */
const KNIGHT_MOBILITY = new Int32Array(9);
const BISHOP_MOBILITY = new Int32Array(14);
const ROOK_MOBILITY = new Int32Array(15);
const QUEEN_MOBILITY = new Int32Array(28);
for (let n = 0; n < 28; n++) {
  // Logarithmic: the first squares matter most. Zero at a typical count.
  if (n < 9) KNIGHT_MOBILITY[n] = S(Math.round(20 * Math.log((n + 1) / 4.5)), Math.round(18 * Math.log((n + 1) / 4.5)));
  if (n < 14) BISHOP_MOBILITY[n] = S(Math.round(21 * Math.log((n + 1) / 6.5)), Math.round(20 * Math.log((n + 1) / 6.5)));
  if (n < 15) ROOK_MOBILITY[n] = S(Math.round(12 * Math.log((n + 1) / 7)), Math.round(25 * Math.log((n + 1) / 7)));
  QUEEN_MOBILITY[n] = S(Math.round(8 * Math.log((n + 1) / 13)), Math.round(16 * Math.log((n + 1) / 13)));
}

// King safety (middlegame only).
/** Own pawn on a file by the king, by how many ranks in front of the king it stands (0 = none). */
const SHELTER_PAWN = new Int32Array([-24, 12, 5, -5, -11, -14, -14, -14]);
/** Nearest enemy pawn on such a file, by the same distance (0 = none). */
const STORM_PAWN = new Int32Array([0, -4, -20, -11, -4, 0, 0, 0]);
const SHELTER_OPEN_FILE = -9;              // neither side has a pawn on the file
const KING_ATTACK_WEIGHT = new Int32Array([0, 0, 2, 2, 3, 5, 0, 0]);   // by attacking piece type
/** Penalty by attack units once at least two pieces bear on the king's zone. */
const KING_DANGER = new Int32Array(64);
for (let n = 0; n < 64; n++) KING_DANGER[n] = Math.min(n * n, 420);

/** The zone around a king: KING_ZONE[colour << 8 | (sq - kingSq + 119)]. Neighbours plus one rank further forward. */
const KING_ZONE = new Uint8Array(512);
for (let dr = -2; dr <= 2; dr++) {
  for (let df = -1; df <= 1; df++) {
    const d = 119 + dr * 16 + df;
    if (dr >= -1 && dr <= 2) KING_ZONE[d] = 1;           // White king: one rank further up the board
    if (dr >= -2 && dr <= 1) KING_ZONE[256 + d] = 1;
  }
}

/** Distance from the centre (0..6): how far a lone king has been driven back. */
const CENTRE_DISTANCE = new Uint8Array(256);
for (let s = 0; s < 64; s++) {
  const f = s & 7, r = s >> 3;
  CENTRE_DISTANCE[SQ256[s]] = Math.max(3 - f, f - 4) + Math.max(3 - r, r - 4);
}

// Pawn hash: entry = [pawn key lo, hi, packed score, passed pawns lo, hi,
// files with white pawns | files with black pawns << 8, king squares, shelter].
const PAWN_HASH_SIZE = 1 << 13;
const pawnHash = new Int32Array(PAWN_HASH_SIZE * 8);

const pawnCountW = new Uint8Array(10), pawnCountB = new Uint8Array(10);   // per file, index file + 1
const pawnMinW = new Uint8Array(10), pawnMaxW = new Uint8Array(10);       // rearmost / foremost rank per file
const pawnMinB = new Uint8Array(10), pawnMaxB = new Uint8Array(10);

/** Works out the pawn structure and writes pawn hash entry `e`. */
function evalPawns(e, keyLo, keyHi) {
  pawnCountW.fill(0); pawnCountB.fill(0);
  pawnMinW.fill(8); pawnMaxW.fill(0); pawnMinB.fill(8); pawnMaxB.fill(0);
  const nw = pcount[WP], nb = pcount[BP];
  let i, s, f, r, filesW = 0, filesB = 0;
  for (i = 0; i < nw; i++) {
    s = plist[(WP << 4) | i]; f = (s & 7) + 1; r = (s >> 4) - 4;
    pawnCountW[f]++; filesW |= 1 << (f - 1);
    if (r < pawnMinW[f]) pawnMinW[f] = r;
    if (r > pawnMaxW[f]) pawnMaxW[f] = r;
  }
  for (i = 0; i < nb; i++) {
    s = plist[(BP << 4) | i]; f = (s & 7) + 1; r = (s >> 4) - 4;
    pawnCountB[f]++; filesB |= 1 << (f - 1);
    if (r < pawnMinB[f]) pawnMinB[f] = r;
    if (r > pawnMaxB[f]) pawnMaxB[f] = r;
  }
  let score = 0, passedLo = 0, passedHi = 0, opposed, connected, b;
  for (i = 0; i < nw; i++) {
    s = plist[(WP << 4) | i]; f = (s & 7) + 1; r = (s >> 4) - 4;
    opposed = pawnMaxB[f] > r;
    connected = board[s - 15] === WP || board[s - 17] === WP || board[s - 1] === WP || board[s + 1] === WP;
    if (pawnMaxW[f] > r) score += PAWN_DOUBLED;
    if (pawnCountW[f - 1] === 0 && pawnCountW[f + 1] === 0) score += opposed ? PAWN_ISOLATED : PAWN_ISOLATED_OPEN;
    else if (!connected && pawnMinW[f - 1] > r && pawnMinW[f + 1] > r
             && (pawnAtt[256 + s + 16] !== 0 || board[s + 16] === BP)) {
      // Backward: its neighbours have gone ahead and it cannot safely follow.
      score += opposed ? PAWN_BACKWARD : PAWN_BACKWARD_OPEN;
    }
    if (connected) score += PAWN_CONNECTED[r];
    if (pawnMaxB[f - 1] <= r && pawnMaxB[f] <= r && pawnMaxB[f + 1] <= r && pawnMaxW[f] === r) {
      score += PAWN_PASSED[r];
      b = SQ64[s];
      if (b < 32) passedLo |= 1 << b; else passedHi |= 1 << (b - 32);
    }
  }
  for (i = 0; i < nb; i++) {
    s = plist[(BP << 4) | i]; f = (s & 7) + 1; r = (s >> 4) - 4;
    opposed = pawnMinW[f] < r;
    connected = board[s + 15] === BP || board[s + 17] === BP || board[s - 1] === BP || board[s + 1] === BP;
    if (pawnMinB[f] < r) score -= PAWN_DOUBLED;
    if (pawnCountB[f - 1] === 0 && pawnCountB[f + 1] === 0) score -= opposed ? PAWN_ISOLATED : PAWN_ISOLATED_OPEN;
    else if (!connected && pawnMaxB[f - 1] < r && pawnMaxB[f + 1] < r
             && (pawnAtt[s - 16] !== 0 || board[s - 16] === WP)) {
      score -= opposed ? PAWN_BACKWARD : PAWN_BACKWARD_OPEN;
    }
    if (connected) score -= PAWN_CONNECTED[7 - r];
    if (pawnMinW[f - 1] >= r && pawnMinW[f] >= r && pawnMinW[f + 1] >= r && pawnMinB[f] === r) {
      score -= PAWN_PASSED[7 - r];
      b = SQ64[s];
      if (b < 32) passedLo |= 1 << b; else passedHi |= 1 << (b - 32);
    }
  }
  pawnHash[e] = keyLo; pawnHash[e + 1] = keyHi; pawnHash[e + 2] = score;
  pawnHash[e + 3] = passedLo; pawnHash[e + 4] = passedHi;
  pawnHash[e + 5] = filesW | (filesB << 8);
  pawnHash[e + 6] = 0; pawnHash[e + 7] = 0;
}

/** Middlegame value of the pawns in front of the king of `us` on `ksq` (and of the enemy pawns coming at it). */
function kingShelter(us, ksq) {
  const file = ksq & 7;
  const centre = file === 0 ? 1 : file === 7 ? 6 : file;
  const up = us === 0 ? 16 : -16;
  const own = (8 << us) | PAWN, their = (16 >> us) | PAWN;
  const row = ksq & 0xF0;
  let value = 0;
  for (let f = centre - 1; f <= centre + 1; f++) {
    let dOwn = 0, dTheir = 0, d = 1, p;
    for (let s = row + f + up; (p = board[s]) !== EDGE; s += up, d++) {
      if (p === own) { if (dOwn === 0) dOwn = d; }
      else if (p === their) { if (dTheir === 0) dTheir = d; }
    }
    value += SHELTER_PAWN[dOwn] + STORM_PAWN[dTheir];
    if (dOwn === 0 && dTheir === 0) value += SHELTER_OPEN_FILE;
  }
  return value;
}

/** What the pieces of `us` attack around the enemy king: [pieces, weight, squares] at index us * 4. */
const kingAttack = new Int32Array(8);

/** Mobility and placement of the knights, bishops, rooks and queens of `us` (packed score). */
function evalPieces(us, ownFiles, theirFiles) {
  const usBit = 8 << us, themBit = usBit ^ 24;
  const pa = us === 0 ? 256 : 0;                         // the enemy's pawn attack map
  const ek = plist[KING_SLOT + ((us ^ 1) << 7)];
  const zone = ((us ^ 1) << 8) + 119 - ek;               // KING_ZONE[zone + sq]
  let score = 0, attackers = 0, weight = 0, squares = 0;
  let i, k, from, t, p, step, mob, att, piece, base;

  piece = usBit | KNIGHT; base = piece << 4;
  for (i = pcount[piece] - 1; i >= 0; i--) {
    from = plist[base | i];
    mob = 0; att = 0;
    for (k = 0; k < 8; k++) {
      t = from + KNIGHT_STEPS[k]; p = board[t];
      if (p === 0) { if (pawnAtt[pa + t] === 0) mob++; att += KING_ZONE[zone + t]; }
      else if (p & themBit) { mob++; att += KING_ZONE[zone + t]; }
    }
    score += KNIGHT_MOBILITY[mob];
    if (att !== 0) { attackers++; weight += KING_ATTACK_WEIGHT[KNIGHT]; squares += att; }
  }

  piece = usBit | BISHOP; base = piece << 4;
  if (pcount[piece] >= 2) score += BISHOP_PAIR;
  for (i = pcount[piece] - 1; i >= 0; i--) {
    from = plist[base | i];
    mob = 0; att = 0;
    for (k = 0; k < 4; k++) {
      step = BISHOP_STEPS[k];
      for (t = from + step; (p = board[t]) === 0; t += step) {
        if (pawnAtt[pa + t] === 0) mob++;
        att += KING_ZONE[zone + t];
      }
      if (p & themBit) { mob++; att += KING_ZONE[zone + t]; }
    }
    score += BISHOP_MOBILITY[mob];
    if (att !== 0) { attackers++; weight += KING_ATTACK_WEIGHT[BISHOP]; squares += att; }
  }

  piece = usBit | ROOK; base = piece << 4;
  for (i = pcount[piece] - 1; i >= 0; i--) {
    from = plist[base | i];
    mob = 0; att = 0;
    for (k = 0; k < 4; k++) {
      step = ROOK_STEPS[k];
      for (t = from + step; (p = board[t]) === 0; t += step) {
        if (pawnAtt[pa + t] === 0) mob++;
        att += KING_ZONE[zone + t];
      }
      if (p & themBit) { mob++; att += KING_ZONE[zone + t]; }
    }
    score += ROOK_MOBILITY[mob];
    k = 1 << (from & 7);
    if ((ownFiles & k) === 0) score += (theirFiles & k) === 0 ? ROOK_OPEN_FILE : ROOK_SEMI_OPEN_FILE;
    if (att !== 0) { attackers++; weight += KING_ATTACK_WEIGHT[ROOK]; squares += att; }
  }

  piece = usBit | QUEEN; base = piece << 4;
  for (i = pcount[piece] - 1; i >= 0; i--) {
    from = plist[base | i];
    mob = 0; att = 0;
    for (k = 0; k < 8; k++) {
      step = QUEEN_STEPS[k];
      for (t = from + step; (p = board[t]) === 0; t += step) {
        if (pawnAtt[pa + t] === 0) mob++;
        att += KING_ZONE[zone + t];
      }
      if (p & themBit) { mob++; att += KING_ZONE[zone + t]; }
    }
    score += QUEEN_MOBILITY[mob];
    if (att !== 0) { attackers++; weight += KING_ATTACK_WEIGHT[QUEEN]; squares += att; }
  }

  kingAttack[us << 2] = attackers;
  kingAttack[(us << 2) | 1] = weight;
  kingAttack[(us << 2) | 2] = squares;
  return score;
}

/** Passed pawns: the race between the kings and whether the way ahead is clear (endgame points, White's view). */
function evalPassed(lo, hi, wk, bk) {
  let eg = 0, bb, bit, s, r, stop, w, half;
  for (half = 0; half < 2; half++) {
    bb = half === 0 ? lo : hi;
    while (bb !== 0) {
      bit = bb & -bb;
      bb ^= bit;
      s = SQ256[(half << 5) + 31 - Math.clz32(bit)];
      if (board[s] === WP) {
        r = (s >> 4) - 4;
        w = PASSED_KING_WEIGHT[r];
        if (w !== 0) {
          stop = s + 16;
          eg += (Math.min(DIST[bk - stop + 119], 5) * 5 - Math.min(DIST[wk - stop + 119], 5) * 2) * w;
          if (board[stop] === 0) eg += PASSED_FREE[r];
        }
      } else {
        r = 11 - (s >> 4);
        w = PASSED_KING_WEIGHT[r];
        if (w !== 0) {
          stop = s - 16;
          eg -= (Math.min(DIST[wk - stop + 119], 5) * 5 - Math.min(DIST[bk - stop + 119], 5) * 2) * w;
          if (board[stop] === 0) eg -= PASSED_FREE[r];
        }
      }
    }
  }
  return eg;
}

/** Static evaluation in centipawns from the point of view of the side to move. */
function evaluate() {
  const s = sp;
  const keyLo = U[s + F_PAWNLO], keyHi = U[s + F_PAWNHI];
  const e = (keyLo & (PAWN_HASH_SIZE - 1)) << 3;
  if (pawnHash[e] !== keyLo || pawnHash[e + 1] !== keyHi) evalPawns(e, keyLo, keyHi);
  const wk = plist[KING_SLOT], bk = plist[KING_SLOT + 128];
  const kings = wk | (bk << 8);
  if (pawnHash[e + 6] !== kings) {
    pawnHash[e + 6] = kings;
    pawnHash[e + 7] = kingShelter(0, wk) - kingShelter(1, bk);
  }
  const files = pawnHash[e + 5];
  const score = U[s + F_PSQ] + pawnHash[e + 2]
    + evalPieces(0, files & 255, files >> 8) - evalPieces(1, files >> 8, files & 255);
  let eg = (score << 16) >> 16;
  let mg = (score - eg) >> 16;
  if ((pawnHash[e + 3] | pawnHash[e + 4]) !== 0) eg += evalPassed(pawnHash[e + 3], pawnHash[e + 4], wk, bk);

  // King safety: the shelter, and the enemy pieces bearing on the king's zone.
  let phase = U[s + F_PHASE];
  mg += pawnHash[e + 7];
  let units;
  if (kingAttack[0] >= 2) {                      // White attacks the black king
    units = kingAttack[1] + (kingAttack[2] >> 1);
    mg += pcount[WQ] !== 0 ? KING_DANGER[units > 63 ? 63 : units] : KING_DANGER[units > 63 ? 63 : units] >> 1;
  }
  if (kingAttack[4] >= 2) {
    units = kingAttack[5] + (kingAttack[6] >> 1);
    mg -= pcount[BQ] !== 0 ? KING_DANGER[units > 63 ? 63 : units] : KING_DANGER[units > 63 ? 63 : units] >> 1;
  }

  if (phase > MAX_PHASE) phase = MAX_PHASE;
  let value = ((mg * phase + eg * (MAX_PHASE - phase)) / MAX_PHASE) | 0;
  if (phase <= 8 && value !== 0) value = endgameAdjust(value, wk, bk);
  return (stm === 0 ? value : 0 - value) + TEMPO;
}

/**
 * Endgame knowledge applied to a blended score `value` (White's view):
 * endings that cannot be won are scaled towards zero, and a bare king is
 * driven to the edge (to the right corner with bishop and knight).
 */
function endgameAdjust(value, wk, bk) {
  const strong = value > 0 ? 0 : 1;
  const sBit = 8 << strong, wBit = sBit ^ 24;
  const sMinors = pcount[sBit | KNIGHT] + pcount[sBit | BISHOP];
  const sMajors = pcount[sBit | ROOK] * 2 + pcount[sBit | QUEEN] * 4;
  const wPieces = pcount[wBit | KNIGHT] + pcount[wBit | BISHOP] + pcount[wBit | ROOK] * 2 + pcount[wBit | QUEEN] * 4;
  const sPawns = pcount[sBit | PAWN], wPawns = pcount[wBit | PAWN];
  if (sPawns === 0) {
    const sPieces = sMinors + sMajors;
    if (sPieces <= 1) return wPawns === 0 ? 0 : (value / 16) | 0;        // a lone minor piece cannot win
    if (sPieces - wPieces < 2) return (value / 8) | 0;                   // less than a rook ahead without pawns
    if (sPieces === 2 && pcount[sBit | KNIGHT] === 2 && wPieces === 0) {
      return wPawns === 0 ? 0 : (value / 16) | 0;                        // two knights cannot force mate
    }
  } else if (sMajors === 0 && sMinors === 1 && wPieces === 1 && pcount[sBit | BISHOP] === 1
             && pcount[wBit | BISHOP] === 1 && pcount[WN] + pcount[BN] + pcount[WR] + pcount[BR] + pcount[WQ] + pcount[BQ] === 0) {
    // Bishops of opposite colours: hard to win even a pawn or two up.
    const a = plist[WB << 4], b = plist[BB << 4];
    if ((((a >> 4) + a) ^ ((b >> 4) + b)) & 1) return (value * 5 / 8) | 0;
  }
  if (wPieces === 0 && wPawns === 0 && sMinors + sMajors >= 2) {
    // Mating a bare king: push it away from the centre and bring our king up.
    const weakKing = strong === 0 ? bk : wk, strongKing = strong === 0 ? wk : bk;
    const df = Math.abs((wk & 7) - (bk & 7)), dr = Math.abs((wk >> 4) - (bk >> 4));
    let bonus = 12 * CENTRE_DISTANCE[weakKing] + 5 * (14 - df - dr);
    if (sMajors === 0 && sPawns === 0 && pcount[sBit | BISHOP] === 1 && pcount[sBit | KNIGHT] === 1) {
      // Bishop and knight mate only in a corner the bishop controls.
      const bishop = plist[(sBit | BISHOP) << 4];
      const f = weakKing & 7, r = (weakKing >> 4) - 4;
      const dark = (((bishop >> 4) + bishop) & 1) === 0;                 // a1 is dark
      const toCorner = dark ? Math.min(f + r, 14 - f - r) : Math.min(f + 7 - r, 7 - f + r);
      bonus += 30 * (7 - toCorner) - 6 * DIST[strongKing - weakKing + 119];
    }
    return strong === 0 ? value + bonus : value - bonus;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Positions in and out: FEN and UCI
// ---------------------------------------------------------------------------

const FEN_PIECES = { P: WP, N: WN, B: WB, R: WR, Q: WQ, K: WK, p: BP, n: BN, b: BB, r: BR, q: BQ, k: BK };
const PROMO_LETTER = ['', '', 'n', 'b', 'r', 'q'];

function squareName(s) {
  return 'abcdefgh'[s & 7] + ((s >> 4) - 3);
}

function moveToUci(m) {
  return squareName(m & 255) + squareName((m >> 8) & 255) + PROMO_LETTER[(m >> 24) & 7];
}

/** Sets up the position of `fen` as frame 0 of the stack. Throws on a FEN it cannot use. */
function setFen(fen) {
  const fields = String(fen).trim().split(/\s+/);
  const rows = fields[0].split('/');
  if (rows.length !== 8) throw new Error(`invalid FEN: ${fen}`);
  board.fill(EDGE);
  pcount.fill(0);
  pindex.fill(0);
  pawnAtt.fill(0);
  for (let s = 0; s < 64; s++) board[SQ256[s]] = 0;
  for (let rank = 7; rank >= 0; rank--) {
    let file = 0;
    for (const ch of rows[7 - rank]) {
      if (ch >= '1' && ch <= '8') { file += ch.charCodeAt(0) - 48; continue; }
      const piece = FEN_PIECES[ch];
      if (piece === undefined || file > 7 || pcount[piece] >= 16) throw new Error(`invalid FEN: ${fen}`);
      if ((piece & 7) === PAWN && (rank === 0 || rank === 7)) throw new Error(`invalid FEN (pawn on a back rank): ${fen}`);
      putPiece(piece, 64 + (rank << 4) + file);
      file++;
    }
    if (file !== 8) throw new Error(`invalid FEN: ${fen}`);
  }
  if (pcount[WK] !== 1 || pcount[BK] !== 1) throw new Error(`invalid FEN (kings): ${fen}`);
  const turn = fields.length > 1 ? fields[1] : 'w';
  if (turn !== 'w' && turn !== 'b') throw new Error(`invalid FEN (side to move): ${fen}`);
  stm = turn === 'w' ? 0 : 1;
  if (attacked(plist[KING_SLOT + ((stm ^ 1) << 7)], stm)) {
    throw new Error(`invalid FEN (the side not to move is in check): ${fen}`);
  }

  // Castling rights are kept only where king and rook still stand at home.
  let castle = 0;
  for (const ch of fields.length > 2 ? fields[2] : '-') {
    if (ch === 'K' && board[E1] === WK && board[H1] === WR) castle |= 1;
    else if (ch === 'Q' && board[E1] === WK && board[A1] === WR) castle |= 2;
    else if (ch === 'k' && board[E8] === BK && board[H8] === BR) castle |= 4;
    else if (ch === 'q' && board[E8] === BK && board[A8] === BR) castle |= 8;
  }

  let kl = 0, kh = 0, pl = 0, ph = 0, psq = 0, phase = 0;
  for (let i = 0; i < 64; i++) {
    const s = SQ256[i], p = board[s];
    if (p === 0) continue;
    const z = (p << 8) | s;
    kl ^= ZLO[z]; kh ^= ZHI[z];
    if ((p & 7) === PAWN) { pl ^= ZLO[z]; ph ^= ZHI[z]; }
    psq += PSQ[z];
    phase += PHASE_OF[p & 7];
  }
  if (stm === 1) { kl ^= ZSIDE_LO; kh ^= ZSIDE_HI; }
  kl ^= ZCASTLE_LO[castle]; kh ^= ZCASTLE_HI[castle];

  // The en-passant square counts only if the capture is on the board and legal.
  let ep = 0;
  const epField = fields.length > 3 ? fields[3] : '-';
  if (/^[a-h][36]$/.test(epField)) {
    const s = 64 + ((epField.charCodeAt(1) - 49) << 4) + (epField.charCodeAt(0) - 97);
    const pushed = stm === 0 ? s - 16 : s + 16, origin = stm === 0 ? s + 16 : s - 16;
    const rankOk = stm === 0 ? epField[1] === '6' : epField[1] === '3';
    if (rankOk && board[s] === 0 && board[origin] === 0 && board[pushed] === ((16 >> stm) | PAWN)
        && epCapturable(s)) {
      ep = s;
      kl ^= ZEP_LO[s & 7]; kh ^= ZEP_HI[s & 7];
    }
  }
  const half = fields.length > 4 ? parseInt(fields[4], 10) : 0;

  sp = 0;
  U[F_KEYLO] = kl; U[F_KEYHI] = kh; U[F_PAWNLO] = pl; U[F_PAWNHI] = ph;
  U[F_PSQ] = psq; U[F_PHASE] = phase; U[F_CASTLE] = castle; U[F_EP] = ep;
  U[F_HALF] = Number.isFinite(half) && half > 0 ? half : 0;
  U[F_CAPIDX] = 0; U[F_PROMOIDX] = 0; U[F_MOVE] = 0;
}

/** The legal move written `uci` in the current position, or 0. */
function findMove(uci) {
  if (typeof uci !== 'string' || uci.length < 4 || uci.length > 5) return 0;
  const checker = findChecker();
  const first = (MAX_PLY - 1) << 8;
  const end = genQuiets(genNoisy(first), checker !== 0);
  for (let i = first; i < end; i++) {
    const m = mlist[i];
    if (moveToUci(m) === uci && isLegal(m, checker)) return m;
  }
  return 0;
}

/**
 * Plays a move of the game (not of the search). Positions before a capture or
 * a pawn move can never come back, so the stack is restarted there; that also
 * keeps it from overflowing in a long game.
 */
function playGameMove(m) {
  makeMove(m);
  if (U[sp + F_HALF] === 0 || sp >= MAX_GAME * FR) {
    U.copyWithin(0, sp, sp + FR);
    sp = 0;
  }
}

// ---------------------------------------------------------------------------
// Search: scores, limits and the tables an engine remembers between moves
// ---------------------------------------------------------------------------

const MATE = 100000;                   // mate scores are +-(MATE - plies from the root)
const MATE_BOUND = MATE - 1000;        // anything beyond this is a forced mate
const INF = 1000000;
const NO_EVAL = -32768;                // "no static evaluation": a hash entry without one, a node in check
// Scores are negated as `0 - x`, never `-x`: in JavaScript -0 is a floating-point
// value, and one of those in the search would cost V8 its integer arithmetic.

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

let nodes = 0;
let checkAt = 0;                       // node count at which the limits are looked at next
let nodeCap = Infinity;
let deadline = Infinity;
let mustFinish = false;                // the first iteration ignores the limits
let stopped = false;                   // set once a limit is hit: every search function then returns at once

/** Called every 1024 nodes or so (and exactly at the node limit): out of time or nodes? */
function poll() {
  if (!mustFinish && (nodes >= nodeCap || now() >= deadline)) stopped = true;
  checkAt = nodes + 1024;
  if (nodeCap > nodes && nodeCap < checkAt) checkAt = nodeCap;
}

// Transposition table. A position's key is 64 bits in two halves: the low
// half picks a bucket of four entries (64 bytes, one cache line), the high
// half is stored to recognise the position. Entry = four 32-bit words:
//   [0] key, high half
//   [1] best move | bound << 29
//   [2] score (a mate score is stored relative to the entry's own node)
//   [3] depth | generation << 8 | static evaluation << 16
const BOUND_UPPER = 1, BOUND_LOWER = 2, BOUND_EXACT = 3;   // exact = both bounds
const MOVE_MASK = (1 << 29) - 1;

let tt = null;                         // the loaded engine's table (Int32Array)
let ttMask = 0;                        // number of buckets - 1
let ttGen = 1;                         // goes up by one each search: entries of older searches go first
// What the last successful ttProbe() found.
let hMove = 0, hScore = 0, hEval = 0, hDepth = 0, hBound = 0;

function ttProbe(keyLo, keyHi) {
  const t = tt;
  let e = (keyLo & ttMask) << 4;
  const end = e + 16;
  for (; e < end; e += 4) {
    if (t[e] === keyHi) {
      const w = t[e + 1], x = t[e + 3];
      hMove = w & MOVE_MASK; hBound = w >>> 29;
      hScore = t[e + 2];
      hDepth = x & 255; hEval = x >> 16;
      return true;
    }
  }
  return false;
}

function ttStore(keyLo, keyHi, move, score, ev, depth, bound) {
  const t = tt;
  const base = (keyLo & ttMask) << 4;
  let slot = base, worst = INF, x, q;
  for (let e = base; e < base + 16; e += 4) {
    x = t[e + 3];
    if (t[e] === keyHi) {
      // The same position again. A much deeper result is worth more than a
      // shallow bound: keep it (and mark it as still in use).
      if (bound !== BOUND_EXACT && depth + 4 <= (x & 255)) {
        t[e + 3] = (x & ~0xFF00) | (ttGen << 8);
        return;
      }
      if (move === 0) move = t[e + 1] & MOVE_MASK;   // a search that found no best move keeps the old one
      slot = e;
      break;
    }
    // Otherwise the least valuable entry goes: shallow, or left over from an earlier search.
    q = (x & 255) - (((ttGen - (x >> 8)) & 255) << 3);
    if (q < worst) { worst = q; slot = e; }
  }
  t[slot] = keyHi;
  t[slot + 1] = move | (bound << 29);
  t[slot + 2] = score;
  t[slot + 3] = (depth > 255 ? 255 : depth) | (ttGen << 8) | (ev << 16);
}

// Move-ordering memory. All of it belongs to one engine and is bound to these
// variables when that engine is loaded.
const HISTORY_MAX = 16384;
/** Quiet moves that caused cutoffs, [side << 12 | from << 6 | to] (squares 0..63). */
let history = null;
/** The quiet move that last refuted a given move, [piece << 6 | to] of the move it answered. */
let counterMove = null;

// Per-ply working memory of one search (shared: only one search runs at a time).
/** Two quiet moves per ply that caused a cutoff in a sibling position. */
const killers = new Int32Array((MAX_PLY + 2) * 2);
const evalStack = new Int32Array(MAX_PLY + 2);
/** Principal variation: row `ply` holds the best line found from that ply on. */
const pvTable = new Int32Array((MAX_PLY + 2) * MAX_PLY);
const pvLen = new Int32Array(MAX_PLY + 2);
/** Quiet moves tried at each ply before the one that caused a cutoff. */
const triedQuiets = new Int32Array(MAX_PLY * 64);

function updatePv(ply, m) {
  const base = ply * MAX_PLY, child = base + MAX_PLY;
  const n = pvLen[ply + 1];
  pvTable[base] = m;
  for (let i = 0; i < n; i++) pvTable[base + 1 + i] = pvTable[child + i];
  pvLen[ply] = n + 1;
}

function historyIndex(m) {
  return (((m >> 16) & 16) << 8) | (SQ64[m & 255] << 6) | SQ64[(m >> 8) & 255];
}

/** Moves a history counter towards +-HISTORY_MAX: the nearer the limit, the smaller the step. */
function historyAdd(table, i, bonus) {
  const v = table[i];
  table[i] = v + bonus - ((v * (bonus < 0 ? -bonus : bonus)) >> 14);
}

/** A quiet move refuted the position: remember it and mark down the quiet moves tried before it. */
function rewardQuiet(m, ply, depth, nTried) {
  const k = ply << 1;
  if (killers[k] !== m) { killers[k + 1] = killers[k]; killers[k] = m; }
  const prev = U[sp + F_MOVE];
  if (prev !== 0) counterMove[(((prev >> 16) & 31) << 6) | SQ64[(prev >> 8) & 255]] = m;
  let bonus = 16 * depth * depth;
  if (bonus > 1600) bonus = 1600;
  historyAdd(history, historyIndex(m), bonus);
  const base = ply << 6;
  for (let i = 0; i < nTried; i++) historyAdd(history, historyIndex(triedQuiets[base + i]), -bonus);
}

/** Has this position been on the board before, in the game or on the way here? */
function repeated(s, half) {
  const keyLo = U[s + F_KEYLO], keyHi = U[s + F_KEYHI];
  // Only positions since the last capture or pawn move (or null move) can come back, and only with the same side to move.
  let floor = s - half * FR;
  if (floor < 0) floor = 0;
  for (let t = s - 4 * FR; t >= floor; t -= 2 * FR) {
    if (U[t + F_KEYLO] === keyLo && U[t + F_KEYHI] === keyHi) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Search: handing out moves in the order most likely to cut off
// ---------------------------------------------------------------------------
//
// Moves are generated in stages, so that a cutoff by the hash move or by a
// capture never pays for generating and sorting the quiet moves:
//   hash move - winning and equal captures, queen promotions - killer moves,
//   countermove - the other quiet moves by history - losing captures and
//   under-promotions.
// In check there are few legal moves: they are generated and sorted at once.
// The moves handed out are pseudo-legal; the search tests them with isLegal().

const ST_HASH = 0, ST_GEN_NOISY = 1, ST_NOISY = 2, ST_KILLER_1 = 3, ST_KILLER_2 = 4, ST_COUNTER = 5,
  ST_GEN_QUIET = 6, ST_QUIET = 7, ST_BAD_NOISY = 8, ST_DONE = 9,
  ST_HASH_EVASION = 10, ST_GEN_EVASIONS = 11, ST_EVASIONS = 12;
/** Picker state per ply: stage, next slot, end of list, losing captures set aside, hash move, killers, countermove. */
const pk = new Int32Array(MAX_PLY * 8);
const PK_STAGE = 0, PK_CUR = 1, PK_END = 2, PK_BAD = 3, PK_HASH = 4, PK_K1 = 5, PK_K2 = 6, PK_CM = 7;
/** Where the move just handed out came from. */
const KIND_HASH = 0, KIND_GOOD_NOISY = 1, KIND_KILLER = 2, KIND_QUIET = 3, KIND_BAD_NOISY = 4, KIND_EVASION = 5;
let pickedKind = 0;

function pickStart(ply, ttMove, inCheck) {
  const o = ply << 3;
  pk[o + PK_STAGE] = inCheck ? (ttMove !== 0 ? ST_HASH_EVASION : ST_GEN_EVASIONS) : (ttMove !== 0 ? ST_HASH : ST_GEN_NOISY);
  pk[o + PK_HASH] = ttMove;
  pk[o + PK_BAD] = 0;
}

/** Brings the best-scored move of mlist[i..end) to slot i and returns it. */
function selectBest(i, end) {
  let best = i, bestScore = mscore[i];
  for (let j = i + 1; j < end; j++) {
    if (mscore[j] > bestScore) { bestScore = mscore[j]; best = j; }
  }
  const m = mlist[best];
  if (best !== i) { mlist[best] = mlist[i]; mscore[best] = mscore[i]; mlist[i] = m; mscore[i] = bestScore; }
  return m;
}

/** Most valuable victim first, least valuable attacker to break ties; a queen promotion counts as winning a queen. */
function scoreNoisy(from, end) {
  for (let i = from; i < end; i++) {
    const m = mlist[i];
    const promo = (m >> 24) & 7;
    mscore[i] = (((m >> 21) & 7) << 6) - ((m >> 16) & 7) + (promo === QUEEN ? 512 : promo !== 0 ? -1024 : 0);
  }
}

/** A killer or countermove is tried only if it is a quiet move that can be played here. */
function quietCandidate(m, o) {
  return m !== 0 && m !== pk[o + PK_HASH] && isPseudoLegal(m);
}

/** The next move to try at `ply`, or 0 when there are none left. `skipQuiets`: leave out the remaining quiet moves. */
function pickMove(ply, skipQuiets) {
  const o = ply << 3, first = ply << 8;
  let m, i, end, cur;
  if (skipQuiets && pk[o + PK_STAGE] >= ST_KILLER_1 && pk[o + PK_STAGE] <= ST_QUIET) {
    pk[o + PK_STAGE] = ST_BAD_NOISY;
    pk[o + PK_CUR] = first;
  }
  switch (pk[o + PK_STAGE]) {
    case ST_HASH:
      pk[o + PK_STAGE] = ST_GEN_NOISY;
      pickedKind = KIND_HASH;
      return pk[o + PK_HASH];

    case ST_GEN_NOISY:
      end = genNoisy(first);
      scoreNoisy(first, end);
      pk[o + PK_CUR] = first; pk[o + PK_END] = end;
      pk[o + PK_STAGE] = ST_NOISY;
      // falls through
    case ST_NOISY:
      cur = pk[o + PK_CUR]; end = pk[o + PK_END];
      while (cur < end) {
        m = selectBest(cur, end);
        cur++;
        if (m === pk[o + PK_HASH]) continue;
        if (mscore[cur - 1] < 0 || !seeGE(m, 0)) {
          // Loses material (or under-promotes): set aside in the part of the list already used up.
          mlist[first + pk[o + PK_BAD]++] = m;
          continue;
        }
        pk[o + PK_CUR] = cur;
        pickedKind = KIND_GOOD_NOISY;
        return m;
      }
      pk[o + PK_CUR] = cur;
      if (skipQuiets) { pk[o + PK_STAGE] = ST_BAD_NOISY; pk[o + PK_CUR] = first; return pickMove(ply, true); }
      pk[o + PK_STAGE] = ST_KILLER_1;
      // falls through
    case ST_KILLER_1:
      pk[o + PK_STAGE] = ST_KILLER_2;
      m = killers[ply << 1];
      pk[o + PK_K1] = 0;
      if (quietCandidate(m, o)) { pk[o + PK_K1] = m; pickedKind = KIND_KILLER; return m; }
      // falls through
    case ST_KILLER_2:
      pk[o + PK_STAGE] = ST_COUNTER;
      m = killers[(ply << 1) + 1];
      pk[o + PK_K2] = 0;
      if (quietCandidate(m, o)) { pk[o + PK_K2] = m; pickedKind = KIND_KILLER; return m; }
      // falls through
    case ST_COUNTER:
      pk[o + PK_STAGE] = ST_GEN_QUIET;
      m = U[sp + F_MOVE];
      m = m !== 0 ? counterMove[(((m >> 16) & 31) << 6) | SQ64[(m >> 8) & 255]] : 0;
      pk[o + PK_CM] = 0;
      if (m !== pk[o + PK_K1] && m !== pk[o + PK_K2] && quietCandidate(m, o)) {
        pk[o + PK_CM] = m; pickedKind = KIND_KILLER; return m;
      }
      // falls through
    case ST_GEN_QUIET:
      cur = first + pk[o + PK_BAD];
      end = genQuiets(cur, false);
      for (i = cur; i < end; i++) mscore[i] = history[historyIndex(mlist[i])];
      pk[o + PK_CUR] = cur; pk[o + PK_END] = end;
      pk[o + PK_STAGE] = ST_QUIET;
      // falls through
    case ST_QUIET:
      cur = pk[o + PK_CUR]; end = pk[o + PK_END];
      while (cur < end) {
        m = selectBest(cur, end);
        cur++;
        if (m === pk[o + PK_HASH] || m === pk[o + PK_K1] || m === pk[o + PK_K2] || m === pk[o + PK_CM]) continue;
        pk[o + PK_CUR] = cur;
        pickedKind = KIND_QUIET;
        return m;
      }
      pk[o + PK_STAGE] = ST_BAD_NOISY;
      pk[o + PK_CUR] = first;
      // falls through
    case ST_BAD_NOISY:
      cur = pk[o + PK_CUR];
      if (cur < first + pk[o + PK_BAD]) {
        pk[o + PK_CUR] = cur + 1;
        pickedKind = KIND_BAD_NOISY;
        return mlist[cur];
      }
      pk[o + PK_STAGE] = ST_DONE;
      return 0;

    case ST_HASH_EVASION:
      pk[o + PK_STAGE] = ST_GEN_EVASIONS;
      pickedKind = KIND_HASH;
      return pk[o + PK_HASH];

    case ST_GEN_EVASIONS:
      cur = genNoisy(first);
      scoreNoisy(first, cur);
      for (i = first; i < cur; i++) mscore[i] += 1 << 20;            // captures before quiet moves
      end = genQuiets(cur, true);
      for (i = cur; i < end; i++) mscore[i] = history[historyIndex(mlist[i])];
      pk[o + PK_CUR] = first; pk[o + PK_END] = end;
      pk[o + PK_STAGE] = ST_EVASIONS;
      // falls through
    case ST_EVASIONS:
      cur = pk[o + PK_CUR]; end = pk[o + PK_END];
      while (cur < end) {
        m = selectBest(cur, end);
        cur++;
        if (m === pk[o + PK_HASH]) continue;
        pk[o + PK_CUR] = cur;
        pickedKind = KIND_EVASION;
        return m;
      }
      pk[o + PK_STAGE] = ST_DONE;
      return 0;

    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Search: quiescence
// ---------------------------------------------------------------------------

const DELTA_MARGIN = 180;              // a capture must bring the score within this of alpha

/**
 * Plays out captures and queen promotions until the position is quiet enough
 * for the static evaluation to be trusted. A side in check must answer it:
 * every legal reply is tried.
 */
function qsearch(alpha, beta, ply) {
  pvLen[ply] = 0;
  if (++nodes >= checkAt) poll();
  if (stopped) return 0;
  if (ply >= MAX_PLY - 2) return evaluate();

  const s = sp;
  const keyLo = U[s + F_KEYLO], keyHi = U[s + F_KEYHI];
  const pvNode = beta - alpha > 1;
  const checker = findChecker();
  const inCheck = checker !== 0;

  let ttMove = 0, ttScore = 0, ttBound = 0, staticEval = NO_EVAL;
  if (ttProbe(keyLo, keyHi)) {
    ttMove = hMove; ttBound = hBound; staticEval = hEval; ttScore = hScore;
    if (ttScore >= MATE_BOUND) ttScore -= ply; else if (ttScore <= -MATE_BOUND) ttScore += ply;
    if (!pvNode && (ttScore >= beta ? (ttBound & BOUND_LOWER) !== 0 : (ttBound & BOUND_UPPER) !== 0)) return ttScore;
  }

  const alpha0 = alpha;
  let best, bestMove = 0;
  if (inCheck) {
    best = ply - MATE;
    staticEval = NO_EVAL;
  } else {
    if (staticEval === NO_EVAL) staticEval = evaluate();
    // Standing pat: the side to move need not capture at all.
    best = staticEval;
    if (ttBound !== 0 && (ttScore > best ? (ttBound & BOUND_LOWER) !== 0 : (ttBound & BOUND_UPPER) !== 0)) best = ttScore;
    if (best >= beta) {
      if (ttBound === 0) ttStore(keyLo, keyHi, 0, best, staticEval, 0, BOUND_LOWER);
      return best;
    }
    if (best > alpha) alpha = best;
  }

  const first = ply << 8;
  let end = genNoisy(first), i, m, score;
  scoreNoisy(first, end);
  if (inCheck) {
    for (i = first; i < end; i++) mscore[i] += 1 << 20;
    const quiets = end;
    end = genQuiets(end, true);
    for (i = quiets; i < end; i++) mscore[i] = history[historyIndex(mlist[i])];
  }
  if (ttMove !== 0) {
    for (i = first; i < end; i++) if (mlist[i] === ttMove) { mscore[i] = 1 << 24; break; }
  }
  const futility = staticEval + DELTA_MARGIN;

  for (i = first; i < end; i++) {
    m = selectBest(i, end);
    if (!inCheck) {
      if (mscore[i] < 0) break;                                   // only under-promotions are left
      // Even winning the piece outright would not reach alpha.
      if ((m & M_PROMO) === 0 && futility + SEE_VALUE[(m >> 21) & 7] <= alpha) {
        if (futility + SEE_VALUE[(m >> 21) & 7] > best) best = futility + SEE_VALUE[(m >> 21) & 7];
        continue;
      }
      if (!seeGE(m, 0)) continue;                                 // loses material
    }
    if (!isLegal(m, checker)) continue;
    makeMove(m);
    score = 0 - qsearch(0 - beta, 0 - alpha, ply + 1);
    unmakeMove(m);
    if (stopped) return 0;
    if (score > best) {
      best = score;
      if (score > alpha) {
        bestMove = m;
        if (pvNode) updatePv(ply, m);
        if (score >= beta) break;
        alpha = score;
      }
    }
  }

  ttStore(keyLo, keyHi, bestMove,
    best >= MATE_BOUND ? best + ply : best <= -MATE_BOUND ? best - ply : best,
    staticEval, 0, best >= beta ? BOUND_LOWER : best > alpha0 ? BOUND_EXACT : BOUND_UPPER);
  return best;
}

// ---------------------------------------------------------------------------
// Search: the main recursion
// ---------------------------------------------------------------------------

/** The fifty-move rule has run out at this node: a draw, unless the last move mated. */
function fiftyMoveScore(ply) {
  const checker = findChecker();
  return checker !== 0 && !anyLegalMove(checker) ? ply - MATE : 0;
}

/**
 * Principal-variation search (negamax, fail-soft): the value of the position
 * for the side to move, searched `depth` plies deep, as far as it lies inside
 * (alpha, beta). `ply` is the distance from the root.
 */
function search(depth, alpha, beta, ply, cutNode) {
  pvLen[ply] = 0;
  const s = sp;

  // Draws: the fifty-move rule, and any position seen before (in the game or
  // on the way here from the root) - coming back to it gets nowhere.
  const half = U[s + F_HALF];
  if (half >= 4) {
    if (half >= 100) return fiftyMoveScore(ply);
    if (repeated(s, half)) return 0;
  }

  if (depth <= 0) return qsearch(alpha, beta, ply);

  if (++nodes >= checkAt) poll();
  if (stopped) return 0;
  if (ply >= MAX_PLY - 2) return evaluate();

  // Mate-distance pruning: no line from here can beat a mate already found nearer the root.
  if (alpha < ply - MATE) alpha = ply - MATE;
  if (beta > MATE - ply - 1) beta = MATE - ply - 1;
  if (alpha >= beta) return alpha;

  const pvNode = beta - alpha > 1;
  const checker = findChecker();
  const inCheck = checker !== 0;
  const keyLo = U[s + F_KEYLO], keyHi = U[s + F_KEYHI];

  // The hash table: a result from an earlier visit that is deep enough ends
  // the search here (not on the principal variation, which is searched in
  // full); otherwise its move is tried first.
  let ttMove = 0, ttScore = 0, ttBound = 0, staticEval = NO_EVAL;
  if (ttProbe(keyLo, keyHi)) {
    ttMove = hMove; ttBound = hBound; staticEval = hEval; ttScore = hScore;
    if (ttScore >= MATE_BOUND) ttScore -= ply; else if (ttScore <= -MATE_BOUND) ttScore += ply;
    if (!pvNode && hDepth >= depth && half < 90
        && (ttScore >= beta ? (ttBound & BOUND_LOWER) !== 0 : (ttBound & BOUND_UPPER) !== 0)) {
      return ttScore;
    }
    if (ttMove !== 0 && !(isPseudoLegal(ttMove) && isLegal(ttMove, checker))) ttMove = 0;
  }

  if (inCheck) staticEval = NO_EVAL;
  else if (staticEval === NO_EVAL) staticEval = evaluate();
  evalStack[ply] = staticEval;

  const alpha0 = alpha;
  let best = -INF, bestMove = 0, score = 0, legal = 0, nTried = 0, m, quiet, newDepth;
  pickStart(ply, ttMove, inCheck);
  while ((m = pickMove(ply, false)) !== 0) {
    if (pickedKind !== KIND_HASH && !isLegal(m, checker)) continue;
    legal++;
    quiet = (m & M_NOISY) === 0;
    newDepth = depth - 1;
    if (givesCheck(m)) newDepth++;                                 // check extension

    makeMove(m);
    if (legal === 1) score = 0 - search(newDepth, 0 - beta, 0 - alpha, ply + 1, false);
    else {
      // Later moves only have to show they are no better: a zero-width
      // search, repeated with the full window if it fails.
      score = 0 - search(newDepth, -1 - alpha, 0 - alpha, ply + 1, !cutNode);
      if (score > alpha && score < beta) score = 0 - search(newDepth, 0 - beta, 0 - alpha, ply + 1, false);
    }
    unmakeMove(m);
    if (stopped) return 0;

    if (score > best) {
      best = score;
      if (score > alpha) {
        bestMove = m;
        if (pvNode) updatePv(ply, m);
        if (score >= beta) {
          if (quiet) rewardQuiet(m, ply, depth, nTried);
          break;
        }
        alpha = score;
      }
    }
    if (quiet && nTried < 64) triedQuiets[(ply << 6) + nTried++] = m;
  }

  if (legal === 0) return inCheck ? ply - MATE : 0;              // checkmate or stalemate

  ttStore(keyLo, keyHi, bestMove,
    best >= MATE_BOUND ? best + ply : best <= -MATE_BOUND ? best - ply : best,
    staticEval, depth, best >= beta ? BOUND_LOWER : best > alpha0 ? BOUND_EXACT : BOUND_UPPER);
  return best;
}

// ---------------------------------------------------------------------------
// Search: the root
// ---------------------------------------------------------------------------

/** The legal moves of the root position, best first, and what the last pass over them found. */
const rootMoves = new Int32Array(256);
const rootNodes = new Float64Array(256);   // size of each move's subtree in the last iteration
let rootCount = 0;
let rootBest = 0;                      // best move of the pass in progress (0: none has beaten alpha yet)
let rootBestScore = 0;
let rootPv = [];

function generateRootMoves() {
  const checker = findChecker();
  const first = (MAX_PLY - 1) << 8;
  const end = genQuiets(genNoisy(first), checker !== 0);
  rootCount = 0;
  for (let i = first; i < end; i++) {
    if (isLegal(mlist[i], checker)) { rootNodes[rootCount] = 0; rootMoves[rootCount++] = mlist[i]; }
  }
  return checker;
}

/** Puts root move `m` first, keeping the order of the others. */
function rootToFront(m) {
  let i = 0;
  while (i < rootCount && rootMoves[i] !== m) i++;
  if (i >= rootCount) return;
  const n = rootNodes[i];
  for (; i > 0; i--) { rootMoves[i] = rootMoves[i - 1]; rootNodes[i] = rootNodes[i - 1]; }
  rootMoves[0] = m; rootNodes[0] = n;
}

/** After an iteration: the best move stays first, the rest go by the size of their subtrees (stable). */
function sortRootMoves() {
  for (let i = 2; i < rootCount; i++) {
    const m = rootMoves[i], n = rootNodes[i];
    let j = i - 1;
    for (; j >= 1 && rootNodes[j] < n; j--) { rootMoves[j + 1] = rootMoves[j]; rootNodes[j + 1] = rootNodes[j]; }
    rootMoves[j + 1] = m; rootNodes[j + 1] = n;
  }
}

/**
 * One pass over the root moves at `depth` inside (alpha, beta). Leaves the
 * best move that beat alpha in rootBest (with its score and line), also when
 * the pass is cut short by a limit.
 */
function searchRoot(depth, alpha, beta) {
  let best = -INF, score;
  pvLen[0] = 0;
  for (let i = 0; i < rootCount; i++) {
    const m = rootMoves[i];
    const before = nodes;
    makeMove(m);
    if (i === 0) score = 0 - search(depth - 1, 0 - beta, 0 - alpha, 1, false);
    else {
      score = 0 - search(depth - 1, -1 - alpha, 0 - alpha, 1, true);
      if (score > alpha && !stopped) score = 0 - search(depth - 1, 0 - beta, 0 - alpha, 1, false);
    }
    unmakeMove(m);
    if (stopped) return best;
    rootNodes[i] = nodes - before;
    if (score > best) {
      best = score;
      if (score > alpha) {
        rootBest = m; rootBestScore = score;
        rootPv = [m];
        for (let k = 0; k < pvLen[1]; k++) rootPv.push(pvTable[MAX_PLY + k]);
        if (score >= beta) break;
        alpha = score;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The engine object
// ---------------------------------------------------------------------------

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** Start another iteration only while less than this share of the time is used. */
const NEXT_ITERATION_SHARE = 0.6;

/** The engine whose position is currently loaded into the module state. */
let loaded = null;

export class Engine {
  #fen = START_FEN;
  #moves = [];
  #hashMb = 32;
  // Allocated on first use, so that an engine made only to count or evaluate costs nothing.
  #tt = null;
  #ttMask = 0;
  #ttGen = 1;
  #history = null;
  #counterMove = null;

  /** options: { hashMb = 32 } - megabytes for the transposition table. */
  constructor(options = {}) {
    const hashMb = Number(options.hashMb);
    if (Number.isFinite(hashMb) && hashMb > 0) this.#hashMb = Math.min(hashMb, 1024);
    this.setPosition(START_FEN);
  }

  /** Forgets the hash table, the move-ordering history and the game: as good as a new engine. */
  newGame() {
    if (this.#tt !== null) {
      this.#tt.fill(0);
      this.#history.fill(0);
      this.#counterMove.fill(0);
      this.#ttGen = 1;
    }
    this.setPosition(START_FEN);
  }

  /** Sets the position: a FEN and the UCI moves played from it (the game so far). */
  setPosition(fen = START_FEN, moves = []) {
    loaded = null;                       // if anything below throws, nothing stays half loaded
    setFen(fen);
    for (const uci of moves) {
      const m = findMove(uci);
      if (m === 0) throw new Error(`illegal move ${uci} in ${fen} moves ${moves.join(' ')}`);
      playGameMove(m);
    }
    this.#fen = fen;
    this.#moves = moves.slice();
    loaded = this;
  }

  /** Makes this engine's position the one on the module's board. */
  #load() {
    if (loaded === this) return;
    this.setPosition(this.#fen, this.#moves);
  }

  /** Loads the position and binds this engine's tables for a search. */
  #begin() {
    this.#load();
    if (this.#tt === null) {
      // The largest power of two of 64-byte buckets that fits in the budget.
      let buckets = 1 << 10;
      while (buckets * 2 * 64 <= this.#hashMb * 1048576 && buckets < (1 << 24)) buckets *= 2;
      this.#tt = new Int32Array(buckets * 16);
      this.#ttMask = buckets - 1;
      this.#history = new Int16Array(2 * 64 * 64);
      this.#counterMove = new Int32Array(24 * 64);
    }
    tt = this.#tt; ttMask = this.#ttMask;
    history = this.#history; counterMove = this.#counterMove;
    // A new generation for the hash table: what earlier searches left is still used, but replaced first.
    this.#ttGen = (this.#ttGen + 1) & 255;
    ttGen = this.#ttGen;
    killers.fill(0);
    nodes = 0;
    stopped = false;
    mustFinish = false;
    nodeCap = Infinity;
    deadline = Infinity;
    checkAt = 0;
  }

  /** Number of leaf nodes of the legal move tree `depth` plies deep. */
  perft(depth) {
    this.#load();
    return depth <= 0 ? 1 : perftCount(depth, 0);
  }

  /** Static evaluation of the position in centipawns, from the side to move's point of view. */
  evaluate() {
    this.#load();
    return evaluate();
  }

  /**
   * Searches the position by iterative deepening.
   * limits: { timeMs = 1000, maxDepth = 64, nodeLimit = Infinity }.
   * Returns { move, scoreCp, depth, nodes, timeMs, pv }: the move as a UCI
   * string (null if there is no legal move), its score for the side to move
   * (a mate in n plies is 100000 - n), the last iteration that was completed,
   * and the line the engine expects.
   */
  search(limits = {}) {
    const started = now();
    this.#begin();
    const timeMs = limits.timeMs === undefined ? 1000 : Math.max(0, Number(limits.timeMs) || 0);
    let maxDepth = limits.maxDepth === undefined ? 64 : Math.floor(Number(limits.maxDepth)) || 1;
    maxDepth = Math.max(1, Math.min(maxDepth, MAX_PLY - 28));
    const nodeLimit = limits.nodeLimit === undefined ? Infinity : Math.max(1, Number(limits.nodeLimit) || 1);

    const checker = generateRootMoves();
    if (rootCount === 0) {
      return { move: null, scoreCp: checker !== 0 ? -MATE : 0, depth: 0, nodes: 0, timeMs: 0, pv: [] };
    }
    // A hash move from an earlier search of this position goes first.
    if (ttProbe(U[sp + F_KEYLO], U[sp + F_KEYHI]) && hMove !== 0) rootToFront(hMove);

    nodeCap = nodeLimit;
    deadline = started + timeMs;
    if (rootCount === 1) {
      // A forced move needs no thought: a glance ahead for the score is enough.
      maxDepth = Math.min(maxDepth, 4);
      nodeCap = Math.min(nodeCap, 4000);
    }

    let bestMove = rootMoves[0], bestScore = 0, completed = 0, pv = [bestMove];
    for (let depth = 1; depth <= maxDepth; depth++) {
      mustFinish = depth === 1;          // the first iteration always completes, whatever the limits
      rootBest = 0;
      const score = searchRoot(depth, -INF, INF);
      if (stopped) {
        // Cut short. The previous best move was searched first, so a move
        // that has already beaten it at this depth is a real improvement.
        if (rootBest !== 0 && rootBest !== bestMove) { bestMove = rootBest; bestScore = rootBestScore; pv = rootPv; }
        break;
      }
      bestMove = rootBest; bestScore = score; pv = rootPv; completed = depth;
      rootToFront(bestMove);
      sortRootMoves();

      if (score >= MATE_BOUND && MATE - score <= depth) break;     // a forced mate, as short as this depth can see
      if (score <= -MATE_BOUND && MATE + score <= depth) break;    // mated whatever we do
      // Another iteration takes several times as long as this one did: with
      // most of the time gone it could not get anywhere.
      if (now() - started >= timeMs * NEXT_ITERATION_SHARE) break;
    }

    return {
      move: moveToUci(bestMove),
      scoreCp: bestScore,
      depth: completed,
      nodes,
      timeMs: Math.round(now() - started),
      pv: pv.map(moveToUci),
    };
  }

  /**
   * Searches one root move: the position after `uci` to `depth - 1` plies,
   * inside the window (lower, upper). Returns its score from the root side's
   * point of view - exact if strictly inside the window, otherwise a bound
   * (<= lower or >= upper) - or null if the move is not legal or a limit
   * (limits: { timeMs, nodeLimit }) runs out first.
   */
  scoreMove(uci, lower, upper, depth, limits = {}) {
    const started = now();
    this.#begin();
    const m = findMove(uci);
    if (m === 0) return null;
    if (limits.timeMs !== undefined) {
      const timeMs = Number(limits.timeMs) || 0;
      if (timeMs <= 0) return null;
      deadline = started + timeMs;
    }
    if (limits.nodeLimit !== undefined) nodeCap = Math.max(1, Number(limits.nodeLimit) || 1);
    makeMove(m);
    const score = 0 - search(Math.max(1, Math.floor(depth)) - 1, 0 - upper, 0 - lower, 1, false);
    unmakeMove(m);
    return stopped ? null : score;
  }

  /**
   * Every root move that scores within `windowCp` of the best, with its exact
   * score at the depth `result` (what search() returned) reached:
   * { [uci]: scoreCp }. Stops early, with what it has, when
   * limits.nodeLimit nodes have been searched.
   */
  candidates(result, windowCp, limits = {}) {
    if (!result || typeof result.move !== 'string') return {};
    this.#begin();
    const best = result.scoreCp;
    const found = { [result.move]: best };
    if (Math.abs(best) >= MATE_BOUND) return found;
    if (limits.nodeLimit !== undefined) nodeCap = Math.max(1, Number(limits.nodeLimit) || 1);
    const depth = Math.max(1, result.depth);
    const floor = best - windowCp;
    generateRootMoves();
    for (let i = 0; i < rootCount; i++) {
      const m = rootMoves[i];
      const uci = moveToUci(m);
      if (uci === result.move) continue;
      makeMove(m);
      // First ask only whether the move reaches the floor; if it does, find out by how much.
      let score = 0 - search(depth - 1, 0 - floor, 1 - floor, 1, true);
      if (!stopped && score >= floor) score = 0 - search(depth - 1, -INF, 1 - floor, 1, false);
      unmakeMove(m);
      if (stopped) break;
      if (score >= floor) found[uci] = score;
    }
    return found;
  }
}
