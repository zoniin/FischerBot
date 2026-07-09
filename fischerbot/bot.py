"""The FischerBot: opening book -> engine search -> style selection.

Move policy:
1. If the position appears in Fischer's real games with him to move,
   play one of his actual moves (weighted by frequency/results), citing
   the source game.
2. Otherwise run the search engine for the best move.
3. Among root moves the style model likes better than the engine's pick,
   accept the most Fischer-like one only if a null-window verification
   proves it loses at most `style_margin_cp` versus the engine move.
   Style never overrides tactics.
"""

from dataclasses import dataclass, field
from typing import List, Optional

import chess

from .book import OpeningBook
from .engine import Engine
from .style import StyleModel

DEFAULT_STYLE_MARGIN_CP = 30
MAX_STYLE_CANDIDATES = 4


@dataclass
class MoveChoice:
    move: chess.Move
    san: str
    source: str                      # "book" | "search" | "search+style"
    book_citation: Optional[str] = None
    eval_cp: Optional[int] = None    # from the mover's perspective
    depth: Optional[int] = None
    nodes: Optional[int] = None
    time_ms: Optional[int] = None
    pv: List[str] = field(default_factory=list)


class FischerBot:
    def __init__(
        self,
        time_budget_ms: int = 3000,
        max_depth: int = 64,
        use_book: bool = True,
        use_style: bool = True,
        style_margin_cp: int = DEFAULT_STYLE_MARGIN_CP,
        book: Optional[OpeningBook] = None,
        style_model: Optional[StyleModel] = None,
        seed: Optional[int] = None,
    ):
        self.time_budget_ms = time_budget_ms
        self.max_depth = max_depth
        self.style_margin_cp = style_margin_cp
        self.engine = Engine()
        self.book = book if book is not None else (OpeningBook(seed=seed) if use_book else None)
        self.style = style_model if style_model is not None else (
            StyleModel.load_or_none() if use_style else None
        )

    def choose(self, board: chess.Board) -> MoveChoice:
        if board.is_game_over():
            raise ValueError("Game is already over")

        if self.book is not None:
            entry = self.book.choose(board)
            if entry is not None:
                move = chess.Move.from_uci(entry.uci)
                return MoveChoice(
                    move=move,
                    san=board.san(move),
                    source="book",
                    book_citation=entry.citations[0],
                )

        result = self.engine.search(board, self.time_budget_ms, self.max_depth)
        best = result.move
        choice = MoveChoice(
            move=best,
            san=board.san(best),
            source="search",
            eval_cp=result.score_cp,
            depth=result.depth,
            nodes=result.nodes,
            time_ms=result.time_ms,
            pv=result.pv,
        )

        alternative = self._style_alternative(board, result)
        if alternative is not None and alternative != best:
            choice.move = alternative
            choice.san = board.san(alternative)
            choice.source = "search+style"
        return choice

    def _style_alternative(self, board: chess.Board, result) -> Optional[chess.Move]:
        """Most Fischer-like root move proven within style_margin_cp of best."""
        if self.style is None or result.move is None or result.depth < 3:
            return None
        if abs(result.score_cp) > 300:
            return None  # in clearly won/lost positions, just play the engine move

        ranked = self.style.rank_moves(board)
        best_logit = None
        for move, _prob in ranked:
            if move == result.move:
                best_logit = self.style.logit(board, move)
                break
        if best_logit is None:
            return None

        threshold = result.score_cp - self.style_margin_cp
        verify_depth = max(2, result.depth - 2)
        checked = 0
        for move, _prob in ranked:
            if move == result.move:
                break  # every remaining move is less Fischer-like than the pick
            if checked >= MAX_STYLE_CANDIDATES:
                break
            checked += 1
            if self.engine.verify_at_least(board, move, threshold, verify_depth):
                return move
        return None
