"""
Evaluate the trained Fischer ML model.
Tests the model's ability to predict Fischer's moves.
"""

import sys
from pathlib import Path
import chess
import chess.pgn

# Add src to path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from src.ml_engine_pytorch import FischerMLEnginePyTorch
    PYTORCH_AVAILABLE = True
except ImportError:
    print("PyTorch not available, using fallback model")
    from src.ml_engine import FischerMLEngine
    PYTORCH_AVAILABLE = False

from src.fischer_dataset import load_default_dataset


def evaluate_on_dataset(model_path: str, num_positions: int = 100):
    """
    Evaluate model on Fischer's games.

    Args:
        model_path: Path to trained model
        num_positions: Number of positions to test
    """
    print("="*80)
    print("Fischer Bot ML Model Evaluation")
    print("="*80)
    print()

    # Load model
    print(f"Loading model from {model_path}...")

    if PYTORCH_AVAILABLE:
        ml_engine = FischerMLEnginePyTorch(model_path)
    else:
        ml_engine = FischerMLEngine(model_path)

    if not ml_engine.model_loaded:
        print("ERROR: Failed to load model")
        return

    print("Model loaded successfully")
    print()

    # Load dataset
    print("Loading Fischer's games...")
    dataset = load_default_dataset()
    dataset.extract_positions()

    positions = dataset.positions[:num_positions]
    print(f"Testing on {len(positions)} positions")
    print()

    # Evaluate
    top1_correct = 0
    top3_correct = 0
    top5_correct = 0

    print("Evaluating...")
    for i, (board, correct_move) in enumerate(positions):
        if (i + 1) % 20 == 0:
            print(f"  Progress: {i+1}/{len(positions)}")

        # Get model predictions
        top_moves = ml_engine.get_top_moves(board, top_k=5)

        # Check if correct move is in top-k
        predicted_moves = [move for move, prob in top_moves]

        if len(predicted_moves) > 0 and predicted_moves[0] == correct_move:
            top1_correct += 1
            top3_correct += 1
            top5_correct += 1
        elif correct_move in predicted_moves[:3]:
            top3_correct += 1
            top5_correct += 1
        elif correct_move in predicted_moves[:5]:
            top5_correct += 1

    # Calculate accuracies
    top1_acc = top1_correct / len(positions) * 100
    top3_acc = top3_correct / len(positions) * 100
    top5_acc = top5_correct / len(positions) * 100

    print()
    print("="*80)
    print("Evaluation Results")
    print("="*80)
    print(f"Positions tested: {len(positions)}")
    print()
    print(f"Top-1 Accuracy: {top1_acc:.2f}% ({top1_correct}/{len(positions)})")
    print(f"Top-3 Accuracy: {top3_acc:.2f}% ({top3_correct}/{len(positions)})")
    print(f"Top-5 Accuracy: {top5_acc:.2f}% ({top5_correct}/{len(positions)})")
    print()

    # Interpretation
    print("Interpretation:")
    if top1_acc > 40:
        print("  Excellent! Model has learned Fischer's style very well.")
    elif top1_acc > 25:
        print("  Good! Model shows understanding of Fischer's preferences.")
    elif top1_acc > 15:
        print("  Moderate. Model captures some of Fischer's style.")
    else:
        print("  Needs improvement. Consider more training data or epochs.")
    print()


def test_specific_position():
    """Test model on a specific famous Fischer position."""
    print("="*80)
    print("Testing on Famous Fischer Position")
    print("="*80)
    print()

    # Game 6 of 1972 World Championship
    # Position after Black's 14...Nf6
    fen = "r1bq1rk1/p3bppp/2p1pn2/1p1n4/3P4/2N2NP1/PP2PPBP/R1BQ1RK1 w - - 5 10"

    board = chess.Board(fen)

    print("Position: Game 6, 1972 World Championship")
    print(f"FEN: {fen}")
    print()
    print(board)
    print()

    # Load model
    model_path = Path(__file__).parent / "models" / "fischer_model_pytorch.pth"

    if not model_path.exists():
        print(f"Model not found at {model_path}")
        print("Train the model first with: python train_model_pytorch.py")
        return

    if PYTORCH_AVAILABLE:
        ml_engine = FischerMLEnginePyTorch(str(model_path))
    else:
        ml_engine = FischerMLEngine(str(model_path))

    if not ml_engine.model_loaded:
        print("Failed to load model")
        return

    # Get predictions
    print("Model predictions:")
    top_moves = ml_engine.get_top_moves(board, top_k=5)

    for i, (move, prob) in enumerate(top_moves, 1):
        print(f"  {i}. {board.san(move):6s} - {prob*100:.2f}%")

    print()
    print("Fischer played: e4 (strengthening center)")
    print()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Evaluate Fischer Bot ML model')
    parser.add_argument('--model', type=str, default='models/fischer_model_pytorch.pth',
                       help='Path to model file')
    parser.add_argument('--positions', type=int, default=100,
                       help='Number of positions to evaluate')
    parser.add_argument('--specific', action='store_true',
                       help='Test on specific famous position')

    args = parser.parse_args()

    if args.specific:
        test_specific_position()
    else:
        evaluate_on_dataset(args.model, args.positions)
