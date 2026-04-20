"""
Opening book based on Bobby Fischer's repertoire.
Fischer primarily played 1.e4 as White and fought for sharp positions as Black.
"""

import chess
import random

# Fischer's favorite openings as White
FISCHER_WHITE_OPENINGS = {
    # King's Pawn Opening
    (): ["e2e4"],

    # Against 1...e5
    ("e7e5",): ["g1f3"],  # King's Knight
    ("e7e5", "g1f3", "b8c6"): ["f1b5"],  # Ruy Lopez (Fischer's main weapon)

    # Ruy Lopez main lines
    ("e7e5", "g1f3", "b8c6", "f1b5", "a7a6"): ["b5a4"],  # Morphy Defense
    ("e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6"): ["e1g1"],  # Castle
    ("e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7"): ["f1e1"],  # Closed Ruy Lopez

    # Against Sicilian Defense (Fischer faced this often)
    ("c7c5",): ["g1f3"],  # Open Sicilian
    ("c7c5", "g1f3", "d7d6"): ["d2d4"],  # Najdorf preparation
    ("c7c5", "g1f3", "d7d6", "d2d4", "c5d4"): ["f3d4"],
    ("c7c5", "g1f3", "b8c6"): ["d2d4"],  # Classical
    ("c7c5", "g1f3", "e7e6"): ["d2d4"],  # Paulsen/Taimanov

    # Against French Defense
    ("e7e6",): ["d2d4"],
    ("e7e6", "d2d4", "d7d5"): ["b1c3"],  # Classical French

    # Against Caro-Kann
    ("c7c6",): ["d2d4"],
    ("c7c6", "d2d4", "d7d5"): ["b1c3"],  # Classical Caro-Kann

    # Against Pirc/Modern
    ("d7d6",): ["d2d4"],
    ("d7d6", "d2d4", "g8f6"): ["b1c3"],  # Pirc Defense

    # Against Alekhine's Defense
    ("g8f6",): ["e4e5"],  # Chase the knight
}

# Fischer's repertoire as Black
FISCHER_BLACK_OPENINGS = {
    # Against 1.e4 - Fischer played various defenses
    ("e2e4",): ["e7e5", "c7c5", "e7e6"],  # King's Pawn, Sicilian, or French

    # Against 1.d4 - Fischer often played King's Indian or Grunfeld
    ("d2d4",): ["g8f6"],  # Flexible
    ("d2d4", "g8f6", "c2c4"): ["g7g6"],  # King's Indian setup
    ("d2d4", "g8f6", "c2c4", "g7g6", "b1c3"): ["f8g7"],
    ("d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "f8g7", "e2e4"): ["d7d6"],  # King's Indian

    # Against 1.c4 (English)
    ("c2c4",): ["e7e5", "g8f6"],  # Reverse Sicilian or Indian setup

    # Against 1.Nf3
    ("g1f3",): ["g8f6", "d7d5"],  # Flexible
}


def get_opening_move(board: chess.Board, color: chess.Color) -> chess.Move:
    """
    Get an opening move from Fischer's repertoire.
    Returns None if no book move is found.
    """
    move_sequence = get_move_sequence(board)

    openings = FISCHER_WHITE_OPENINGS if color == chess.WHITE else FISCHER_BLACK_OPENINGS

    # Look for matching position in opening book
    if move_sequence in openings:
        possible_moves = openings[move_sequence]
        move_uci = random.choice(possible_moves)

        try:
            move = chess.Move.from_uci(move_uci)
            if move in board.legal_moves:
                return move
        except:
            pass

    return None


def get_move_sequence(board: chess.Board) -> tuple:
    """
    Get the sequence of moves from the starting position.
    Returns tuple of UCI move strings.
    """
    if board.move_stack:
        return tuple(move.uci() for move in board.move_stack)
    return ()


def is_in_opening_book(board: chess.Board, color: chess.Color) -> bool:
    """
    Check if current position is in the opening book.
    """
    move_sequence = get_move_sequence(board)
    openings = FISCHER_WHITE_OPENINGS if color == chess.WHITE else FISCHER_BLACK_OPENINGS
    return move_sequence in openings


# Fischer's opening principles (when not in book)
def get_principled_opening_move(board: chess.Board, legal_moves: list) -> chess.Move:
    """
    When out of book, apply Fischer's opening principles:
    1. Control the center
    2. Develop pieces quickly
    3. Castle early
    4. Don't move the same piece twice
    """
    # Prefer center pawn moves early
    center_pawn_moves = []
    for move in legal_moves:
        if board.piece_at(move.from_square) and board.piece_at(move.from_square).piece_type == chess.PAWN:
            if move.to_square in [chess.E4, chess.D4, chess.E5, chess.D5]:
                center_pawn_moves.append(move)

    if center_pawn_moves:
        return random.choice(center_pawn_moves)

    # Develop knights toward center
    knight_moves = []
    for move in legal_moves:
        piece = board.piece_at(move.from_square)
        if piece and piece.piece_type == chess.KNIGHT:
            # Prefer Nf3, Nc3 for white or Nf6, Nc6 for black
            if move.to_square in [chess.F3, chess.C3, chess.F6, chess.C6]:
                knight_moves.append(move)

    if knight_moves:
        return random.choice(knight_moves)

    # Castle if possible
    castling_moves = [move for move in legal_moves if board.is_castling(move)]
    if castling_moves:
        return random.choice(castling_moves)

    # Develop bishops
    bishop_moves = []
    for move in legal_moves:
        piece = board.piece_at(move.from_square)
        if piece and piece.piece_type == chess.BISHOP:
            # Prefer active squares
            bishop_moves.append(move)

    if bishop_moves:
        return random.choice(bishop_moves)

    # Default: return random legal move
    return random.choice(legal_moves)
