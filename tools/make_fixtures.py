"""Generate the fixtures the JavaScript tests are checked against.

    python tools/make_fixtures.py [rules] [style] [book]

python-chess and the Python implementation in fischerbot/ are the reference:
the JavaScript rules library, style features and opening book must reproduce
these files exactly. Output goes to web/tests/fixtures/*.json.gz.
"""

import gzip
import json
import random
import sys
from pathlib import Path

import chess

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fischerbot.book import OpeningBook  # noqa: E402
from fischerbot.dataset import load_corpus  # noqa: E402
from fischerbot.engine import static_exchange  # noqa: E402
from fischerbot.style import (  # noqa: E402
    ENGINE_BEST, ENGINE_LOSS, GLOBAL_FEATURES, N_FEATURES, N_PHASE, PHASE_FEATURES,
    PositionContext, StyleModel, feature_names, game_phase, move_features,
)

OUT = ROOT / "web" / "tests" / "fixtures"
SEED = 1972

# Positions that exercise the corners of the rules.
SPECIAL_FENS = [
    chess.STARTING_FEN,
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",      # "Kiwipete"
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",                                    # en passant pins
    "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",          # promotions, checks
    "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",               # en passant available
    "rnbqkbnr/pppp1ppp/8/8/4pP2/8/PPPPP1PP/RNBQKBNR b KQkq f3 0 2",                # ep square set, no capture possible
    "8/8/8/8/k2Pp2Q/8/8/3K4 b - d3 0 1",                                            # ep capture would expose the king
    "8/P6k/8/8/8/8/6pK/8 w - - 0 1",                                                # promotions both sides
    "1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1",                                             # capture-promotion
    "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1",                                         # all castling
    "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1",
    "r3k2r/8/8/8/8/8/6n1/R3K2R w KQkq - 0 1",                                       # castling through attack
    "4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1",                                           # in check: no castling
    "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1",                                               # stalemate
    "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1",                                               # checkmate
    "8/8/8/4k3/8/8/8/KB6 w - - 0 1",                                                # insufficient material
    "8/8/8/4k3/8/8/8/KNN5 w - - 0 1",
    "6k1/5p1p/8/8/8/8/rq6/2Q4K w - - 0 1",
    "R6r/6k1/8/8/8/8/8/R3K2R w KQ - 0 1",                                           # two rooks take on h8
    "3rk3/8/8/8/8/2n5/8/3RK3 b - - 0 1",
    "8/8/2k5/8/8/3N1N2/8/3K4 w - - 0 1",                                            # SAN disambiguation (two knights)
    "8/8/2k5/8/R6R/8/8/R2K4 w - - 0 1",                                             # three rooks: file and rank disambiguation
    "8/8/1k6/8/4Q2Q/8/8/K6Q w - - 0 1",                                             # full-square disambiguation
    # Insufficient material, as python-chess defines it
    "8/8/8/4k3/8/8/8/K7 w - - 0 1",                                                 # K v K
    "8/8/8/4k3/8/8/8/KN6 w - - 0 1",                                                # K+N v K
    "8/8/8/4k3/2b5/8/8/KB6 w - - 0 1",                                              # bishops on opposite colours
    "8/8/8/4k3/3b4/8/8/KB6 w - - 0 1",                                              # bishops on the same colour
    "8/8/8/4k3/8/8/8/KB1B4 w - - 0 1",                                              # two bishops, same colour
    "8/8/8/4k3/3n4/8/8/KN6 w - - 0 1",                                              # K+N v K+N
    "8/8/8/4k3/3q4/8/8/KN6 w - - 0 1",                                              # K+N v K+Q
    "8/8/8/4k3/3b4/8/8/KN6 w - - 0 1",                                              # K+N v K+B
    "8/8/8/4k3/8/8/P7/K7 w - - 0 1",                                                # a pawn is enough
]


for _fen in SPECIAL_FENS:
    assert chess.Board(_fen).is_valid(), f"not a legal position: {_fen}"


def write(name, payload):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json.gz"
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    with gzip.GzipFile(path, "wb", mtime=0) as handle:   # mtime=0: byte-identical on every run
        handle.write(raw)
    print(f"wrote {path.relative_to(ROOT)}: {len(raw) // 1024} KB raw, {path.stat().st_size // 1024} KB gzipped")


