"""The FischerBot: opening book -> engine search -> style selection.

Move policy:
1. If the position appears in Fischer's real games with him to move, play
   one of his actual moves (weighted by frequency and results), citing the
   source game.
2. Otherwise search for the best move.
3. Then ask the style model which legal moves look more like Fischer than
   the engine's choice. The model was trained with the engine's own verdict
   as a feature, so it knows how many centipawns each stylistic preference
   is worth; the most Fischer-like move is played if a verification search
   at full depth - and then one ply deeper - proves it costs no more than
   that (and never more than `style_margin_cp`, less in the endgame).
   Style is never allowed to override tactics.

The whole decision - search and verification together - stays inside the
time budget, which matters on serverless hosting.
"""

import time
from dataclasses import dataclass, field
from typing import List, Optional

import chess

from .book import BookMove, OpeningBook
from .engine import Engine
from .style import StyleModel, game_phase

DEFAULT_STYLE_MARGIN_CP = 40   # most the bot will ever give up for style
ENDGAME_STYLE_MARGIN_CP = 15   # endgames punish small inaccuracies: stay closer to the engine
MAX_STYLE_PROBES = 4           # verification searches per move
SEARCH_SHARE = 0.9             # of the time budget; the rest is kept for verification
MIN_STYLE_DEPTH = 3            # a shallower search is too unreliable to deviate from
STYLE_SCORE_LIMIT = 500        # when winning or losing by this much, just play the best move


@dataclass
class MoveChoice:
    move: chess.Move
    san: str
    source: str                      # "book" | "search" | "search+style"
    book_citation: Optional[str] = None
    book_move: Optional[BookMove] = None  # the book entry played: his games with this move
    eval_cp: Optional[int] = None    # from the mover's perspective
    depth: Optional[int] = None
    nodes: Optional[int] = None
    time_ms: Optional[int] = None
    pv: List[str] = field(default_factory=list)
    engine_san: Optional[str] = None  # what the engine preferred, when style chose differently


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
        book_year: Optional[int] = None,
        book_later: bool = False,
    ):
        """`book_year` sets the bot in that year of Fischer's career: the book
        then holds only the games he had played by then (unless `book_later`),
        and prefers what he was playing at the time."""
        self.time_budget_ms = time_budget_ms
        self.max_depth = max_depth
        self.style_margin_cp = style_margin_cp
        self.book_year = book_year
        self.book_later = book_later
        self.engine = Engine()
        self.book = book if book is not None else (OpeningBook.load(seed=seed) if use_book else None)
        self.style = style_model if style_model is not None else (
            StyleModel.load_or_none() if use_style else None
        )

    def choose(self, board: chess.Board) -> MoveChoice:
        if board.is_game_over():
            raise ValueError("Game is already over")
        start = time.perf_counter()
        deadline = start + self.time_budget_ms / 1000.0

        if self.book is not None:
            entry = self.book.choose(board, self.book_year, self.book_later)
            if entry is not None:
                move = chess.Move.from_uci(entry.uci)
                return MoveChoice(
                    move=move,
                    san=board.san(move),
                    source="book",
                    book_citation=entry.citations[0],
                    book_move=entry,
                )

        share = SEARCH_SHARE if self.style is not None else 1.0
        result = self.engine.search(board, int(self.time_budget_ms * share), self.max_depth)
        best = result.move
        choice = MoveChoice(
            move=best,
            san=board.san(best),
            source="search",
            eval_cp=result.score_cp,
            depth=result.depth,
            nodes=result.nodes,
            pv=result.pv,
        )

        alternative = self._style_alternative(board, result, deadline)
        if alternative is not None and alternative != best:
            choice.engine_san = choice.san
            choice.move = alternative
            choice.san = board.san(alternative)
            choice.source = "search+style"
            choice.pv = [alternative.uci()]
        choice.nodes = self.engine.nodes  # search plus verification
        choice.time_ms = int((time.perf_counter() - start) * 1000)
        return choice

    def style_margin(self, phase: int) -> float:
        """Hard cap, in centipawns, on what a style choice may cost in this phase of the game."""
        if phase == 2:
            return min(self.style_margin_cp, ENDGAME_STYLE_MARGIN_CP)
        return self.style_margin_cp

    def _style_alternative(self, board: chess.Board, result, deadline: float) -> Optional[chess.Move]:
        """The move with the best balance of Fischer-likeness and engine score.

        Candidates are the moves the style model prefers to the engine's
        choice. Each is searched at full depth to learn exactly what it
        costs; it wins if its style outweighs that cost by more than any
        other candidate's does, and is then confirmed one ply deeper. A move
        whose cost exceeds what its style is worth - or the phase's margin -
        is never played.
        """
        if self.style is None or result.move is None or result.depth < MIN_STYLE_DEPTH:
            return None
        best_score = result.score_cp
        if abs(best_score) >= STYLE_SCORE_LIMIT:
            return None

        ranked = self.style.style_scores(board)
        engine_style = next((score for move, score in ranked if move == result.move), None)
        if engine_style is None:
            return None

        phase = game_phase(board)
        margin = self.style_margin(phase)
        chosen = None
        chosen_surplus = 0.0     # how far the chosen move is past break-even, in centipawns
        chosen_floor = 0         # the lowest score the chosen move was allowed to have
        probes = 0
        for move, style in ranked:
            if move == result.move or probes >= MAX_STYLE_PROBES:
                break  # everything further down is less Fischer-like than the engine's pick
            allowed = self.style.allowed_loss(phase, style - engine_style)
            # Moves come in order of style, so once even a free move could not
            # beat the current choice, nothing further down can either.
            if allowed < 0 or allowed <= chosen_surplus:
                break
            if time.perf_counter() >= deadline:
                break
            probes += 1
            limit = int(min(allowed, margin))
            score = self.engine.score_move(board, move, best_score - limit - 1, best_score + 1,
                                           result.depth, deadline)
            if score is None or score < best_score - limit:
                continue  # costs more than its style is worth (or we ran out of time)
            surplus = allowed - max(0, best_score - score)
            if surplus > chosen_surplus:
                chosen, chosen_surplus, chosen_floor = move, surplus, best_score - limit

        # The engine's own move was the best of everything at this depth; the
        # style move was only shown to be close. Before deviating, make sure it
        # still holds up one ply deeper - if not (or if time is up), don't.
        if chosen is not None and not self.engine.verify_at_least(
                board, chosen, chosen_floor, result.depth + 1, deadline):
            return None
        return chosen
