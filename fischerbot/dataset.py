"""Loading of the real Fischer game corpus.

Two sources ship with the repo (see data/):
  - m60mg.pgn   — the 60 games of "My 60 Memorable Games"
  - wc1972.pgn  — all 21 games of the 1972 World Championship vs Spassky

Every game is parsed with python-chess and must be fully legal; games with
recorded parse errors are rejected loudly rather than silently skipped.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import chess
import chess.pgn

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
M60MG_PGN = DATA_DIR / "m60mg.pgn"
WC1972_PGN = DATA_DIR / "wc1972.pgn"

MIN_PLIES = 10  # skips the game-2 forfeit of the 1972 match


@dataclass(frozen=True)
class FischerGame:
    game: chess.pgn.Game
    source: str        # "m60mg" or "wc1972"
    number: int        # game number within its source (1-based)
    fischer_color: chess.Color
    white: str
    black: str
    event: str
    site: str
    date: str
    result: str

    @property
    def citation(self) -> str:
        opponent = self.black if self.fischer_color == chess.WHITE else self.white
        opponent = opponent.split(",")[0].strip()
        year = self.date.split(".")[0] if self.date else ""
        if self.source == "wc1972":
            return f"Fischer–Spassky, World Championship 1972, Game {self.number}" \
                if self.fischer_color == chess.WHITE \
                else f"Spassky–Fischer, World Championship 1972, Game {self.number}"
        first = "Fischer" if self.fischer_color == chess.WHITE else opponent
        second = opponent if self.fischer_color == chess.WHITE else "Fischer"
        site = self.site.split(",")[0].strip() if self.site and self.site != "?" else ""
        if "http" in site or "/" in site:
            site = ""  # some PGN sources put URLs in the Site header
        where = f", {site}" if site else ""
        return f"{first}–{second}{where} {year} (My 60 Memorable Games, #{self.number})"


def _read_pgn(path: Path, source: str) -> List[FischerGame]:
    if not path.exists():
        raise FileNotFoundError(
            f"Missing corpus file {path}. The real Fischer PGNs must live in data/."
        )
    games: List[FischerGame] = []
    number = 0
    with open(path, encoding="utf-8", errors="replace") as f:
        while True:
            game = chess.pgn.read_game(f)
            if game is None:
                break
            number += 1
            if game.errors:
                raise ValueError(f"Illegal moves in {path} game {number}: {game.errors[0]}")
            white = game.headers.get("White", "?")
            black = game.headers.get("Black", "?")
            if "Fischer" in white:
                color = chess.WHITE
            elif "Fischer" in black:
                color = chess.BLACK
            else:
                continue
            if sum(1 for _ in game.mainline_moves()) < MIN_PLIES:
                continue
            games.append(
                FischerGame(
                    game=game,
                    source=source,
                    number=number,
                    fischer_color=color,
                    white=white,
                    black=black,
                    event=game.headers.get("Event", "?"),
                    site=game.headers.get("Site", "?"),
                    date=game.headers.get("Date", "?"),
                    result=game.headers.get("Result", "*"),
                )
            )
    return games


_cache: Optional[List[FischerGame]] = None


def load_corpus() -> List[FischerGame]:
    """All usable Fischer games from both sources (cached)."""
    global _cache
    if _cache is None:
        _cache = _read_pgn(M60MG_PGN, "m60mg") + _read_pgn(WC1972_PGN, "wc1972")
    return _cache


def fischer_result_score(fg: FischerGame) -> float:
    """1.0 if Fischer won the game, 0.5 for a draw or unrecorded result, 0.0 loss."""
    if fg.result == "1-0":
        return 1.0 if fg.fischer_color == chess.WHITE else 0.0
    if fg.result == "0-1":
        return 1.0 if fg.fischer_color == chess.BLACK else 0.0
    return 0.5  # draws and "*" (some M60MG headers lack a recorded result)