def corpus_boards(rng, count, min_ply=0):
    """Positions from the real games, each with the moves that led to it."""
    games = load_corpus()
    boards = []
    while len(boards) < count:
        fg = rng.choice(games)
        moves = list(fg.game.mainline_moves())
        if len(moves) <= min_ply + 1:
            continue
        cut = rng.randint(min_ply, len(moves) - 1)
        board = fg.game.board()
        for move in moves[:cut]:
            board.push(move)
        boards.append(board)
    return boards


def playout_boards(rng, count):
    """Positions from random games: promotions, en passant and odd castling states turn up here."""
    boards = []
    while len(boards) < count:
        board = chess.Board()
        for _ in range(rng.randint(10, 180)):
            if board.is_game_over():
                break
            moves = list(board.legal_moves)
            noisy = [m for m in moves if board.is_capture(m) or m.promotion or board.is_castling(m)]
            board.push(rng.choice(noisy) if noisy and rng.random() < 0.35 else rng.choice(moves))
        boards.append(board)
    return boards


def rare_boards(rng, wanted):
    """Random-game positions that offer en passant, promotion or castling right now."""
    found = {kind: [] for kind in wanted}
    while any(len(found[kind]) < wanted[kind] for kind in wanted):
        board = chess.Board()
        for _ in range(rng.randint(8, 160)):
            if board.is_game_over():
                break
            moves = list(board.legal_moves)
            kinds = set()
            for move in moves:
                if board.is_en_passant(move):
                    kinds.add("ep")
                if move.promotion:
                    kinds.add("promotion")
                if board.is_castling(move):
                    kinds.add("castle")
            for kind in kinds:
                if len(found[kind]) < wanted[kind] and rng.random() < 0.3:
                    found[kind].append(board.copy())
            pawn_moves = [m for m in moves if board.piece_type_at(m.from_square) == chess.PAWN]
            board.push(rng.choice(pawn_moves) if pawn_moves and rng.random() < 0.45 else rng.choice(moves))
    return [board for kind in wanted for board in found[kind]]


def rules_case(board, rng, with_history):
    names = chess.SQUARE_NAMES
    legal = []
    for move in board.legal_moves:
        after = board.copy(stack=False)
        after.push(move)
        castle = "K" if board.is_kingside_castling(move) else "Q" if board.is_queenside_castling(move) else None
        legal.append({
            "uci": move.uci(),
            "san": board.san(move),
            "capture": board.is_capture(move),
            "ep": board.is_en_passant(move),
            "castle": castle,
            "check": board.gives_check(move),
            # Exchange evaluation is defined for ordinary moves only.
            "see": None if (move.promotion or castle) else static_exchange(board, move),
            "fen": after.fen(),
        })
    legal.sort(key=lambda m: m["uci"])
    squares = rng.sample(range(64), 8)
    attackers = {names[sq]: {"w": sorted(names[a] for a in board.attackers(chess.WHITE, sq)),
                             "b": sorted(names[a] for a in board.attackers(chess.BLACK, sq))}
                 for sq in squares}
    case = {
        "fen": board.fen(),
        "epd": board.epd(),
        "turn": "w" if board.turn else "b",
        "check": board.is_check(),
        "checkmate": board.is_checkmate(),
        "stalemate": board.is_stalemate(),
        "insufficient": board.is_insufficient_material(),
        "legal": legal,
        "attackers": attackers,
        "pieces": {names[sq]: piece.symbol() for sq, piece in board.piece_map().items()},
    }
    if with_history:
        root = board.root()
        case["start"] = root.fen()
        case["moves"] = [m.uci() for m in board.move_stack]
        case["repetition3"] = board.is_repetition(3)
        case["claimThreefold"] = board.can_claim_threefold_repetition()
        case["claimFifty"] = board.can_claim_fifty_moves()
        case["halfmove"] = board.halfmove_clock
        case["fullmove"] = board.fullmove_number
    return case


def repetition_boards():
    """Games that shuffle pieces, to test repetition and the fifty-move rule with real history."""
    boards = []
    for cycles in (1, 2, 3):
        board = chess.Board()
        for uci in ["g1f3", "g8f6", "f3g1", "f6g8"] * cycles:
            board.push_uci(uci)
        boards.append(board.copy())
        board.push_uci("g1f3")
        boards.append(board.copy())
    board = chess.Board("7k/8/8/8/8/8/8/R6K w - - 96 60")
    for uci in ["a1a2", "h8g8", "a2a1", "g8h8"]:
        board.push_uci(uci)
        boards.append(board.copy())
    return boards


