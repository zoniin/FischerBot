"""Opening book built from Fischer's real games.

Keyed by position (EPD), not move sequence, so transpositions into his lines
are recognised. For every position in the first twenty moves of his games the
book knows

  * the moves **Fischer** played there (`lookup`, `choose`) - the bot follows
    his choices, each with the games it comes from, and
  * the moves his **opponents** played there (`replies`) - so the bot can say
    "Spassky played Nf3 here" when you follow or leave one of his games.

The book can be restricted to an era: `year=1958` uses only the games he had
played by 1958 and favours the recent ones, which is how the bot's "Bobby at
15" level gets a fifteen-year-old's repertoire.

Building the book means parsing every game, so it is also saved as JSON
(web/static/data/book.json, written by tools/build_web_data.py). The server
and the browser both load that file; the two must give identical answers.
"""

import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import chess

from .dataset import FischerGame, load_corpus

MAX_BOOK_PLIES = 40  # book territory: the first 20 full moves

BOOK_PATH = Path(__file__).resolve().parent.parent / "web" / "static" / "data" / "book.json"

# How much a game counts toward a move's weight.
RESULT_BASE = 0.6          # a loss still counts for something: he did play it
RESULT_BONUS = 0.8         # ... a win counts for 1.4
RECENT_YEARS = 4           # games this close to the chosen era count in full
RECENCY_DECAY = 0.08       # each year older than that costs this much ...
RECENCY_FLOOR = 0.35       # ... down to this


@dataclass(frozen=True)
class BookGame:
    """What the book remembers about one game."""
    key: str             # "wc1972#6"
    citation: str        # "Fischer–Spassky, World Championship 1972, Game 6"
    opponent: str
    event: str
    year: int
    fischer_white: bool
    score: float         # 1 win, 0.5 draw, 0 loss - from Fischer's side
    source: str          # "m60mg" | "wc1972" | "career"
    number: int
    eco: str = ""

    @classmethod
    def from_game(cls, fg: FischerGame) -> "BookGame":
        return cls(key=fg.key, citation=fg.citation, opponent=fg.opponent, event=fg.event_name,
                   year=fg.year, fischer_white=fg.fischer_color == chess.WHITE,
                   score=fg.fischer_score, source=fg.source, number=fg.number, eco=fg.eco)

    def to_json(self) -> dict:
        return {"key": self.key, "cite": self.citation, "opponent": self.opponent, "event": self.event,
                "year": self.year, "white": self.fischer_white, "score": self.score,
                "source": self.source, "number": self.number, "eco": self.eco}

    @classmethod
    def from_json(cls, data: dict) -> "BookGame":
        return cls(key=data["key"], citation=data["cite"], opponent=data["opponent"], event=data["event"],
                   year=data["year"], fischer_white=data["white"], score=data["score"],
                   source=data["source"], number=data["number"], eco=data.get("eco", ""))


@dataclass
class BookMove:
    """One move in one position, with the games (of the chosen era) it was played in."""
    uci: str
    games: List[BookGame] = field(default_factory=list)
    weight: float = 0.0

    @property
    def count(self) -> int:
        return len(self.games)

    @property
    def result_points(self) -> float:
        """Sum of Fischer's scores in the games featuring this move."""
        return sum(game.score for game in self.games)

    @property
    def citations(self) -> List[str]:
        return [game.citation for game in self.games]


def recency(year: Optional[int], game_year: int) -> float:
    """Weight of a game played in `game_year` for a bot set in `year` (None: no era)."""
    if year is None:
        return 1.0
    age = max(0, year - game_year)
    if age <= RECENT_YEARS:
        return 1.0
    return max(RECENCY_FLOOR, 1.0 - RECENCY_DECAY * (age - RECENT_YEARS))


_SOURCE_RANK = {"wc1972": 0, "m60mg": 1, "career": 2}


def _citation_order(game: BookGame, year: Optional[int]):
    """Which game to cite first: the famous ones, then the era's, then his best results."""
    distance = abs(year - game.year) if year is not None else 0
    return (_SOURCE_RANK.get(game.source, 9), distance, -game.score, game.number)


