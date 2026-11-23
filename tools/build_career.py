"""Build data/career.pgn - Fischer's serious games outside the two core files.

    python tools/build_career.py /path/to/Fischer.pgn

The input is PGN Mentor's collection of Fischer's games
(https://www.pgnmentor.com/players/Fischer.zip, 827 games, 1955-1992).
Kept: tournament and match games. Dropped: blitz, simultaneous displays,
casual games, the 1977 games against a computer, forfeits, and every game
that is already in data/m60mg.pgn or data/wc1972.pgn.

Every kept game is re-parsed and must be fully legal.
"""

import io
import sys
from pathlib import Path

import chess
import chess.pgn

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "career.pgn"

MIN_PLIES = 20
# Events that are not serious over-the-board play.
EXCLUDED_EVENT_WORDS = ("blitz", " sim", "Freie Partie", "Cambridge")
HEADERS = ("Event", "Site", "Date", "Round", "White", "Black", "Result", "ECO")


def read_games(path, encoding):
    games = []
    with open(path, encoding=encoding, errors="replace") as handle:
        while True:
            game = chess.pgn.read_game(handle)
            if game is None:
                return games
            games.append(game)


def surname(name):
    return name.split(",")[0].strip().lower()


def identity(game):
    """(white surname, black surname, year) - enough to pair a game across sources."""
    return (surname(game.headers.get("White", "")), surname(game.headers.get("Black", "")),
            game.headers.get("Date", "????")[:4])


def moves_of(game):
    return [move.uci() for move in game.mainline_moves()]


def positions_of(game):
    """The set of positions reached in the game (order of moves does not matter)."""
    board = game.board()
    seen = set()
    for move in game.mainline_moves():
        board.push(move)
        seen.add(board.epd())
    return seen


# The M60MG transcription spells a few names its own way.
ALIASES = {"gligorich": "gligoric", "trifunovich": "trifunovic", "bednarsky": "bednarski",
           "korchnoi": "kortschnoj"}


def canonical(name):
    name = surname(name)
    return ALIASES.get(name, name)


def is_core_game(game, core):
    """Is this game one of the 60 Memorable Games or the 1972 match?

    Players and year must agree and the two scores must pass through the same
    positions. (Comparing positions rather than moves copes with the places
    where the book and the database differ in a move order, and several of
    his opponents met him more than once in a year with the same opening.)
    """
    white, black, year = canonical(game.headers["White"]), canonical(game.headers["Black"]), identity(game)[2]
    positions = None
    for c_white, c_black, c_year, c_positions in core:
        if c_year != year or c_white != white or c_black != black:
            continue
        if positions is None:
            positions = positions_of(game)
        shared = len(positions & c_positions) / min(len(positions), len(c_positions))
        if shared >= 0.8:
            return True
    return False


def main():
    source = Path(sys.argv[1])
    games = read_games(source, "latin-1")
    core = []
    for name in ("m60mg.pgn", "wc1972.pgn"):
        for game in read_games(DATA / name, "utf-8"):
            core.append((canonical(game.headers["White"]), canonical(game.headers["Black"]),
                         game.headers.get("Date", "????")[:4], positions_of(game)))

    kept, dropped = [], {"not serious": 0, "too short": 0, "already in core files": 0, "no Fischer": 0}
    for game in games:
        headers = game.headers
        if "Fischer" not in headers.get("White", "") and "Fischer" not in headers.get("Black", ""):
            dropped["no Fischer"] += 1
        elif any(word in headers.get("Event", "") for word in EXCLUDED_EVENT_WORDS):
            dropped["not serious"] += 1
        elif len(moves_of(game)) < MIN_PLIES:
            dropped["too short"] += 1
        elif is_core_game(game, core):
            dropped["already in core files"] += 1
        else:
            assert not game.errors, (headers, game.errors)
            assert headers.get("Result") in ("1-0", "0-1", "1/2-1/2"), headers
            kept.append(game)

    out = io.StringIO()
    for game in kept:
        clean = chess.pgn.Game()
        for key in HEADERS:
            clean.headers[key] = game.headers.get(key, "?")
        node = clean
        for move in game.mainline_moves():
            node = node.add_variation(move)
        print(clean, file=out, end="\n\n")
    OUT.write_text(out.getvalue(), encoding="utf-8", newline="\n")

    check = read_games(OUT, "utf-8")
    assert len(check) == len(kept) and not any(g.errors for g in check)
    assert [moves_of(g) for g in check] == [moves_of(g) for g in kept]
    print(f"{len(games)} games in {source.name}")
    for reason, count in dropped.items():
        print(f"  dropped {count:3d}  {reason}")
    print(f"  kept    {len(kept):3d}  -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
