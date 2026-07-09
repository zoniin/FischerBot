"""Tapered positional evaluation.

Scores are centipawns from White's perspective. The middlegame and endgame
piece-square tables are blended by remaining material (PeSTO-style phase),
with light pawn-structure, king-shield, rook-file and bishop-pair terms.
"""

import chess

PIECE_VALUES_MG = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 335,
    chess.ROOK: 500,
    chess.QUEEN: 950,
    chess.KING: 0,
}

PIECE_VALUES_EG = {
    chess.PAWN: 120,
    chess.KNIGHT: 300,
    chess.BISHOP: 330,
    chess.ROOK: 530,
    chess.QUEEN: 950,
    chess.KING: 0,
}

# Tables are written as seen from White's side (index 0 = a8, 63 = h1),
# the layout used across engine literature; they are re-indexed below.
_PAWN_MG = [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  27,  27,  10,   5,   5,
      0,   0,   0,  25,  25,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -25, -25,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
]

_PAWN_EG = [
      0,   0,   0,   0,   0,   0,   0,   0,
     90,  90,  90,  90,  90,  90,  90,  90,
     50,  50,  50,  50,  50,  50,  50,  50,
     30,  30,  30,  30,  30,  30,  30,  30,
     15,  15,  15,  15,  15,  15,  15,  15,
      5,   5,   5,   5,   5,   5,   5,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
      0,   0,   0,   0,   0,   0,   0,   0,
]

_KNIGHT = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
]

_BISHOP = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
]

_ROOK = [
      0,   0,   0,   0,   0,   0,   0,   0,
      5,  10,  10,  10,  10,  10,  10,   5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      0,   0,   0,   5,   5,   0,   0,   0,
]

_QUEEN = [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
]

_KING_MG = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
]

_KING_EG = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10,   0,   0, -10, -20, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -30,   0,   0,   0,   0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
]

_MG_TABLES = {
    chess.PAWN: _PAWN_MG,
    chess.KNIGHT: _KNIGHT,
    chess.BISHOP: _BISHOP,
    chess.ROOK: _ROOK,
    chess.QUEEN: _QUEEN,
    chess.KING: _KING_MG,
}

_EG_TABLES = {
    chess.PAWN: _PAWN_EG,
    chess.KNIGHT: _KNIGHT,
    chess.BISHOP: _BISHOP,
    chess.ROOK: _ROOK,
    chess.QUEEN: _QUEEN,
    chess.KING: _KING_EG,
}


def _bake(tables, values):
    """Fold piece value + PST into per-color lookup arrays indexed by square."""
    baked = {}
    for piece_type, table in tables.items():
        white = [0] * 64
        black = [0] * 64
        for sq in chess.SQUARES:
            white[sq] = values[piece_type] + table[chess.square_mirror(sq)]
            black[sq] = values[piece_type] + table[sq]
        baked[piece_type] = (black, white)  # indexed by color: False=black, True=white
    return baked


PST_MG = _bake(_MG_TABLES, PIECE_VALUES_MG)
PST_EG = _bake(_EG_TABLES, PIECE_VALUES_EG)

# Game phase weights (PeSTO): total 24 at the starting position.
_PHASE_WEIGHT = {
    chess.PAWN: 0,
    chess.KNIGHT: 1,
    chess.BISHOP: 1,
    chess.ROOK: 2,
    chess.QUEEN: 4,
    chess.KING: 0,
}
MAX_PHASE = 24

# Masks of squares an enemy pawn would have to occupy to stop a passed pawn.
_PASSED_MASKS = {chess.WHITE: [0] * 64, chess.BLACK: [0] * 64}
# Pawn-shield squares in front of a castled king.
_SHIELD_MASKS = {chess.WHITE: [0] * 64, chess.BLACK: [0] * 64}

for _sq in chess.SQUARES:
    _f, _r = chess.square_file(_sq), chess.square_rank(_sq)
    w_pass = b_pass = w_shield = b_shield = 0
    for df in (-1, 0, 1):
        nf = _f + df
        if not 0 <= nf <= 7:
            continue
        for nr in range(_r + 1, 8):
            w_pass |= chess.BB_SQUARES[chess.square(nf, nr)]
        for nr in range(0, _r):
            b_pass |= chess.BB_SQUARES[chess.square(nf, nr)]
        if _r + 1 <= 7:
            w_shield |= chess.BB_SQUARES[chess.square(nf, _r + 1)]
        if _r + 2 <= 7:
            w_shield |= chess.BB_SQUARES[chess.square(nf, _r + 2)]
        if _r - 1 >= 0:
            b_shield |= chess.BB_SQUARES[chess.square(nf, _r - 1)]
        if _r - 2 >= 0:
            b_shield |= chess.BB_SQUARES[chess.square(nf, _r - 2)]
    _PASSED_MASKS[chess.WHITE][_sq] = w_pass
    _PASSED_MASKS[chess.BLACK][_sq] = b_pass
    _SHIELD_MASKS[chess.WHITE][_sq] = w_shield
    _SHIELD_MASKS[chess.BLACK][_sq] = b_shield