class OpeningBook:
    def __init__(self, games: Optional[List[FischerGame]] = None, seed: Optional[int] = None):
        self.games: List[BookGame] = []
        # position -> {uci: [game index, ...]}
        self._positions: Dict[str, Dict[str, List[int]]] = {}   # Fischer to move
        self._replies: Dict[str, Dict[str, List[int]]] = {}     # his opponent to move
        self._rng = random.Random(seed)
        for fg in games if games is not None else load_corpus():
            self._add_game(fg)

    # ------------------------------------------------------------ building

    def _add_game(self, fg: FischerGame):
        index = len(self.games)
        self.games.append(BookGame.from_game(fg))
        board = fg.game.board()
        for ply, move in enumerate(fg.game.mainline_moves()):
            if ply >= MAX_BOOK_PLIES:
                break
            table = self._positions if board.turn == fg.fischer_color else self._replies
            played = table.setdefault(board.epd(), {}).setdefault(move.uci(), [])
            if index not in played:
                played.append(index)
            board.push(move)

    # ----------------------------------------------------------- JSON form

    def to_json(self) -> dict:
        def table(source):
            return {epd: [[uci, indices] for uci, indices in sorted(moves.items())]
                    for epd, moves in sorted(source.items())}
        return {
            "version": 2,
            "maxPlies": MAX_BOOK_PLIES,
            "weights": {"resultBase": RESULT_BASE, "resultBonus": RESULT_BONUS, "recentYears": RECENT_YEARS,
                        "recencyDecay": RECENCY_DECAY, "recencyFloor": RECENCY_FLOOR},
            "games": [game.to_json() for game in self.games],
            "positions": table(self._positions),
            "replies": table(self._replies),
        }

    @classmethod
    def from_json(cls, data, seed: Optional[int] = None) -> "OpeningBook":
        """Load a book saved by to_json(); `data` is the parsed document or a path to it."""
        if not isinstance(data, dict):
            data = json.loads(Path(data).read_text(encoding="utf-8"))
        if data.get("version") != 2:
            raise ValueError("Unsupported book file version")
        book = cls(games=[], seed=seed)
        book.games = [BookGame.from_json(game) for game in data["games"]]
        book._positions = {epd: {uci: list(indices) for uci, indices in moves}
                           for epd, moves in data["positions"].items()}
        book._replies = {epd: {uci: list(indices) for uci, indices in moves}
                         for epd, moves in data["replies"].items()}
        return book

    @classmethod
    def load(cls, seed: Optional[int] = None) -> "OpeningBook":
        """The shipped book: the saved file if present (fast), else built from the PGNs."""
        if BOOK_PATH.exists():
            return cls.from_json(BOOK_PATH, seed=seed)
        return cls(seed=seed)

    # ------------------------------------------------------------- queries

    def _moves(self, table, board: chess.Board, year: Optional[int], later: bool) -> List[BookMove]:
        entries = table.get(board.epd())
        if not entries:
            return []
        legal = {move.uci() for move in board.legal_moves}
        moves = []
        for uci, indices in entries.items():
            if uci not in legal:
                continue
            games = [self.games[i] for i in indices]
            if year is not None and not later:
                games = [game for game in games if game.year <= year]
            if not games:
                continue
            weight = sum((RESULT_BASE + RESULT_BONUS * game.score) * recency(year, game.year) for game in games)
            games.sort(key=lambda game: _citation_order(game, year))
            moves.append(BookMove(uci, games, weight))
        moves.sort(key=lambda m: (-m.weight, m.uci))
        return moves

    def lookup(self, board: chess.Board, year: Optional[int] = None, later: bool = False) -> List[BookMove]:
        """Fischer's moves in this position, best-weighted first.

        `year` restricts the book to the games he had played by then and
        favours recent ones; `later=True` keeps the later games as well (used
        by the strongest level, which knows everything he ever played).
        """
        return self._moves(self._positions, board, year, later)

    def replies(self, board: chess.Board, year: Optional[int] = None, later: bool = False) -> List[BookMove]:
        """What Fischer's opponents played in this position."""
        return self._moves(self._replies, board, year, later)

    def choose(self, board: chess.Board, year: Optional[int] = None, later: bool = False,
               r: Optional[float] = None) -> Optional[BookMove]:
        """Weighted-random choice among Fischer's moves here.

        `r` in [0, 1) fixes the draw (for tests and for parity with the
        browser); by default the book's own random generator supplies it.
        """
        moves = self.lookup(board, year, later)
        if not moves:
            return None
        if r is None:
            r = self._rng.random()
        target = r * sum(move.weight for move in moves)
        running = 0.0
        for move in moves:
            running += move.weight
            if running > target:
                return move
        return moves[-1]

    @property
    def size(self) -> int:
        """Number of positions in which the book knows a move of Fischer's."""
        return len(self._positions)
