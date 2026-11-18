"""Loading of the real Fischer game corpus.

Three sources ship with the repo (see data/README.md for provenance):
  - m60mg.pgn   — the 60 games of "My 60 Memorable Games"
  - wc1972.pgn  — all 21 games of the 1972 World Championship vs Spassky
  - career.pgn  — his other serious tournament and match games, 1955-1992

Every game is parsed with python-chess and must be fully legal; games with
recorded parse errors are rejected loudly rather than silently skipped.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import chess
import chess.pgn

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
M60MG_PGN = DATA_DIR / "m60mg.pgn"
WC1972_PGN = DATA_DIR / "wc1972.pgn"
CAREER_PGN = DATA_DIR / "career.pgn"

#: Source name -> file, in the order games are returned by load_corpus().
SOURCES: Dict[str, Path] = {"m60mg": M60MG_PGN, "wc1972": WC1972_PGN, "career": CAREER_PGN}
#: The two files the project started from.
CORE_SOURCES = ("m60mg", "wc1972")

MIN_PLIES = 10  # skips the game-2 forfeit of the 1972 match


@dataclass(frozen=True)
class FischerGame:
    game: chess.pgn.Game
    source: str        # "m60mg", "wc1972" or "career"
    number: int        # game number within its source (1-based)
    fischer_color: chess.Color
    white: str
    black: str
    event: str
    site: str
    date: str
    result: str
    eco: str = ""

    @property
    def key(self) -> str:
        """Stable identifier, e.g. "wc1972#6"."""
        return f"{self.source}#{self.number}"

    @property
    def year(self) -> int:
        try:
            return int(self.date[:4])
        except (TypeError, ValueError):
            return 0

    @property
    def opponent(self) -> str:
        """The other player's surname, as it reads best in a sentence."""
        name = self.black if self.fischer_color == chess.WHITE else self.white
        if name in _FULL_NAME_ALIASES:
            return _FULL_NAME_ALIASES[name]
        surname = name.split(",")[0].strip()
        return _SURNAME_ALIASES.get(surname, surname)

    @property
    def event_name(self) -> str:
        """The event in readable form ("Candidats qf3" -> "Candidates quarter-final")."""
        if self.source == "wc1972":
            return "World Championship"
        if self.source == "career":
            return _CAREER_EVENTS.get(self.event, self.event)
        name = _pretty_event(self.event)
        return _BOOK_EVENTS.get(name, name)

    @property
    def citation(self) -> str:
        opponent = self.opponent
        if self.source == "wc1972":
            return f"Fischer–Spassky, World Championship 1972, Game {self.number}" \
                if self.fischer_color == chess.WHITE \
                else f"Spassky–Fischer, World Championship 1972, Game {self.number}"
        first = "Fischer" if self.fischer_color == chess.WHITE else opponent
        second = opponent if self.fischer_color == chess.WHITE else "Fischer"
        where = self.event_name
        where = f", {where}" if where else ""
        year = self.year or ""
        if self.source == "m60mg":
            return f"{first}–{second}{where} {year} (My 60 Memorable Games, #{self.number})"
        if self.is_game_of_the_century:
            return f"{first}–{second}{where} {year} (the “Game of the Century”)"
        return f"{first}–{second}{where} {year}".rstrip()

    @property
    def is_game_of_the_century(self) -> bool:
        """Donald Byrne-Fischer, Rosenwald Trophy 1956: the 13-year-old's queen sacrifice."""
        return (self.source == "career" and self.year == 1956 and self.white == "Byrne, Donald"
                and self.event == "New York Rosenwald" and self.result == "0-1")

    @property
    def fischer_score(self) -> float:
        """1.0 if Fischer won, 0.5 for a draw, 0.0 for a loss."""
        return fischer_result_score(self)


# The database spells some names and events its own way.
_SURNAME_ALIASES = {"Kortschnoj": "Korchnoi", "Huebner": "Hübner", "Dueckstein": "Dückstein",
                    "Buerger": "Bürger", "Schoene": "Schöne"}
