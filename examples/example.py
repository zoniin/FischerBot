#!/usr/bin/env python3
"""
Example usage of Fischer Bot as a library.
"""

import sys
from pathlib import Path

# Add project root to Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import chess
from src.fischer_bot import FischerBot


def example_game():
    """Example of using Fischer Bot programmatically."""
    print("Fischer Bot Example Game\n")

    # Create a chess board
    board = chess.Board()

    # Create two bots with different depths
    fischer_white = FischerBot(max_depth=4)
    fischer_black = FischerBot(max_depth=3)

    print("Starting position:")
    print(board)
    print()

    # Play a few moves
    for i in range(10):
        if board.is_game_over():
            break

        if board.turn == chess.WHITE:
            print(f"Move {board.fullmove_number} - White to move:")
            move = fischer_white.get_move(board)
            print(f"White plays: {move}")
        else:
            print(f"Move {board.fullmove_number} - Black to move:")
            move = fischer_black.get_move(board)
            print(f"Black plays: {move}")

        board.push(move)
        print(board)
        print()

    print("Game ended or 10 moves reached")
    print(f"Final FEN: {board.fen()}")


def example_position_analysis():
    """Example of analyzing a specific position."""
    print("\nFischer Bot Position Analysis\n")

    # Set up a specific position (Scandinavian Defense after 1.e4 d5 2.exd5)
    board = chess.Board()
    board.push_san("e4")
    board.push_san("d5")
    board.push_san("exd5")

    print("Position after 1.e4 d5 2.exd5:")
    print(board)
    print()

    # Analyze with Fischer Bot
    bot = FischerBot(max_depth=5)
    best_move = bot.get_move(board)

    print(f"\nFischer Bot recommends: {best_move}")
    print(f"Nodes searched: {bot.nodes_searched}")


def example_opening_book():
    """Example showing opening book usage."""
    print("\nFischer Bot Opening Book Example\n")

    board = chess.Board()

    # Bot with opening book
    bot_with_book = FischerBot(max_depth=4, use_opening_book=True)

    # Bot without opening book
    bot_without_book = FischerBot(max_depth=4, use_opening_book=False)

    print("Position: Starting position")
    print(board)
    print()

    move_book = bot_with_book.get_move(board)
    print(f"With opening book: {move_book} (likely 1.e4, Fischer's favorite)")

    move_no_book = bot_without_book.get_move(board)
    print(f"Without opening book: {move_no_book}")


def example_fischer_characteristics():
    """
    Demonstrate Fischer's playing characteristics through the bot.
    """
    print("\nFischer's Playing Characteristics\n")

    # Position where Fischer would play aggressively
    # Let's use the position from Fischer's famous "Game of the Century"
    # This is a simplified example
    board = chess.Board()

    print("Fischer's playing style prioritizes:")
    print("1. Aggressive, tactical play")
    print("2. Open positions with active pieces")
    print("3. Control of the center")
    print("4. Rooks on open files")
    print("5. King safety (especially in middlegame)")
    print()

    bot = FischerBot(max_depth=4)

    # Play a few moves showing Fischer's style
    moves = ["e4", "e5", "Nf3", "Nc6", "Bb5"]  # Ruy Lopez, Fischer's weapon

    for move_san in moves:
        move = board.push_san(move_san)
        print(f"Move: {move_san}")

    print("\nCurrent position (Ruy Lopez):")
    print(board)
    print("\nThis opening exemplifies Fischer's style:")
    print("- Direct attack on the center (e5 pawn)")
    print("- Active piece development")
    print("- Preparation for kingside castling")


if __name__ == "__main__":
    print("=" * 60)
    print("Fischer Bot - Example Usage")
    print("=" * 60)

    # Run examples
    example_game()
    print("\n" + "=" * 60 + "\n")

    example_position_analysis()
    print("\n" + "=" * 60 + "\n")

    example_opening_book()
    print("\n" + "=" * 60 + "\n")

    example_fischer_characteristics()
    print("\n" + "=" * 60)