_FILE_BBS = [chess.BB_FILES[f] for f in range(8)]

BISHOP_PAIR_BONUS = 30
DOUBLED_PAWN_PENALTY = 15
ISOLATED_PAWN_PENALTY = 12
PASSED_PAWN_BONUS = (0, 10, 15, 25, 40, 65, 100, 0)  # by rank progress
ROOK_OPEN_FILE_BONUS = 22
ROOK_SEMI_OPEN_BONUS = 10
KING_SHIELD_BONUS = 8
TEMPO_BONUS = 10

MATE_SCORE = 100_000


def evaluate(board: chess.Board) -> int:
    """Static evaluation in centipawns from White's perspective."""
    if board.is_insufficient_material():
        return 0

    mg = 0
    eg = 0
    phase = 0

    wp_files = 0  # bitmask of files containing white pawns
    bp_files = 0
    white_pawns_bb = board.pawns & board.occupied_co[chess.WHITE]
    black_pawns_bb = board.pawns & board.occupied_co[chess.BLACK]
    white_bishops = 0
    black_bishops = 0

    for sq, piece in board.piece_map().items():
        pt = piece.piece_type
        color = piece.color
        sign = 1 if color else -1
        mg += sign * PST_MG[pt][color][sq]
        eg += sign * PST_EG[pt][color][sq]
        phase += _PHASE_WEIGHT[pt]

        if pt == chess.PAWN:
            f = chess.square_file(sq)
            if color:
                wp_files |= 1 << f
            else:
                bp_files |= 1 << f
            enemy = black_pawns_bb if color else white_pawns_bb
            if not (_PASSED_MASKS[color][sq] & enemy):
                progress = chess.square_rank(sq) if color else 7 - chess.square_rank(sq)
                bonus = PASSED_PAWN_BONUS[progress]
                mg += sign * bonus
                eg += sign * (bonus + bonus // 2)
        elif pt == chess.BISHOP:
            if color:
                white_bishops += 1
            else:
                black_bishops += 1

    if white_bishops >= 2:
        mg += BISHOP_PAIR_BONUS
        eg += BISHOP_PAIR_BONUS
    if black_bishops >= 2:
        mg -= BISHOP_PAIR_BONUS
        eg -= BISHOP_PAIR_BONUS

    structure = _pawn_structure(white_pawns_bb, black_pawns_bb, wp_files, bp_files)
    mg += structure
    eg += structure

    rooks = _rook_files(board, wp_files, bp_files)
    mg += rooks
    eg += rooks

    mg += _king_shield(board, white_pawns_bb, black_pawns_bb)

    phase = min(phase, MAX_PHASE)
    score = (mg * phase + eg * (MAX_PHASE - phase)) // MAX_PHASE
    score += TEMPO_BONUS if board.turn else -TEMPO_BONUS
    return score


def _pawn_structure(white_pawns_bb, black_pawns_bb, wp_files, bp_files) -> int:
    score = 0
    for f in range(8):
        file_bb = _FILE_BBS[f]
        w_count = chess.popcount(white_pawns_bb & file_bb)
        b_count = chess.popcount(black_pawns_bb & file_bb)
        if w_count > 1:
            score -= DOUBLED_PAWN_PENALTY * (w_count - 1)
        if b_count > 1:
            score += DOUBLED_PAWN_PENALTY * (b_count - 1)
        neighbors = 0
        if f > 0:
            neighbors |= 1 << (f - 1)
        if f < 7:
            neighbors |= 1 << (f + 1)
        if w_count and not (wp_files & neighbors):
            score -= ISOLATED_PAWN_PENALTY * w_count
        if b_count and not (bp_files & neighbors):
            score += ISOLATED_PAWN_PENALTY * b_count
    return score


def _rook_files(board, wp_files, bp_files) -> int:
    score = 0
    for color, sign in ((chess.WHITE, 1), (chess.BLACK, -1)):
        own_files = wp_files if color else bp_files
        their_files = bp_files if color else wp_files
        for sq in board.pieces(chess.ROOK, color):
            f = 1 << chess.square_file(sq)
            if not (own_files & f):
                if not (their_files & f):
                    score += sign * ROOK_OPEN_FILE_BONUS
                else:
                    score += sign * ROOK_SEMI_OPEN_BONUS
    return score


def _king_shield(board, white_pawns_bb, black_pawns_bb) -> int:
    score = 0
    wk = board.king(chess.WHITE)
    bk = board.king(chess.BLACK)
    if wk is not None:
        score += KING_SHIELD_BONUS * chess.popcount(
            _SHIELD_MASKS[chess.WHITE][wk] & white_pawns_bb
        )
    if bk is not None:
        score -= KING_SHIELD_BONUS * chess.popcount(
            _SHIELD_MASKS[chess.BLACK][bk] & black_pawns_bb
        )
    return score
