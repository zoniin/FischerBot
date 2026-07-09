"""Opening book built from Fischer's real games.

Keyed by EPD (position, not move sequence), so transpositions into his
lines are recognized. Only positions where Fischer himself was to move are
included — the bot follows *his* choices, with a citation of the source
game for every book move it plays.
"""

import random
from dataclasses import dataclass
from typing import Dict, List, Optional

import chess

from .dataset import FischerGame, fischer_result_score, load_corpus

MAX_BOOK_PLIES = 40  # book territory: the first 20 full moves


@dataclass
class BookMove:
    uci: str
    count: int
    result_points: float  # sum of Fischer's scores in games featuring this move
    citations: List[str]

    @property
    def weight(self) -> float:
        # Frequency-weighted, nudged toward lines where Fischer scored well.
        win_rate = self.result_points / self.count if self.count else 0.0
        return self.count * (0.6 + 0.8 * win_rate)


class OpeningBook:
    def __init__(self, games: Optional[List[FischerGame]] = None, seed: Optional[int] = None):
        self._table: Dict[str, Dict[str, BookMove]] = {}
        self._rng = random.Random(seed)
        for fg in games if games is not None else load_corpus():
            self._add_game(fg)

    def _add_game(self, fg: FischerGame):
        board = fg.game.board()
        points = fischer_result_score(fg)
        for ply, move in enumerate(fg.game.mainline_moves()):
            if ply >= MAX_BOOK_PLIES:
                break
            if board.turn == fg.fischer_color:
                key = board.epd()
                uci = move.uci()
                slot = self._table.setdefault(key, {})
                entry = slot.get(uci)
                if entry is None:
                    slot[uci] = BookMove(uci, 1, points, [fg.citation])
                else:
                    entry.count += 1
                    entry.result_points += points
                    if fg.citation not in entry.citations:
                        entry.citations.append(fg.citation)
            board.push(move)

    def lookup(self, board: chess.Board) -> List[BookMove]:
        """All book moves for this position, best-weighted first."""
        entries = self._table.get(board.epd())
        if not entries:
            return []
        legal = {m.uci() for m in board.legal_moves}
        moves = [e for e in entries.values() if e.uci in legal]
        return sorted(moves, key=lambda e: e.weight, reverse=True)

    def choose(self, board: chess.Board) -> Optional[BookMove]:
        """Weighted-random choice among Fischer's moves in this position."""
        moves = self.lookup(board)
        if not moves:
            return None
        weights = [m.weight for m in moves]
        return self._rng.choices(moves, weights=weights, k=1)[0]

    @property
    def size(self) -> int:
        return len(self._table)
