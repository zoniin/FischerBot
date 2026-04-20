"""
Example usage of the ML-enhanced Fischer Bot.
Demonstrates the hybrid ML + search approach.
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import chess
from src.fischer_bot_ml import FischerBotML
from src.fischer_bot import FischerBot


def demo_ml_bot():
    """Demonstrate the ML-enhanced Fischer Bot."""
    print("="*70)
    print("Fischer Bot ML Demonstration")
    print("Hybrid ML + Search Chess Engine")
    print("="*70)
    print()

    # Create ML-enhanced bot
    print("Initializing Fischer Bot with ML...")
    ml_bot = FischerBotML(
        max_depth=4,
        use_opening_book=True,
        use_ml=True,
        ml_weight=0.4  # 40% ML, 60% search
    )
    print()

    # Create standard bot for comparison
    standard_bot = FischerBot(max_depth=4, use_opening_book=True)

    # Set up a position
    board = chess.Board()

    print("Starting Position:")
    print(board)
    print()

    # Play a few moves
    print("Let's play the first few moves...")
    print()

    for move_num in range(1, 6):
        print(f"\n--- Move {move_num} ---")

        # White's move (ML bot)
        if board.turn == chess.WHITE:
            print(f"\nWhite to move (ML Bot):")
            move = ml_bot.get_move(board)
            print(f"  Playing: {move.uci()}")
            board.push(move)
        else:
            print(f"\nBlack to move (Standard Bot):")
            move = standard_bot.get_move(board)
            print(f"  Playing: {move.uci()}")
            board.push(move)

        print(f"\nPosition after move {move_num}:")
        print(board)

    print()
    print("="*70)
    print("Fischer-Style Analysis")
    print("="*70)
    print()

    # Get analysis
    if hasattr(ml_bot, 'get_fischer_analysis'):
        analysis = ml_bot.get_fischer_analysis(board)

        print("Current Position FEN:", analysis['position_fen'])
        print()

        if analysis.get('ml_top_moves'):
            print("ML Model's Top Moves:")
            for i, move_data in enumerate(analysis['ml_top_moves'], 1):
                print(f"  {i}. {move_data['move']} " +
                      f"(probability: {move_data['probability']:.3f})")
            print()

        if analysis.get('search_best_move'):
            move_data = analysis['search_best_move']
            print(f"Alpha-Beta Search Best Move: {move_data['move']} " +
                  f"(score: {move_data['score']:.1f})")
            print()

        print(f"Hybrid Recommendation: {analysis.get('hybrid_best_move')}")

    print()
    print("="*70)
    print("Adjusting ML Weight")
    print("="*70)
    print()

    test_position = chess.Board("r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3")
    print("Test Position (Ruy Lopez):")
    print(test_position)
    print()

    weights = [0.0, 0.3, 0.5, 0.7, 1.0]
    print("Testing different ML weights:")
    print()

    for weight in weights:
        ml_bot.set_ml_weight(weight)
        move = ml_bot.get_move(test_position.copy())
        print(f"  ML Weight {weight:.1f}: {move.uci()}")

    print()
    print("="*70)
    print("Comparison: ML Bot vs Standard Bot")
    print("="*70)
    print()

    # Test on a tactical position
    tactical_position = chess.Board(
        "r1bq1rk1/ppp2ppp/2n2n2/2bpp3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R w KQ - 0 7"
    )
    print("Tactical Position:")
    print(tactical_position)
    print()

    print("Standard Bot (pure search):")
    standard_move = standard_bot.get_move(tactical_position.copy())
    print()

    print("ML Bot (hybrid):")
    ml_bot.set_ml_weight(0.4)
    ml_move = ml_bot.get_move(tactical_position.copy())
    print()

    print(f"Chosen moves - Standard: {standard_move.uci()}, ML: {ml_move.uci()}")

    if standard_move == ml_move:
        print("Both bots agree!")
    else:
        print("Different choices - ML bot shows Fischer's style!")

    print()
    print("="*70)
    print("Demo Complete")
    print("="*70)
    print()
    print("Key Takeaways:")
    print("  1. ML bot learns from Fischer's actual games")
    print("  2. Hybrid approach combines intuition with tactics")
    print("  3. Adjustable ML weight allows tuning playing style")
    print("  4. Opening book ensures Fischer's favorite lines")
    print()


def compare_bots_on_position(fen: str):
    """
    Compare ML bot and standard bot on a specific position.

    Args:
        fen: FEN string of the position
    """
    board = chess.Board(fen)

    print(f"Position: {fen}")
    print(board)
    print()

    # Standard bot
    standard_bot = FischerBot(max_depth=4)
    standard_move, standard_score = standard_bot.search(board, 4)
    print(f"Standard Bot: {standard_move.uci()} (score: {standard_score:.1f})")

    # ML bot
    ml_bot = FischerBotML(max_depth=4, use_ml=True, ml_weight=0.4)
    ml_move = ml_bot.get_move(board)
    print(f"ML Bot: {ml_move.uci()}")

    return standard_move, ml_move


if __name__ == "__main__":
    try:
        demo_ml_bot()
    except FileNotFoundError as e:
        print()
        print("Note: ML model not found. To use ML features:")
        print("  1. Run: python train_model.py")
        print("  2. This will train the model on Fischer's games")
        print("  3. Then run this demo again")
        print()
        print("Falling back to standard bot demonstration...")
        print()

        # Show standard bot
        from src.fischer_bot import FischerBot
        bot = FischerBot(max_depth=4)
        board = chess.Board()

        print("Playing with standard Fischer Bot (no ML):")
        for i in range(3):
            move = bot.get_move(board)
            print(f"Move {i+1}: {move.uci()}")
            board.push(move)