PERFT = [  # (fen, [nodes at depth 1, 2, ...]) - standard reference counts
    (chess.STARTING_FEN, [20, 400, 8902, 197281, 4865609]),
    ("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862, 4085603]),
    ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238, 674624]),
    ("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467, 422333]),
    ("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379, 2103487]),
    ("r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", [46, 2079, 89890, 3894594]),
]


def perft(board, depth):
    if depth == 0:
        return 1
    if depth == 1:
        return board.legal_moves.count()
    total = 0
    for move in board.legal_moves:
        board.push(move)
        total += perft(board, depth - 1)
        board.pop()
    return total


def make_rules():
    rng = random.Random(SEED)
    cases = [rules_case(chess.Board(fen), rng, False) for fen in SPECIAL_FENS]
    cases += [rules_case(board, rng, True) for board in corpus_boards(rng, 110)]
    cases += [rules_case(board, rng, True) for board in playout_boards(rng, 70)]
    cases += [rules_case(board, rng, True)
              for board in rare_boards(rng, {"ep": 25, "promotion": 25, "castle": 15})]
    cases += [rules_case(board, rng, True) for board in repetition_boards()]
    # The well-known reference counts, confirmed here with python-chess to depth 3.
    for fen, counts in PERFT:
        for depth in (1, 2, 3):
            assert perft(chess.Board(fen), depth) == counts[depth - 1], (fen, depth)
    write("rules", {
        "about": "Reference behaviour of python-chess for web/static/js/rules.js",
        "cases": cases,
        "perft": [{"fen": fen, "counts": counts} for fen, counts in PERFT],
    })
    moves = sum(len(c["legal"]) for c in cases)
    flags = {k: sum(1 for c in cases for m in c["legal"] if m[k]) for k in ("capture", "ep", "check")}
    flags["castle"] = sum(1 for c in cases for m in c["legal"] if m["castle"])
    flags["promotion"] = sum(1 for c in cases for m in c["legal"] if len(m["uci"]) == 5)
    print(f"  {len(cases)} positions, {moves} moves, {flags}; "
          f"{sum(c['checkmate'] for c in cases)} mates, {sum(c['stalemate'] for c in cases)} stalemates")


MATES = [  # (fen, first move, mate in N) - each verified with Stockfish
    ("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", "a1a8", 1),
    ("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "h5f7", 1),
    ("r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 1", "d5f6", 2),
    ("r1b3kr/ppp1Bp1p/1b6/n2P4/2p3q1/2Q2N2/P4PPP/RN2R1K1 w - - 1 1", "c3h8", 3),
    ("r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1", "f6a6", 3),
    ("2r3k1/p4p2/3Rp2p/1p2P1pK/8/1P4P1/P3Q2P/1q6 b - - 0 1", "b1g6", 3),
]


def make_engine():
    rng = random.Random(SEED + 1)
    positions = []
    for board in corpus_boards(rng, 60, min_ply=8):
        if board.is_game_over():
            continue
        positions.append({
            "fen": board.fen(),
            "mirror": board.mirror().fen(),
            "legal": sorted(m.uci() for m in board.legal_moves),
            "check": board.is_check(),
        })
    for fen, move, _ in MATES:
        assert chess.Move.from_uci(move) in chess.Board(fen).legal_moves

    # Draws that only the game's history reveals. White is lost unless he
    # repeats: after these moves 1.Qd8+ reaches a position already on the board
    # once, which a search must score as a draw even at depth 1.
    perpetual = chess.Board("6k1/5p1p/8/8/8/8/rq6/2Q4K w - - 0 1")
    history = ["c1g5", "g8f8", "g5d8", "f8g7", "d8g5", "g7f8"]
    for uci in history:
        perpetual.push_uci(uci)
    perpetual.push_uci("g5d8")
    assert perpetual.is_repetition(2)
    # The winning side must not walk back into a position from the game.
    rook = chess.Board("8/8/8/4k3/8/8/8/KR6 w - - 0 1")
    shuffle = ["b1b2", "e5e4", "b2b1", "e4e5", "b1b2", "e5e4"]
    for uci in shuffle:
        rook.push_uci(uci)
    rook.push_uci("b2b1")
    assert rook.is_repetition(2)
    write("engine", {
        "about": "Positions for the engine conformance tests (web/tests/engine_conformance.js)",
        "positions": positions,
        "mates": [{"fen": fen, "move": move, "mateIn": n} for fen, move, n in MATES],
        "perft": [{"fen": fen, "counts": counts} for fen, counts in PERFT],
        "historyDraw": {"fen": "6k1/5p1p/8/8/8/8/rq6/2Q4K w - - 0 1", "moves": history,
                        "move": "g5d8", "score": 0},
        "historyAvoid": {"fen": "8/8/8/4k3/8/8/8/KR6 w - - 0 1", "moves": shuffle, "avoid": "b2b1"},
    })


def make_style():
    """Style features of every legal move in a spread of positions, and the model's scores."""
    rng = random.Random(SEED + 2)
    model = StyleModel.load()
    boards = corpus_boards(rng, 150) + rare_boards(rng, {"ep": 12, "promotion": 12, "castle": 12})
    cases = []
    for board in boards:
        if board.is_game_over():
            continue
        ctx = PositionContext(board)
        cases.append({
            "start": board.root().fen(),
            "moves": [m.uci() for m in board.move_stack],
            "fen": board.fen(),
            "phase": game_phase(board),
            "features": {m.uci(): sorted([i, v] for i, v in move_features(ctx, m)) for m in board.legal_moves},
            "scores": {m.uci(): score for m, score in model.style_scores(board)},
        })
    gains = [-0.5, 0.0, 0.2, 0.5, 0.75, 1.0, 1.5, 2.5, 4.0]
    write("style", {
        "about": "Reference output of fischerbot/style.py for web/static/js/style.js",
        "phaseFeatures": PHASE_FEATURES,
        "globalFeatures": GLOBAL_FEATURES,
        "featureNames": feature_names(),
        "nPhase": N_PHASE,
        "nFeatures": N_FEATURES,
        "engineLoss": ENGINE_LOSS,
        "engineBest": ENGINE_BEST,
        "enginePreference": model.engine_preference,
        "cases": cases,
        "allowedLoss": [[phase, gain, model.allowed_loss(phase, gain)] for phase in range(3) for gain in gains],
    })
    print(f"  {len(cases)} positions, {sum(len(c['features']) for c in cases)} moves; "
          f"phases {[sum(1 for c in cases if c['phase'] == p) for p in range(3)]}")


ERAS = [(None, False), (1956, False), (1958, False), (1963, False), (1972, True)]
DRAWS = [0.0, 0.2, 0.5, 0.8, 0.999]


def make_book():
    """What the book answers in a spread of positions, for every era the bot can be set to."""
    rng = random.Random(SEED + 3)
    book = OpeningBook(load_corpus())
    games = load_corpus()
    boards = [chess.Board()]
    while len(boards) < 70:
        fg = rng.choice(games)
        moves = list(fg.game.mainline_moves())
        cut = rng.randint(0, min(len(moves) - 1, 44))        # a few just beyond the book's depth
        board = fg.game.board()
        for move in moves[:cut]:
            board.push(move)
        boards.append(board)
    for uci_line in (["a2a3"], ["e2e4", "a7a6"], ["d2d4", "g8f6", "c2c4"], ["c2c4", "g8f6", "d2d4"]):
        board = chess.Board()
        for uci in uci_line:
            board.push_uci(uci)
        boards.append(board)

    def rows(moves):
        return [[m.uci, m.count, m.result_points, round(m.weight, 9), [g.key for g in m.games[:4]]] for m in moves]

    cases = []
    for board in boards:
        for year, later in ERAS:
            picks = []
            for r in DRAWS:
                pick = book.choose(board, year, later, r=r)
                picks.append(pick.uci if pick else None)
            cases.append({
                "moves": [m.uci() for m in board.move_stack],
                "epd": board.epd(),
                "year": year,
                "later": later,
                "lookup": rows(book.lookup(board, year, later)),
                "replies": rows(book.replies(board, year, later)),
                "draws": DRAWS,
                "picks": picks,
            })
    write("book_cases", {
        "about": "Reference answers of fischerbot/book.py for web/static/js/book.js (book file: web/static/data/book.json)",
        "cases": cases,
    })
    print(f"  {len(boards)} positions x {len(ERAS)} eras; "
          f"{sum(1 for c in cases if c['lookup'])} with a book move, {sum(1 for c in cases if c['replies'])} with replies")


if __name__ == "__main__":
    wanted = sys.argv[1:] or ["rules", "engine", "style", "book"]
    if "rules" in wanted:
        make_rules()
    if "engine" in wanted:
        make_engine()
    if "style" in wanted:
        make_style()
    if "book" in wanted:
        make_book()
