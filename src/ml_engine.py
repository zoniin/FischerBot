"""
ML-based chess engine that learns from Bobby Fischer's games.
Uses a neural network to predict moves based on Fischer's playing style.
"""

import chess
import numpy as np
import pickle
import os
from pathlib import Path
from typing import Optional, List, Tuple


class FischerMLEngine:
    """
    Machine Learning engine trained on Fischer's games.
    Predicts moves that Fischer would likely play.
    """

    def __init__(self, model_path: Optional[str] = None):
        """
        Initialize the ML engine.

        Args:
            model_path: Path to trained model file
        """
        self.model = None
        self.model_loaded = False

        if model_path and os.path.exists(model_path):
            self.load_model(model_path)

    def board_to_features(self, board: chess.Board) -> np.ndarray:
        """
        Convert chess board to feature vector for ML model.

        Features include:
        - Piece positions (12 channels: 6 piece types x 2 colors)
        - Castling rights (4 values)
        - En passant square (1 value)
        - Side to move (1 value)
        - Move count (1 value)

        Returns:
            Feature vector of shape (773,): 768 for pieces + 5 for game state
        """
        features = np.zeros(773, dtype=np.float32)

        # Piece placement (12 x 64 = 768 values)
        piece_idx = 0
        for piece_type in [chess.PAWN, chess.KNIGHT, chess.BISHOP,
                          chess.ROOK, chess.QUEEN, chess.KING]:
            for color in [chess.WHITE, chess.BLACK]:
                pieces = board.pieces(piece_type, color)
                for square in pieces:
                    features[piece_idx * 64 + square] = 1.0
                piece_idx += 1

        # Castling rights (768-771)
        features[768] = 1.0 if board.has_kingside_castling_rights(chess.WHITE) else 0.0
        features[769] = 1.0 if board.has_queenside_castling_rights(chess.WHITE) else 0.0
        features[770] = 1.0 if board.has_kingside_castling_rights(chess.BLACK) else 0.0
        features[771] = 1.0 if board.has_queenside_castling_rights(chess.BLACK) else 0.0

        # Side to move (772)
        features[772] = 1.0 if board.turn == chess.WHITE else 0.0

        return features

    def predict_move_probabilities(self, board: chess.Board) -> dict:
        """
        Predict probability distribution over legal moves.

        Args:
            board: Current chess position

        Returns:
            Dictionary mapping moves to probabilities
        """
        if not self.model_loaded:
            return {}

        features = self.board_to_features(board)

        # Get move probabilities from model
        # The model outputs a probability for each of the 4096 possible moves
        # (64 source squares x 64 destination squares)
        move_probs = self.model.predict(features.reshape(1, -1))[0]

        # Filter to legal moves only
        legal_moves = list(board.legal_moves)
        legal_move_probs = {}

        for move in legal_moves:
            move_idx = move.from_square * 64 + move.to_square
            legal_move_probs[move] = move_probs[move_idx]

        # Normalize probabilities
        total = sum(legal_move_probs.values())
        if total > 0:
            legal_move_probs = {m: p/total for m, p in legal_move_probs.items()}

        return legal_move_probs

    def get_top_moves(self, board: chess.Board, top_k: int = 3) -> List[Tuple[chess.Move, float]]:
        """
        Get top-k moves according to ML model.

        Args:
            board: Current position
            top_k: Number of top moves to return

        Returns:
            List of (move, probability) tuples, sorted by probability
        """
        if not self.model_loaded:
            # Fallback to random legal moves
            legal_moves = list(board.legal_moves)
            return [(m, 1.0/len(legal_moves)) for m in legal_moves[:top_k]]

        move_probs = self.predict_move_probabilities(board)

        # Sort by probability and return top-k
        sorted_moves = sorted(move_probs.items(), key=lambda x: x[1], reverse=True)
        return sorted_moves[:top_k]

    def get_best_move(self, board: chess.Board) -> Optional[chess.Move]:
        """
        Get the single best move according to ML model.

        Args:
            board: Current position

        Returns:
            Best move or None if model not loaded
        """
        top_moves = self.get_top_moves(board, top_k=1)
        return top_moves[0][0] if top_moves else None

    def load_model(self, model_path: str):
        """Load trained model from file."""
        try:
            with open(model_path, 'rb') as f:
                self.model = pickle.load(f)
            self.model_loaded = True
            print(f"Loaded ML model from {model_path}")
        except Exception as e:
            print(f"Failed to load model: {e}")
            self.model_loaded = False

    def save_model(self, model_path: str):
        """Save trained model to file."""
        if self.model is None:
            raise ValueError("No model to save")

        with open(model_path, 'wb') as f:
            pickle.dump(self.model, f)
        print(f"Saved ML model to {model_path}")


class SimpleNeuralNetwork:
    """
    Simple neural network for move prediction.
    Can be replaced with more sophisticated models (PyTorch, TensorFlow, etc.)
    """

    def __init__(self, input_size: int = 773, hidden_size: int = 512, output_size: int = 4096):
        """
        Initialize network weights.

        Args:
            input_size: Number of input features
            hidden_size: Hidden layer size
            output_size: Number of possible moves (64*64)
        """
        # Initialize weights with small random values
        self.W1 = np.random.randn(input_size, hidden_size) * 0.01
        self.b1 = np.zeros(hidden_size)
        self.W2 = np.random.randn(hidden_size, output_size) * 0.01
        self.b2 = np.zeros(output_size)

    def relu(self, x):
        """ReLU activation."""
        return np.maximum(0, x)

    def softmax(self, x):
        """Softmax activation."""
        exp_x = np.exp(x - np.max(x))
        return exp_x / exp_x.sum()

    def predict(self, x):
        """
        Forward pass through network.

        Args:
            x: Input features of shape (batch_size, input_size)

        Returns:
            Move probabilities of shape (batch_size, output_size)
        """
        # Hidden layer
        h = self.relu(np.dot(x, self.W1) + self.b1)

        # Output layer
        logits = np.dot(h, self.W2) + self.b2

        # Apply softmax to each sample
        if len(logits.shape) == 1:
            return self.softmax(logits)
        else:
            return np.array([self.softmax(row) for row in logits])
