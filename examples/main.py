#!/usr/bin/env python3
"""
Main entry point for Fischer Bot.
Allows you to play against the bot or watch it play against itself.
"""

import sys
from pathlib import Path

# Add project root to Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import chess
import chess.svg
from src.fischer_bot import FischerBot


def print_board(board: chess.Board):
    """Print the chess board in a readable format."""
    print("\n  a b c d e f g h")
    print(" +" + "-" * 16 + "+")

    for rank in range(7, -1, -1):
        row = f"{rank + 1}|"
        for file in range(8):
            square = chess.square(file, rank)
            piece = board.piece_at(square)

            if piece:
                symbol = piece.unicode_symbol()
            else:
                # Checkerboard pattern
                if (file + rank) % 2 == 0:
                    symbol = "·"
                else:
                    symbol = " "

            row += symbol + " "

        row += f"|{rank + 1}"
        print(row)

    print(" +" + "-" * 16 + "+")
    print("  a b c d e f g h\n")


def get_player_move(board: chess.Board) -> chess.Move:
    """Get a move from the human player."""
    while True:
        try:
            move_str = input("Your move (e.g., e2e4) or 'quit': ").strip().lower()

            if move_str == 'quit':
                return None

            # Try to parse the move
            move = chess.Move.from_uci(move_str)

            if move in board.legal_moves:
                return move
            else:
                print("Illegal move! Try again.")

        except ValueError:
            print("Invalid move format! Use format like 'e2e4' or 'e7e8q' for promotion.")


def play_vs_fischer():
    """Play a game against Fischer Bot."""
    print("=" * 50)
    print("Welcome to Fischer Bot!")
    print("Playing as Bobby Fischer would have played.")
    print("=" * 50)
    print()

    # Choose color
    while True:
        color_choice = input("Play as (w)hite or (b)lack? ").strip().lower()
        if color_choice in ['w', 'white']:
            player_color = chess.WHITE
            break
        elif color_choice in ['b', 'black']:
            player_color = chess.BLACK
            break
        else:
            print("Please enter 'w' or 'b'")

    # Choose difficulty
    while True:
        try:
            difficulty = input("Choose difficulty (1-5, default 4): ").strip()
            if difficulty == "":
                depth = 4
                break
            depth = int(difficulty)
            if 1 <= depth <= 5:
                break
            else:
                print("Please enter a number between 1 and 5")
        except ValueError:
            print("Please enter a valid number")

    board = chess.Board()
    bot = FischerBot(max_depth=depth)

    print(f"\nYou are playing as {'White' if player_color == chess.WHITE else 'Black'}")
    print(f"Fischer Bot difficulty: {depth}")
    print("\nGame starting...\n")

    while not board.is_game_over():
        print_board(board)

        if board.turn == player_color:
            # Player's turn
            print(f"Move {board.fullmove_number}: Your turn")
            move = get_player_move(board)

            if move is None:
                print("Game quit by player.")
                return

            board.push(move)
        else:
            # Bot's turn
            print(f"Move {board.fullmove_number}: Fischer Bot is thinking...")
            move = bot.get_move(board)
            board.push(move)
            print(f"Fischer Bot plays: {move.uci()}")

        # Check for check
        if board.is_check():
            print("Check!")

    # Game over
    print_board(board)
    print("\nGame Over!")

    if board.is_checkmate():
        winner = "You" if board.turn != player_color else "Fischer Bot"
        print(f"Checkmate! {winner} won!")
    elif board.is_stalemate():
        print("Stalemate! Draw.")
    elif board.is_insufficient_material():
        print("Draw due to insufficient material.")
    elif board.is_fifty_moves():
        print("Draw due to fifty-move rule.")
    elif board.is_repetition():
        print("Draw due to threefold repetition.")
    else:
        print("Draw.")

    print(f"\nFinal position: {board.fen()}")


def watch_fischer_vs_fischer():
    """Watch Fischer Bot play against itself."""
    print("=" * 50)
    print("Fischer Bot vs Fischer Bot")
    print("Watch the master play against himself!")
    print("=" * 50)
    print()

    board = chess.Board()
    bot_white = FischerBot(max_depth=3)
    bot_black = FischerBot(max_depth=3)

    move_count = 0

    while not board.is_game_over() and move_count < 100:
        print_board(board)

        if board.turn == chess.WHITE:
            print(f"Move {board.fullmove_number}: White (Fischer Bot) thinking...")
            move = bot_white.get_move(board)
        else:
            print(f"Move {board.fullmove_number}: Black (Fischer Bot) thinking...")
            move = bot_black.get_move(board)

        board.push(move)
        move_count += 1

        if board.is_check():
            print("Check!")

        input("Press Enter for next move...")

    # Game over
    print_board(board)
    print("\nGame Over!")

    if board.is_checkmate():
        winner = "White" if board.turn == chess.BLACK else "Black"
        print(f"Checkmate! {winner} won!")
    elif board.is_stalemate():
        print("Stalemate! Draw.")
    elif board.is_insufficient_material():
        print("Draw due to insufficient material.")
    else:
        print("Draw.")


def main():
    """Main menu."""
    while True:
        print("\n" + "=" * 50)
        print("Fischer Bot - Chess Engine")
        print("=" * 50)
        print("\n1. Play against Fischer Bot")
        print("2. Watch Fischer Bot play itself")
        print("3. Quit")

        choice = input("\nChoose an option: ").strip()

        if choice == "1":
            play_vs_fischer()
        elif choice == "2":
            watch_fischer_vs_fischer()
        elif choice == "3":
            print("Thanks for playing! Goodbye.")
            break
        else:
            print("Invalid choice. Please enter 1, 2, or 3.")


if __name__ == "__main__":
    main()
