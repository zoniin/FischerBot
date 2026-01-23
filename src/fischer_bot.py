"""
Fischer Bot - Main chess engine implementation.
Uses alpha-beta search with Fischer-style evaluation.
"""

import chess
import random
from typing import Tuple, Optional
from .evaluation import evaluate_position
from .openings import get_opening_move, get_principled_opening_move, is_in_opening_book


class FischerBot:
    """
    Chess engine inspired by Bobby Fischer's playing style.

    Characteristics:
    - Aggressive, tactical play
    - Strong opening preparation
    - Excellent endgame technique
    - Preference for active piece play
    """

    def __init__(self, max_depth: int = 4, use_opening_book: bool = True):
        """
        Initialize the Fischer Bot.

        Args:
            max_depth: Maximum search depth (default 4 for reasonable speed)
            use_opening_book: Whether to use Fischer's opening repertoire
        """
        self.max_depth = max_depth
        self.use_opening_book = use_opening_book
        self.nodes_searched = 0
        self.transposition_table = {}
        self.killer_moves = {}  # Store killer moves for better move ordering

    def get_move(self, board: chess.Board) -> chess.Move:
        """
        Get the best move for the current position.

        Args:
            board: Current chess position

        Returns:
            Best move according to Fischer's style
        """
        self.nodes_searched = 0
        # Don't clear transposition table - it speeds up searches!
        # Only clear if it gets too large
        if len(self.transposition_table) > 10000:
            self.transposition_table.clear()

        # Check opening book first
        if self.use_opening_book and len(board.move_stack) < 15:
            book_move = get_opening_move(board, board.turn)
            if book_move:
                print(f"Fischer Bot (Book): {book_move.uci()}")
                return book_move

            # If out of book but still in opening, use principled moves
            if len(board.move_stack) < 10:
                principled_move = get_principled_opening_move(board, list(board.legal_moves))
                print(f"Fischer Bot (Principles): {principled_move.uci()}")
                return principled_move

        # Search for best move
        best_move, best_score = self.search(board, self.max_depth)

        print(f"Fischer Bot: {best_move.uci()} (score: {best_score:.1f}, nodes: {self.nodes_searched})")

        return best_move

    def search(self, board: chess.Board, depth: int) -> Tuple[Optional[chess.Move], float]:
        """
        Search for the best move using alpha-beta pruning.

        Args:
            board: Current position
            depth: Search depth

        Returns:
            Tuple of (best_move, score)
        """
        legal_moves = list(board.legal_moves)

        if not legal_moves:
            return None, evaluate_position(board)

        # Order moves for better alpha-beta pruning (Fischer loved tactics!)
        ordered_moves = self.order_moves(board, legal_moves)

        best_move = ordered_moves[0]
        best_score = float('-inf') if board.turn == chess.WHITE else float('inf')

        alpha = float('-inf')
        beta = float('inf')

        for move in ordered_moves:
            board.push(move)
            score = self.alpha_beta(board, depth - 1, alpha, beta, not board.turn)
            board.pop()

            if board.turn == chess.WHITE:
                if score > best_score:
                    best_score = score
                    best_move = move
                alpha = max(alpha, score)
            else:
                if score < best_score:
                    best_score = score
                    best_move = move
                beta = min(beta, score)

        return best_move, best_score

    def alpha_beta(self, board: chess.Board, depth: int, alpha: float, beta: float,
                   maximizing: bool) -> float:
        """
        Alpha-beta pruning search.

        Args:
            board: Current position
            depth: Remaining search depth
            alpha: Alpha value for pruning
            beta: Beta value for pruning
            maximizing: Whether this is a maximizing node

        Returns:
            Position evaluation score
        """
        self.nodes_searched += 1

        # Check transposition table
        board_hash = hash(board.fen())
        if board_hash in self.transposition_table:
            cached_depth, cached_score = self.transposition_table[board_hash]
            if cached_depth >= depth:
                return cached_score

        # Terminal node or max depth reached
        if depth == 0 or board.is_game_over():
            score = self.quiescence_search(board, alpha, beta, maximizing, 2)
            self.transposition_table[board_hash] = (depth, score)
            return score

        legal_moves = list(board.legal_moves)
        ordered_moves = self.order_moves(board, legal_moves)

        if maximizing:
            max_eval = float('-inf')
            for move in ordered_moves:
                board.push(move)
                eval_score = self.alpha_beta(board, depth - 1, alpha, beta, False)
                board.pop()
                max_eval = max(max_eval, eval_score)
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break  # Beta cutoff
            self.transposition_table[board_hash] = (depth, max_eval)
            return max_eval
        else:
            min_eval = float('inf')
            for move in ordered_moves:
                board.push(move)
                eval_score = self.alpha_beta(board, depth - 1, alpha, beta, True)
                board.pop()
                min_eval = min(min_eval, eval_score)
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break  # Alpha cutoff
            self.transposition_table[board_hash] = (depth, min_eval)
            return min_eval

    def quiescence_search(self, board: chess.Board, alpha: float, beta: float,
                         maximizing: bool, depth: int) -> float:
        """
        Quiescence search to avoid horizon effect.
        Fischer was known for seeing tactics deeply!

        Only searches captures and checks to reach a quiet position.
        """
        stand_pat = evaluate_position(board)

        if depth == 0 or board.is_game_over():
            return stand_pat

        if maximizing:
            if stand_pat >= beta:
                return beta
            alpha = max(alpha, stand_pat)
        else:
            if stand_pat <= alpha:
                return alpha
            beta = min(beta, stand_pat)

        # Only consider tactical moves (captures, checks, promotions)
        tactical_moves = []
        for move in board.legal_moves:
            if board.is_capture(move) or board.gives_check(move) or move.promotion:
                tactical_moves.append(move)

        if not tactical_moves:
            return stand_pat

        ordered_moves = self.order_moves(board, tactical_moves)

        if maximizing:
            max_eval = stand_pat
            for move in ordered_moves:
                board.push(move)
                eval_score = self.quiescence_search(board, alpha, beta, False, depth - 1)
                board.pop()
                max_eval = max(max_eval, eval_score)
                alpha = max(alpha, eval_score)
                if beta <= alpha:
                    break
            return max_eval
        else:
            min_eval = stand_pat
            for move in ordered_moves:
                board.push(move)
                eval_score = self.quiescence_search(board, alpha, beta, True, depth - 1)
                board.pop()
                min_eval = min(min_eval, eval_score)
                beta = min(beta, eval_score)
                if beta <= alpha:
                    break
            return min_eval

    def order_moves(self, board: chess.Board, moves: list) -> list:
        """
        Order moves for better alpha-beta pruning.
        Fischer's tactical eye prioritized forcing moves!

        Priority order:
        1. Checkmate
        2. Captures (MVV-LVA)
        3. Checks
        4. Promotions
        5. Other moves
        """
        def move_priority(move):
            priority = 0

            # Checkmate gets highest priority
            board.push(move)
            if board.is_checkmate():
                priority += 10000
            board.pop()

            # Captures (Most Valuable Victim - Least Valuable Attacker)
            if board.is_capture(move):
                captured_piece = board.piece_at(move.to_square)
                moving_piece = board.piece_at(move.from_square)
                if captured_piece and moving_piece:
                    from .evaluation import PIECE_VALUES
                    priority += PIECE_VALUES[captured_piece.piece_type] * 10
                    priority -= PIECE_VALUES[moving_piece.piece_type]

            # Checks
            if board.gives_check(move):
                priority += 500

            # Promotions
            if move.promotion:
                from .evaluation import PIECE_VALUES
                priority += PIECE_VALUES[move.promotion]

            # Castle (Fischer liked to castle!)
            if board.is_castling(move):
                priority += 300

            # Center control
            if move.to_square in [chess.E4, chess.D4, chess.E5, chess.D5]:
                priority += 50

            return priority

        return sorted(moves, key=move_priority, reverse=True)

    def set_depth(self, depth: int):
        """Set the search depth."""
        self.max_depth = depth

    def toggle_opening_book(self, use_book: bool):
        """Enable or disable opening book."""
        self.use_opening_book = use_book
