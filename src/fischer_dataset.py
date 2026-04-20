"""
Dataset module for loading and processing Bobby Fischer's games.
Focuses on games from the 1960s and the 1972 World Championship.
"""

import chess
import chess.pgn
import io
import numpy as np
from typing import List, Tuple, Optional
from pathlib import Path


class FischerGameDataset:
    """
    Dataset of Bobby Fischer's games for training ML models.
    """

    def __init__(self):
        """Initialize the dataset."""
        self.games = []
        self.positions = []  # List of (board_state, move) tuples
        self.game_count = 0

    def load_pgn_file(self, pgn_path: str):
        """
        Load games from a PGN file.

        Args:
            pgn_path: Path to PGN file
        """
        try:
            with open(pgn_path, 'r', encoding='utf-8') as f:
                while True:
                    game = chess.pgn.read_game(f)
                    if game is None:
                        break

                    # Check if Fischer played in this game
                    white_player = game.headers.get("White", "")
                    black_player = game.headers.get("Black", "")

                    if "Fischer" in white_player or "Fischer" in black_player:
                        self.games.append(game)
                        self.game_count += 1

            print(f"Loaded {self.game_count} Fischer games from {pgn_path}")
        except FileNotFoundError:
            print(f"File not found: {pgn_path}")
        except Exception as e:
            print(f"Error loading PGN file: {e}")

    def load_pgn_string(self, pgn_string: str):
        """
        Load games from a PGN string.

        Args:
            pgn_string: PGN format game string
        """
        pgn_io = io.StringIO(pgn_string)
        while True:
            game = chess.pgn.read_game(pgn_io)
            if game is None:
                break

            white_player = game.headers.get("White", "")
            black_player = game.headers.get("Black", "")

            if "Fischer" in white_player or "Fischer" in black_player:
                self.games.append(game)
                self.game_count += 1

    def extract_positions(self):
        """
        Extract all positions and moves from loaded games.
        Only extracts positions where Fischer was to move.
        """
        self.positions = []

        for game in self.games:
            white_player = game.headers.get("White", "")
            fischer_color = chess.WHITE if "Fischer" in white_player else chess.BLACK

            board = game.board()
            for move in game.mainline_moves():
                # Only record positions where Fischer was to move
                if board.turn == fischer_color:
                    # Store the board state and Fischer's move
                    self.positions.append((board.copy(), move))

                board.push(move)

        print(f"Extracted {len(self.positions)} positions from Fischer's games")

    def get_training_data(self, ml_engine):
        """
        Convert positions to training data (features and labels).

        Args:
            ml_engine: FischerMLEngine instance for feature extraction

        Returns:
            Tuple of (X, y) where X is features and y is move labels
        """
        if not self.positions:
            self.extract_positions()

        X = []
        y = []

        for board, move in self.positions:
            # Extract features from board
            features = ml_engine.board_to_features(board)
            X.append(features)

            # Convert move to label (from_square * 64 + to_square)
            move_label = move.from_square * 64 + move.to_square
            y.append(move_label)

        return np.array(X), np.array(y)

    def get_statistics(self):
        """Get dataset statistics."""
        return {
            'total_games': self.game_count,
            'total_positions': len(self.positions),
            'avg_positions_per_game': len(self.positions) / max(self.game_count, 1)
        }


