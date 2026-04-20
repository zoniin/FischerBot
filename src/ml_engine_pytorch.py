"""
PyTorch-based ML engine for Fischer Bot.
Implements a deep neural network trained on Bobby Fischer's games.
"""

import chess
import numpy as np
import pickle
import os
from pathlib import Path
from typing import Optional, List, Tuple

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except ImportError:
    TORCH_AVAILABLE = False
    print("PyTorch not available. Install with: pip install torch")


class FischerNN(nn.Module):
    """
    Deep Neural Network for predicting Fischer's moves.

    Architecture:
    - Input: 773 features (board state)
    - Hidden layers: 1024 -> 512 -> 256
    - Output: 4096 (all possible moves)
    """

    def __init__(self, input_size=773, hidden_sizes=[1024, 512, 256], output_size=4096):
        super(FischerNN, self).__init__()

        # Build layers
        layers = []
        prev_size = input_size

        for hidden_size in hidden_sizes:
            layers.append(nn.Linear(prev_size, hidden_size))
            layers.append(nn.ReLU())
            layers.append(nn.Dropout(0.3))
            prev_size = hidden_size

        # Output layer
        layers.append(nn.Linear(prev_size, output_size))

        self.network = nn.Sequential(*layers)

    def forward(self, x):
        """Forward pass through the network."""
        return self.network(x)


class FischerMLEnginePyTorch:
    """
    PyTorch-based ML engine for Fischer Bot.
    """

    def __init__(self, model_path: Optional[str] = None, device: str = 'cpu'):
        """
        Initialize the PyTorch ML engine.

        Args:
            model_path: Path to trained model file
            device: 'cpu' or 'cuda'
        """
        if not TORCH_AVAILABLE:
            raise ImportError("PyTorch is required for this engine")

        self.device = torch.device(device if torch.cuda.is_available() else 'cpu')
        self.model = None
        self.model_loaded = False

        if model_path and os.path.exists(model_path):
            self.load_model(model_path)
        else:
            # Initialize new model
            self.model = FischerNN().to(self.device)

    def board_to_features(self, board: chess.Board) -> np.ndarray:
        """
        Convert chess board to feature vector.

        Features:
        - Piece positions (12 channels: 6 types x 2 colors) = 768
        - Castling rights (4 values)
        - Side to move (1 value)

        Returns:
            Feature vector of shape (773,)
        """
        features = np.zeros(773, dtype=np.float32)

        # Piece placement (12 x 64 = 768)
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
        if not self.model_loaded and self.model is None:
            return {}

        self.model.eval()

        with torch.no_grad():
            # Get features
            features = self.board_to_features(board)
            features_tensor = torch.FloatTensor(features).unsqueeze(0).to(self.device)

            # Get predictions
            logits = self.model(features_tensor)
            probs = F.softmax(logits, dim=1).cpu().numpy()[0]

        # Filter to legal moves only
        legal_moves = list(board.legal_moves)
        legal_move_probs = {}

        for move in legal_moves:
            move_idx = move.from_square * 64 + move.to_square
            legal_move_probs[move] = probs[move_idx]

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
        if not self.model_loaded and self.model is None:
            # Fallback to random legal moves
            legal_moves = list(board.legal_moves)
            return [(m, 1.0/len(legal_moves)) for m in legal_moves[:top_k]]

        move_probs = self.predict_move_probabilities(board)

        # Sort by probability and return top-k
        sorted_moves = sorted(move_probs.items(), key=lambda x: x[1], reverse=True)
        return sorted_moves[:top_k]

    def get_best_move(self, board: chess.Board) -> Optional[chess.Move]:
        """Get the single best move according to ML model."""
        top_moves = self.get_top_moves(board, top_k=1)
        return top_moves[0][0] if top_moves else None

    def load_model(self, model_path: str):
        """Load trained model from file."""
        try:
            checkpoint = torch.load(model_path, map_location=self.device)

            # Create model if needed
            if self.model is None:
                self.model = FischerNN().to(self.device)

            # Load state dict
            self.model.load_state_dict(checkpoint['model_state_dict'])
            self.model.eval()
            self.model_loaded = True

            print(f"Loaded PyTorch model from {model_path}")
            if 'epoch' in checkpoint:
                print(f"Model trained for {checkpoint['epoch']} epochs")
            if 'loss' in checkpoint:
                print(f"Final loss: {checkpoint['loss']:.4f}")

        except Exception as e:
            print(f"Failed to load model: {e}")
            self.model_loaded = False

    def save_model(self, model_path: str, epoch: int = 0, loss: float = 0.0):
        """Save trained model to file."""
        if self.model is None:
            raise ValueError("No model to save")

        checkpoint = {
            'model_state_dict': self.model.state_dict(),
            'epoch': epoch,
            'loss': loss,
        }

        torch.save(checkpoint, model_path)
        print(f"Saved PyTorch model to {model_path}")
