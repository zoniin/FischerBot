"""
Enhanced Fischer Bot with ML integration.
Combines traditional alpha-beta search with ML-based move prediction.
"""

import chess
from typing import Optional, Tuple
from .fischer_bot import FischerBot
from .ml_engine import FischerMLEngine
from .evaluation import evaluate_position
from pathlib import Path


class FischerBotML(FischerBot):
    """
    Enhanced Fischer Bot that combines traditional search with ML predictions.

    This bot uses a hybrid approach:
    1. ML model suggests candidate moves based on Fischer's style
    2. Alpha-beta search evaluates these candidates deeply
    3. Combines both for Fischer-like play
    """

    def __init__(self, max_depth: int = 4, use_opening_book: bool = True,
                 use_ml: bool = True, ml_weight: float = 0.4):
        """
        Initialize the ML-enhanced Fischer Bot.

        Args:
            max_depth: Maximum search depth
            use_opening_book: Whether to use Fischer's opening repertoire
            use_ml: Whether to use ML model
            ml_weight: Weight for ML predictions (0.0 to 1.0)
                      0.0 = pure alpha-beta, 1.0 = pure ML
        """
        super().__init__(max_depth, use_opening_book)

        self.use_ml = use_ml
        self.ml_weight = ml_weight
        self.ml_engine = None

        # Try to load ML model
        if use_ml:
            model_path = Path(__file__).parent.parent / "models" / "fischer_model.pkl"
            if model_path.exists():
                self.ml_engine = FischerMLEngine(str(model_path))
                print("ML model loaded successfully")
            else:
                print(f"ML model not found at {model_path}")
                print("Run 'python train_model.py' to train the model")
                print("Falling back to traditional search")
                self.use_ml = False

    def get_move(self, board: chess.Board) -> chess.Move:
        """
        Get the best move using hybrid ML + alpha-beta approach.

        Args:
            board: Current chess position

        Returns:
            Best move according to Fischer's style
        """
        self.nodes_searched = 0
        self.transposition_table.clear()

        # Check opening book first (Fischer's preparation was legendary!)
        if self.use_opening_book and len(board.move_stack) < 15:
            from .openings import get_opening_move, get_principled_opening_move

            book_move = get_opening_move(board, board.turn)
            if book_move:
                print(f"Fischer Bot ML (Book): {book_move.uci()}")
                return book_move

            if len(board.move_stack) < 10:
                principled_move = get_principled_opening_move(board, list(board.legal_moves))
                print(f"Fischer Bot ML (Principles): {principled_move.uci()}")
                return principled_move

        # Use hybrid ML + search approach
        if self.use_ml and self.ml_engine and self.ml_engine.model_loaded:
            return self.get_hybrid_move(board)
        else:
            # Fallback to pure alpha-beta search
            best_move, best_score = self.search(board, self.max_depth)
            print(f"Fischer Bot ML (Search): {best_move.uci()} (score: {best_score:.1f})")
            return best_move

    def get_hybrid_move(self, board: chess.Board) -> chess.Move:
        """
        Get move using hybrid ML + search approach.

        Strategy:
        1. ML model suggests top-k candidate moves
        2. Search each candidate with alpha-beta
        3. Combine ML probability with search score
        """
        # Get ML predictions
        top_ml_moves = self.ml_engine.get_top_moves(board, top_k=5)

        if not top_ml_moves:
            # Fallback to pure search
            best_move, best_score = self.search(board, self.max_depth)
            return best_move

        # Evaluate each candidate with alpha-beta search
        best_move = None
        best_combined_score = float('-inf') if board.turn == chess.WHITE else float('inf')

        for ml_move, ml_prob in top_ml_moves:
            # Search this move
            board.push(ml_move)
            search_score = self.alpha_beta(
                board, self.max_depth - 1,
                float('-inf'), float('inf'),
                not board.turn
            )
            board.pop()

            # Combine ML probability with search score
            # ML probability is in [0, 1], search score is in centipawns
            # Normalize and combine
            ml_component = ml_prob * 1000  # Scale ML prob to centipawn range
            search_component = search_score

            combined_score = (
                self.ml_weight * ml_component +
                (1 - self.ml_weight) * search_component
            )

            # Track best move
            if board.turn == chess.WHITE:
                if combined_score > best_combined_score:
                    best_combined_score = combined_score
                    best_move = ml_move
            else:
                if combined_score < best_combined_score:
                    best_combined_score = combined_score
                    best_move = ml_move

        print(f"Fischer Bot ML (Hybrid): {best_move.uci()} " +
              f"(combined score: {best_combined_score:.1f}, nodes: {self.nodes_searched})")

        return best_move

    def set_ml_weight(self, weight: float):
        """
        Adjust the balance between ML and search.

        Args:
            weight: ML weight (0.0 = pure search, 1.0 = pure ML)
        """
        self.ml_weight = max(0.0, min(1.0, weight))
        print(f"ML weight set to {self.ml_weight:.2f}")

    def get_fischer_analysis(self, board: chess.Board) -> dict:
        """
        Get detailed analysis showing both ML and search perspectives.

        Returns:
            Dictionary with analysis information
        """
        analysis = {
            'position_fen': board.fen(),
            'ml_top_moves': [],
            'search_best_move': None,
            'hybrid_best_move': None
        }

        # ML predictions
        if self.use_ml and self.ml_engine and self.ml_engine.model_loaded:
            top_moves = self.ml_engine.get_top_moves(board, top_k=5)
            analysis['ml_top_moves'] = [
                {'move': move.uci(), 'probability': prob}
                for move, prob in top_moves
            ]

        # Pure search
        search_move, search_score = self.search(board, self.max_depth)
        analysis['search_best_move'] = {
            'move': search_move.uci(),
            'score': search_score
        }

        # Hybrid
        hybrid_move = self.get_hybrid_move(board) if self.use_ml else search_move
        analysis['hybrid_best_move'] = hybrid_move.uci()

        return analysis