_FULL_NAME_ALIASES = {"Byrne, Robert E": "R. Byrne", "Byrne, Donald": "D. Byrne"}
_CAREER_EVENTS = {
    "USA-ch": "U.S. Championship", "USA-op": "U.S. Open", "USA-chJ": "U.S. Junior Championship",
    "USA-ch Juniors": "U.S. Junior Championship", "USA-ch amateurs": "U.S. Amateur Championship",
    "USA-chT": "New York team match", "Team championchip": "team match", "CAN-op": "Canadian Open",
    "New York Rosenwald": "Rosenwald Trophy, New York", "New York m3": "New York match",
    "New York m4": "New York match", "New York/Los Angeles m": "New York/Los Angeles match",
    "Belgrade m": "Belgrade", "POL-USA": "Poland–USA match", "Zuerich": "Zurich",
    "Portoroz Interzonal": "Portorož Interzonal", "Sousse Interzonal+": "Sousse Interzonal",
    "Candidats Tournament": "Candidates Tournament", "Candidats qf3": "Candidates quarter-final",
    "Candidats sf1": "Candidates semi-final", "Candidats final": "Candidates final",
    "Leipzig olm prel": "Leipzig Olympiad", "Leipzig olm fin-A": "Leipzig Olympiad",
    "Varna olm": "Varna Olympiad", "La Habana olm prel": "Havana Olympiad",
    "La Habana olm fin-A": "Havana Olympiad", "Siegen olm": "Siegen Olympiad",
    "Capablanca mem": "Capablanca Memorial", "Santa Monica": "Piatigorsky Cup, Santa Monica",
    "Poughskeepie": "Poughkeepsie", "Meralco": "Manila", "Netanya-A": "Netanya",
    "Belgrade URS-World": "USSR vs. Rest of the World, Belgrade",
    "St Stefan/Belgrade m": "Sveti Stefan/Belgrade match",
}

# "My 60 Memorable Games" heads its chapters in its own words; where the same
# event also appears in the career file, one name is used for both.
_BOOK_EVENTS = {
    "Portoroz": "Portorož Interzonal", "Stockholm": "Stockholm Interzonal",
    "Interzonal, Sousse": "Sousse Interzonal", "Candidates' Tournament": "Candidates Tournament",
    "USA Championship": "U.S. Championship", "Leipzig Olympic": "Leipzig Olympiad",
    "Varna Olympic": "Varna Olympiad", "Havana Olympic": "Havana Olympiad",
    "Havana": "Capablanca Memorial", "Santa Monica": "Piatigorsky Cup, Santa Monica",
    "Monaco": "Monte Carlo",
}

_LOWERCASE_WORDS = {"del", "de", "la"}
_UPPERCASE_WORDS = {"usa": "USA", "u.s.a.": "USA"}


def _pretty_event(event: str) -> str:
    """'CANDIDATES’ TOURNAMENT' -> "Candidates' Tournament" (the M60MG headers are upper-case)."""
    if not event or event == "?":
        return ""
    words = []
    for word in event.replace("’", "'").split():
        lower = word.lower()
        if lower in _UPPERCASE_WORDS:
            words.append(_UPPERCASE_WORDS[lower])
        elif lower in _LOWERCASE_WORDS and words:
            words.append(lower)
        else:
            words.append(word.capitalize())
    return " ".join(words)


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
                    eco=game.headers.get("ECO", ""),
                )
            )
    return games


_cache: Dict[str, List[FischerGame]] = {}


def load_corpus(sources: Optional[Iterable[str]] = None) -> List[FischerGame]:
    """Usable Fischer games (cached), in the order of SOURCES.

    `sources` picks a subset, e.g. CORE_SOURCES for the 80 games the project
    started from; by default every game is returned.
    """
    wanted = tuple(SOURCES) if sources is None else tuple(sources)
    unknown = [name for name in wanted if name not in SOURCES]
    if unknown:
        raise ValueError(f"Unknown corpus source(s) {unknown}; choose from {list(SOURCES)}")
    games: List[FischerGame] = []
    for name in SOURCES:
        if name in wanted:
            if name not in _cache:
                _cache[name] = _read_pgn(SOURCES[name], name)
            games.extend(_cache[name])
    return games


def fischer_result_score(fg: FischerGame) -> float:
    """1.0 if Fischer won the game, 0.5 for a draw (or unknown result), 0.0 for a loss."""
    if fg.result == "1-0":
        return 1.0 if fg.fischer_color == chess.WHITE else 0.0
    if fg.result == "0-1":
        return 1.0 if fg.fischer_color == chess.BLACK else 0.0
    return 0.5