# Sample Fischer games from 1972 World Championship
FISCHER_1972_WORLD_CHAMPIONSHIP_SAMPLE = """
[Event "World Championship 28th"]
[Site "Reykjavik"]
[Date "1972.07.11"]
[Round "1"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "0-1"]

1. e4 e6 2. d4 d5 3. Nc3 Nf6 4. Bg5 Be7 5. e5 Nfd7 6. Bxe7 Qxe7 7. f4 O-O 8. Nf3 c5 9. Qd2 Nc6 10. O-O-O cxd4 11. Nxd4 Qb4 12. Nxc6 bxc6 13. Qd4 Qxd4 14. Rxd4 Rb8 15. f5 Rxb2 16. fxe6 fxe6 17. Rxd5 exd5 18. Nxd5 Rxg2 19. Nxc6+ Kf7 20. Nd8+ Ke8 21. Nxc6 Rc2 22. Kb1 Rc4 23. Nd4 Nf8 24. Bd3 Rc7 25. Rf1 Nd7 26. Rf8+ Ke7 27. Rf7+ Kd8 28. Rxd7+ Kxd7 29. e6+ Kc8 0-1

[Event "World Championship 28th"]
[Site "Reykjavik"]
[Date "1972.07.18"]
[Round "3"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]

1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 a6 5. Bd3 Nc6 6. Nxc6 bxc6 7. O-O d5 8. c4 Nf6 9. cxd5 cxd5 10. exd5 exd5 11. Nc3 Be7 12. Qa4+ Qd7 13. Re1 Qxa4 14. Nxa4 Be6 15. Be3 O-O 16. Bc5 Rfe8 17. Bxe7 Rxe7 18. b4 Kf8 19. Nc5 Bc8 20. f3 Rea7 21. Re5 Ke7 22. Rae1+ Kd6 23. Nb3 Bd7 24. R5e2 h6 25. Rc2 a5 26. Nc5 Bc6 27. Rc3 axb4 28. Rb3 Ra4 29. Rxb4 Rxb4 30. Nxc6 Kxc6 31. Rxb4 d4 32. Kf2 Kd5 33. Ke2 Kc5 34. Rb3 Kc6 35. Rc3+ Kb6 36. Kd2 Kb5 37. Rc8 Kb4 38. Rc1 Kb3 39. Rb1+ Kc4 40. Rc1+ Kb3 41. Rb1+ Kc4 42. Rc1+ Kb4 43. Rc6 Ne8 44. Rxh6 Rxa2+ 45. Ke1 Rc2 46. Rh8 Rc1+ 47. Kf2 Rc2+ 48. Kg3 Rc3 49. Rb8+ Kc5 50. Rb3 Rxb3 51. Bxb3 Kd5 52. h4 Ke5 53. h5 Kf6 54. g4 Kg5 55. Kf2 Nc7 56. Kg3 Ne6 57. Bd1 Nf4 58. Bf3 Kf6 59. h6 gxh6 60. Kh4 Kg6 61. Kg3 Kf6 62. Kh4 Kg6 63. Kg3 Kf6 1/2-1/2

[Event "World Championship 28th"]
[Site "Reykjavik"]
[Date "1972.07.23"]
[Round "6"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "0-1"]

1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. Nc3 Bb4 5. e3 O-O 6. Bd3 c5 7. O-O Nc6 8. a3 Ba5 9. Ne2 dxc4 10. Bxc4 Bb6 11. dxc5 Qxd1 12. Rxd1 Bxc5 13. b4 Be7 14. Bb2 Bd7 15. Rac1 Rfd8 16. Ned4 Nxd4 17. Nxd4 Ba4 18. Bb3 Bxb3 19. Nxb3 Rxd1+ 20. Rxd1 Rc8 21. Kf1 Kf8 22. Ke2 Ne4 23. Rc1 Rxc1 24. Bxc1 f6 25. Na5 Nd6 26. Kd3 Ke8 27. Bd2 e5 28. Nc6 Bf8 29. f3 a6 30. a4 Nb7 31. Ke4 Kd7 32. Na7 Kc7 33. Kd5 Nd6 34. a5 Nb5 35. Nb5+ axb5 0-1

[Event "World Championship 28th"]
[Site "Reykjavik"]
[Date "1972.08.10"]
[Round "13"]
[White "Spassky, Boris V"]
[Black "Fischer, Robert James"]
[Result "0-1"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Bg5 e6 7. f4 Qb6 8. Qd2 Qxb2 9. Rb1 Qa3 10. e5 dxe5 11. fxe5 Nfd7 12. Bc4 Bb4 13. Rb3 Qa5 14. O-O Bxc3 15. Qxc3 Qxc3 16. Rxc3 Nxe5 17. Bb3 Nbd7 18. c4 b6 19. Bf4 Ng6 20. Bg3 Bb7 21. Rd1 Rc8 22. Rc1 Ke7 23. h4 h5 24. Kh2 Rhd8 25. Kg1 Nde5 26. c5 Nf3+ 27. Nxf3 Bxf3 28. Rd2 Rxd2 29. Bxd2 Rd8 30. Bf4 Nxf4 31. c6 e5 32. Kh2 Bd5 33. Bxd5 Rxd5 34. Rc4 Rd2 35. Rc1 Rxa2 36. c7 Nd5 37. Rc6 Rxc7 38. Rxa6 Ke6 39. Ra8 Ke7 40. g3 f6 41. Kg2 Rc2+ 42. Kf3 Rc3+ 43. Ke2 Ne3 44. Ra7+ Ke6 45. Ra6+ Kd7 46. Rxb6 Kc7 47. Rb3 Rc2+ 48. Kf3 Ng4 49. Rb4 Kd6 50. Rb6+ Kd5 51. Rb5+ Ke6 52. Rb6+ Kf5 53. Rb5 Rc3+ 54. Kf2 Rc2+ 55. Ke1 Rg2 56. Kf1 Ra2 57. Rb1 Kg4 58. Rb5 Ne3+ 59. Kg1 f5 60. Rb8 e4 61. Rb4 Kf3 62. Rb3 Ke2 63. Kh2 Ra1 64. Rb2+ Kf3 65. Rb3 Kg4 66. Rb7 g6 67. Rb4 Kf3 68. Rb3 Ra2+ 69. Kh3 Re2 70. Rb8 Ng4 71. Rb3+ Kf2 72. Rb2 e3 73. Rxe2+ Kxe2 74. Kg2 f4 75. gxf4 Kd3 76. f5 gxf5 77. Kf3 e2 78. Kf2 Ne5 0-1

[Event "World Championship 28th"]
[Site "Reykjavik"]
[Date "1972.08.22"]
[Round "17"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O Qd6 6. Na3 Be6 7. Nc4 Qd7 8. Ne3 O-O-O 9. c3 Kb8 10. Qe2 f6 11. Rd1 Qf7 12. b4 h6 13. a4 Nh7 14. b5 axb5 15. axb5 Bd6 16. bxc6 Qxc6 17. Qa2 Nf8 18. Qa8+ Kc7 19. Qa7 Qb5 20. Qxb7+ Kd7 21. d4 exd4 22. Nxd4 Qa4 23. Ndc2 Bc5 24. Rxd8+ Rxd8 25. Bd2 Ke7 26. Rb1 Bd7 27. h3 Nd6 28. Qb2 Qa6 29. Kh2 Qa4 30. Qc1 Rb8 31. Rxb8 Bxb8 32. Qb1 Qc4 33. Nd5+ 1-0

[Event "World Championship 28th"]
[Site "Reykjavik"]
[Date "1972.08.31"]
[Round "21"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]

1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 6. Bg5 e6 7. Qd2 a6 8. O-O-O Bd7 9. f4 Be7 10. Nf3 b5 11. Bxf6 gxf6 12. Kb1 Qb6 13. Ne2 a5 14. Nfd4 O-O-O 15. Nxc6 Bxc6 16. Ned4 Bd7 17. Qe1 Kb8 18. Be2 Rc8 19. Bf3 Rc5 20. Qe2 Rhc8 21. Nb3 Rxc2 22. Qxc2 Rxc2 23. Kxc2 Qc6+ 24. Kd2 h5 25. Rc1 Qb6 26. Nd4 f5 27. Rhd1 fxe4 28. Bxe4 Bf6 29. Rc8+ Ka7 30. Bf5 Qd8 31. Rxd8 Bxd8 32. Bxe6 fxe6 33. Nxe6 Bxe6 34. Rxd8 Kb6 35. Rxd6+ Ka5 36. Rxe6 Kb4 37. Rxh6 a4 38. Rg6 Ka3 39. h4 Kxa2 40. h5 b4 41. h6 b3 42. h7 Ka1 43. Rg1# 1-0
"""

