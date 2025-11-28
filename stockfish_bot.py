"""
Stockfish Bot - Fast and strong chess engine wrapper.
Uses the Stockfish engine for much faster and stronger play.
"""

import chess
import chess.engine
import os
from pathlib import Path


class StockfishBot:
    """
    Wrapper around the Stockfish chess engine using python-chess UCI interface.
    Provides a fast, strong opponent while maintaining the same interface as FischerBot.
    """

    def __init__(self, max_depth: int = 15, skill_level: int = 20):
        """
        Initialize the Stockfish Bot.

        Args:
            max_depth: Maximum search depth (default 15, Stockfish is much faster)
            skill_level: Stockfish skill level 0-20 (20 is strongest)
        """
        self.max_depth = max_depth
        self.skill_level = skill_level
        self.nodes_searched = 0

        # Find Stockfish executable
        stockfish_path = self._find_stockfish_executable()
        print(f"Using Stockfish at: {stockfish_path}")

        # Initialize Stockfish engine using python-chess
        try:
            self.engine = chess.engine.SimpleEngine.popen_uci(stockfish_path)

            # Configure engine options
            self.engine.configure({"Threads": 2, "Hash": 128})

            # Set skill level if not max
            if skill_level < 20:
                self.engine.configure({"Skill Level": skill_level})

            print(f"Stockfish initialized successfully (depth: {max_depth}, skill: {skill_level})")

        except Exception as e:
            print(f"Error initializing Stockfish: {e}")
            print(f"Stockfish path: {stockfish_path}")
            raise

    def _find_stockfish_executable(self) -> str:
        """Find the Stockfish executable in the project directory."""
        # Try the stockfish directory
        base_dir = Path(__file__).parent
        stockfish_dir = base_dir / "stockfish"

        # Try different Windows executables in order of compatibility
        for name in [
            "stockfish-windows-x86-64-sse41-popcnt.exe",  # Most compatible
            "stockfish-windows-x86-64-avx2.exe",
            "stockfish.exe",
            "stockfish"
        ]:
            exe_path = stockfish_dir / name
            if exe_path.exists():
                return str(exe_path.absolute())

        # Try system PATH
        import shutil
        system_stockfish = shutil.which("stockfish")
        if system_stockfish:
            return system_stockfish

        raise FileNotFoundError(
            "Stockfish executable not found. Please install Stockfish or "
            "place the executable in the 'stockfish' directory."
        )

    def get_move(self, board: chess.Board) -> chess.Move:
        """
        Get the best move for the current position.

        Args:
            board: Current chess position

        Returns:
            Best move according to Stockfish
        """
        if board.is_game_over():
            return None

        # Use Stockfish to analyze the position
        result = self.engine.play(
            board,
            chess.engine.Limit(depth=self.max_depth, time=0.1)
        )

        if result.move is None:
            return None

        # Get evaluation info if available
        try:
            info = self.engine.analyse(board, chess.engine.Limit(depth=self.max_depth))
            if "nodes" in info:
                self.nodes_searched = info["nodes"]
            print(f"Stockfish: {result.move.uci()} (depth: {self.max_depth}, nodes: {self.nodes_searched})")
        except:
            print(f"Stockfish: {result.move.uci()} (depth: {self.max_depth})")

        return result.move

    def set_depth(self, depth: int):
        """Set the search depth."""
        self.max_depth = depth
        print(f"Stockfish depth set to {depth}")

    def set_skill_level(self, skill_level: int):
        """
        Set Stockfish skill level.

        Args:
            skill_level: 0-20, where 20 is strongest
        """
        self.skill_level = max(0, min(20, skill_level))
        if self.skill_level < 20:
            self.engine.configure({"Skill Level": self.skill_level})
        print(f"Stockfish skill level set to {self.skill_level}")

    def toggle_opening_book(self, use_book: bool):
        """
        Enable or disable opening book (for compatibility with FischerBot interface).
        Stockfish handles this internally.
        """
        pass  # Stockfish handles this internally

    def __del__(self):
        """Cleanup when the bot is destroyed."""
        try:
            if hasattr(self, 'engine'):
                self.engine.quit()
        except:
            pass
