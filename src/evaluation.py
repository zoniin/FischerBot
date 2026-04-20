"""
Position evaluation module inspired by Bobby Fischer's playing style.
Emphasizes piece activity, king safety, and tactical opportunities.
"""

import chess

# Piece values based on Fischer's practical play
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0
}

# Piece-square tables for positional evaluation
# Fischer valued active piece placement

PAWN_TABLE = [
    0,   0,   0,   0,   0,   0,   0,   0,
    50,  50,  50,  50,  50,  50,  50,  50,
    10,  10,  20,  30,  30,  20,  10,  10,
    5,   5,  10,  25,  25,  10,   5,   5,
    0,   0,   0,  20,  20,   0,   0,   0,
    5,  -5, -10,   0,   0, -10,  -5,   5,
    5,  10,  10, -20, -20,  10,  10,   5,
    0,   0,   0,   0,   0,   0,   0,   0
]

KNIGHT_TABLE = [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50
]

BISHOP_TABLE = [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20
]

ROOK_TABLE = [
    0,   0,   0,   0,   0,   0,   0,   0,
    5,  10,  10,  10,  10,  10,  10,   5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    -5,   0,   0,   0,   0,   0,   0,  -5,
    0,   0,   0,   5,   5,   0,   0,   0
]

QUEEN_TABLE = [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
    -5,   0,   5,   5,   5,   5,   0,  -5,
    0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20
]

KING_MIDDLE_GAME = [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20,  20,   0,   0,   0,   0,  20,  20,
    20,  30,  10,   0,   0,  10,  30,  20
]

KING_END_GAME = [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10,   0,   0, -10, -20, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -30,   0,   0,   0,   0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50
]

PIECE_SQUARE_TABLES = {
    chess.PAWN: PAWN_TABLE,
    chess.KNIGHT: KNIGHT_TABLE,
    chess.BISHOP: BISHOP_TABLE,
    chess.ROOK: ROOK_TABLE,
    chess.QUEEN: QUEEN_TABLE,
}


def evaluate_position(board: chess.Board) -> float:
    """
    Evaluate the position from White's perspective.
    Positive scores favor White, negative favor Black.

    Incorporates Fischer's playing style:
    - Material advantage
    - Piece activity and placement
    - King safety
    - Pawn structure
    - Control of center
    - Open files for rooks
    """
    if board.is_checkmate():
        return -10000 if board.turn else 10000

    if board.is_stalemate() or board.is_insufficient_material():
        return 0

    score = 0

    # Material and piece-square evaluation
    score += evaluate_material_and_position(board)

    # Fischer-specific bonuses
    score += evaluate_piece_activity(board)
    score += evaluate_pawn_structure(board)
    score += evaluate_king_safety(board)
    score += evaluate_center_control(board)

    return score


def evaluate_material_and_position(board: chess.Board) -> float:
    """Evaluate material balance and piece positioning."""
    score = 0
    endgame = is_endgame(board)

    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is None:
            continue

        value = PIECE_VALUES[piece.piece_type]

        # Add piece-square table bonus
        if piece.piece_type in PIECE_SQUARE_TABLES:
            table = PIECE_SQUARE_TABLES[piece.piece_type]
            square_index = square if piece.color == chess.WHITE else chess.square_mirror(square)
            value += table[square_index]
        elif piece.piece_type == chess.KING:
            table = KING_END_GAME if endgame else KING_MIDDLE_GAME
            square_index = square if piece.color == chess.WHITE else chess.square_mirror(square)
            value += table[square_index]

        score += value if piece.color == chess.WHITE else -value

    return score


def evaluate_piece_activity(board: chess.Board) -> float:
    """
    Evaluate piece activity - Fischer loved active pieces!
    Bonus for pieces with many legal moves.
    """
    score = 0

    # Count mobility for both sides
    white_mobility = 0
    black_mobility = 0

    for square in chess.SQUARES:
        piece = board.piece_at(square)
        if piece is None:
            continue

        # Count attacks/moves from this square
        attacks = len(list(board.attacks(square)))

        if piece.color == chess.WHITE:
            white_mobility += attacks
        else:
            black_mobility += attacks

    # Fischer valued mobility highly
    score += (white_mobility - black_mobility) * 2

    # Bonus for rooks on open files (Fischer's trademark)
    score += evaluate_rook_placement(board)

    return score