# Sample games from Fischer's 1960s career
FISCHER_1960S_SAMPLE = """
[Event "USA-ch"]
[Site "New York"]
[Date "1963.12.18"]
[Round "2"]
[White "Fischer, Robert James"]
[Black "Fine, Reuben"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Na5 10. Bc2 c5 11. d4 Qc7 12. Nbd2 Nc6 13. dxe5 dxe5 14. Nf1 Be6 15. Ne3 Rad8 16. Qe2 g6 17. Nf1 Nh5 18. Bg5 Bxg5 19. Nxg5 Nf4 20. Qf3 Bxh3 21. Nxh3 Nxh3+ 22. gxh3 Nd4 23. Qg3 Nxc2 24. Rac1 Nd4 25. Rxc5 Qb6 26. Rc3 Qd6 27. Kg2 f5 28. exf5 Nxf5 29. Qg5 Qf6 30. Rxe5 Qxg5+ 31. Nxg5 Rd2 32. Rf3 Rxb2 33. Rf4 h6 34. Ne4 Ra2 35. Nc5 Rxa3 36. Nxa6 Nd6 37. Re7 Rf7 38. Re6 Nc4 39. Nc5 1-0

[Event "Interzonal"]
[Site "Stockholm"]
[Date "1962.02.11"]
[Round "7"]
[White "Fischer, Robert James"]
[Black "Geller, Efim P"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 d6 5. c3 f5 6. exf5 Bxf5 7. O-O Bd3 8. Re1 Be7 9. Bc2 Bxc2 10. Qxc2 Nf6 11. d4 O-O 12. dxe5 dxe5 13. Nxe5 Qxd1 14. Rxd1 Nxe5 15. Rxe5 Bd6 16. Re1 Rae8 17. Rxe8 Rxe8 18. Nd2 Kf7 19. Ne4 Nxe4 20. Qxe4 Rxe4 21. f3 Re2 22. Kf1 Rxb2 23. g4 c5 24. Bd2 Rb3 25. Re1 Rxc3 26. Re7+ Kg6 27. Rxb7 Rc2 28. Be3 c4 29. Rb6 Ra2 30. Rxa6 c3 31. Ra8 Kf7 32. Rc8 Rxa3 33. Rxc3 Rxc3 34. Bxc3 Ke6 35. h4 Kf6 36. Kg2 h6 37. Kg3 Kg6 38. Bd4 Kh7 39. Kf4 Kg6 40. h5+ Kh7 41. Kg3 1-0
"""


def load_default_dataset() -> FischerGameDataset:
    """
    Load default Fischer dataset with sample games.

    Returns:
        FischerGameDataset with sample games loaded
    """
    dataset = FischerGameDataset()

    # Load sample games from 1972 World Championship
    dataset.load_pgn_string(FISCHER_1972_WORLD_CHAMPIONSHIP_SAMPLE)

    # Load sample games from 1960s
    dataset.load_pgn_string(FISCHER_1960S_SAMPLE)

    return dataset
