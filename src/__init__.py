"""
Fischer Bot - A chess engine inspired by Bobby Fischer.
"""

from .fischer_bot import FischerBot
from .stockfish_bot import StockfishBot
from .evaluation import evaluate_position
from .openings import get_opening_move

__all__ = ['FischerBot', 'StockfishBot', 'evaluate_position', 'get_opening_move']