def evaluate_rook_placement(board: chess.Board) -> float:
    """Fischer was masterful with rooks on open and semi-open files."""
    score = 0

    for file_idx in range(8):
        has_white_pawn = False
        has_black_pawn = False
        white_rook_count = 0
        black_rook_count = 0

        for rank in range(8):
            square = chess.square(file_idx, rank)
            piece = board.piece_at(square)

            if piece:
                if piece.piece_type == chess.PAWN:
                    if piece.color == chess.WHITE:
                        has_white_pawn = True
                    else:
                        has_black_pawn = True
                elif piece.piece_type == chess.ROOK:
                    if piece.color == chess.WHITE:
                        white_rook_count += 1
                    else:
                        black_rook_count += 1

        # Open file (no pawns)
        if not has_white_pawn and not has_black_pawn:
            score += white_rook_count * 25
            score -= black_rook_count * 25
        # Semi-open file (only opponent's pawns)
        elif not has_white_pawn and has_black_pawn:
            score += white_rook_count * 15
        elif has_white_pawn and not has_black_pawn:
            score -= black_rook_count * 15

    return score


def evaluate_pawn_structure(board: chess.Board) -> float:
    """
    Evaluate pawn structure.
    Penalize doubled, isolated pawns. Bonus for passed pawns.
    """
    score = 0

    for file_idx in range(8):
        white_pawns = []
        black_pawns = []

        for rank in range(8):
            square = chess.square(file_idx, rank)
            piece = board.piece_at(square)

            if piece and piece.piece_type == chess.PAWN:
                if piece.color == chess.WHITE:
                    white_pawns.append(rank)
                else:
                    black_pawns.append(rank)

        # Doubled pawns penalty
        if len(white_pawns) > 1:
            score -= 20 * (len(white_pawns) - 1)
        if len(black_pawns) > 1:
            score += 20 * (len(black_pawns) - 1)

        # Passed pawns bonus
        if white_pawns and not black_pawns:
            # Check if truly passed (no enemy pawns on adjacent files)
            is_passed = True
            for adj_file in [file_idx - 1, file_idx + 1]:
                if 0 <= adj_file < 8:
                    for rank in range(max(white_pawns), 8):
                        sq = chess.square(adj_file, rank)
                        p = board.piece_at(sq)
                        if p and p.piece_type == chess.PAWN and p.color == chess.BLACK:
                            is_passed = False
            if is_passed:
                score += 30 + (max(white_pawns) * 5)

        if black_pawns and not white_pawns:
            is_passed = True
            for adj_file in [file_idx - 1, file_idx + 1]:
                if 0 <= adj_file < 8:
                    for rank in range(0, min(black_pawns) + 1):
                        sq = chess.square(adj_file, rank)
                        p = board.piece_at(sq)
                        if p and p.piece_type == chess.PAWN and p.color == chess.WHITE:
                            is_passed = False
            if is_passed:
                score -= 30 + ((7 - min(black_pawns)) * 5)

    return score


def evaluate_king_safety(board: chess.Board) -> float:
    """
    Evaluate king safety.
    Fischer was aggressive but also valued king safety.
    """
    score = 0

    white_king_square = board.king(chess.WHITE)
    black_king_square = board.king(chess.BLACK)

    if white_king_square and not is_endgame(board):
        # Bonus for castled king
        if white_king_square in [chess.G1, chess.C1]:
            score += 30
        # Penalty for exposed king
        attackers = len(board.attackers(chess.BLACK, white_king_square))
        score -= attackers * 15

    if black_king_square and not is_endgame(board):
        if black_king_square in [chess.G8, chess.C8]:
            score -= 30
        attackers = len(board.attackers(chess.WHITE, black_king_square))
        score += attackers * 15

    return score


def evaluate_center_control(board: chess.Board) -> float:
    """
    Fischer understood the importance of the center.
    Bonus for controlling central squares.
    """
    center_squares = [chess.E4, chess.D4, chess.E5, chess.D5]
    extended_center = [chess.C3, chess.C4, chess.C5, chess.C6,
                       chess.D3, chess.D6,
                       chess.E3, chess.E6,
                       chess.F3, chess.F4, chess.F5, chess.F6]

    score = 0

    for square in center_squares:
        white_attackers = len(board.attackers(chess.WHITE, square))
        black_attackers = len(board.attackers(chess.BLACK, square))
        score += (white_attackers - black_attackers) * 5

    for square in extended_center:
        white_attackers = len(board.attackers(chess.WHITE, square))
        black_attackers = len(board.attackers(chess.BLACK, square))
        score += (white_attackers - black_attackers) * 2

    return score


def is_endgame(board: chess.Board) -> bool:
    """
    Determine if we're in the endgame.
    Simple heuristic: queens are off or very few pieces remain.
    """
    queens = len(board.pieces(chess.QUEEN, chess.WHITE)) + len(board.pieces(chess.QUEEN, chess.BLACK))

    if queens == 0:
        return True

    # Count minor and major pieces
    piece_count = 0
    for piece_type in [chess.KNIGHT, chess.BISHOP, chess.ROOK]:
        piece_count += len(board.pieces(piece_type, chess.WHITE))
        piece_count += len(board.pieces(piece_type, chess.BLACK))

    return piece_count <= 6
