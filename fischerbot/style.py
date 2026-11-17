"""Fischer style model: which of the sound moves would Fischer play?

The engine decides which moves are *playable*; this model decides which of
them looks most like Fischer. It is a conditional-logit ranker

    P(move | position) ∝ exp(w · f(position, move))

trained (see train_style.py) on the positions of the corpus where Fischer
was to move, with the choice set restricted to the moves the engine scored
within about half a pawn of its favourite. Training on that set, rather than on
all legal moves, means the weights describe preference between reasonable
moves instead of re-learning "do not hang your queen".

Two of the features come from the engine itself - how many centipawns a move
gives up against the engine's first choice, and whether it *is* the first
choice - so the trade-off between style and objective strength is learned
from Fischer's games rather than set by hand. `allowed_loss` turns those two
weights into the price the bot may pay for a more Fischer-like move.

Weights are stored as JSON: human-readable, no pickle.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import chess

from .engine import static_exchange

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "style.json"

PHASES = ("opening", "middlegame", "endgame")
OPENING_MOVES = 12  # full moves treated as "the opening"

#: Features learned separately for each phase of the game.
PHASE_FEATURES = [
    "piece_pawn",
    "piece_knight",
    "piece_bishop",
    "piece_rook",
    "piece_queen",
    "piece_king",
    "capture",
    "capture_value",
    "recapture",
    "even_trade",
    "check",
    "forward",
    "retreat",
    "to_centre",
    "centre_gain",
    "near_enemy_king",
    "king_approach",
    "escapes_attack",
    "into_pawn_attack",
    "to_defended",
    "creates_threat",
    "quiet_move",
    "sacrifice",
    "engine_loss",
    "engine_best",
]

#: Features with one weight for the whole game.
GLOBAL_FEATURES = [
    "castle_kingside",
    "castle_queenside",
    "promotion",
    "pawn_centre_push",
    "pawn_bishop_file_push",
    "pawn_flank_push",
    "pawn_double_step",
    "pawn_lever",
    "pawn_passed_push",
    "pawn_storm",
    "pawn_shelter_push",
    "knight_develops",
    "knight_to_rim",
    "knight_outpost",
    "bishop_develops",
    "bishop_fianchetto",
    "bishop_long_diagonal",
    "bishop_takes_knight",
    "knight_takes_bishop",
    "rook_open_file",
    "rook_semi_open_file",
    "rook_seventh_rank",
    "queen_early",
    "queen_trade",
    "king_walk",
    "king_to_centre_endgame",
]

N_PHASE = len(PHASE_FEATURES)
N_GLOBAL = len(GLOBAL_FEATURES)
_GLOBAL_OFFSET = N_PHASE * len(PHASES)
_REPERTOIRE_OFFSET = _GLOBAL_OFFSET + N_GLOBAL
#: Opening repertoire: where each piece goes in the first moves, per colour.
N_REPERTOIRE = 2 * 6 * 64
N_FEATURES = _REPERTOIRE_OFFSET + N_REPERTOIRE

_P = {name: i for i, name in enumerate(PHASE_FEATURES)}
_G = {name: _GLOBAL_OFFSET + i for i, name in enumerate(GLOBAL_FEATURES)}
ENGINE_LOSS = _P["engine_loss"]
ENGINE_BEST = _P["engine_best"]

_VALUE = (0, 1, 3, 3, 5, 9, 0)  # by piece type, in pawns
_BB = chess.BB_SQUARES
_CENTRALITY = [
    (3.5 - abs((sq & 7) - 3.5)) * (3.5 - abs((sq >> 3) - 3.5)) / 12.25 for sq in range(64)
]
_LONG_DIAGONALS = chess.BB_A1 | chess.BB_B2 | chess.BB_C3 | chess.BB_D4 | chess.BB_E5 \
    | chess.BB_F6 | chess.BB_G7 | chess.BB_H8 | chess.BB_A8 | chess.BB_B7 | chess.BB_C6 \
    | chess.BB_D5 | chess.BB_E4 | chess.BB_F3 | chess.BB_G2 | chess.BB_H1
_FIANCHETTO = chess.BB_B2 | chess.BB_G2 | chess.BB_B7 | chess.BB_G7
_RIM = chess.BB_FILE_A | chess.BB_FILE_H


def feature_names() -> List[str]:
    """Name of every weight, in order (for inspection of a trained model)."""
    names = [f"{phase}:{name}" for phase in PHASES for name in PHASE_FEATURES]
    names += list(GLOBAL_FEATURES)
    for colour in ("white", "black"):
        for piece in "PNBRQK":
            for sq in range(64):
                names.append(f"repertoire:{colour}:{piece}{chess.SQUARE_NAMES[sq]}")
    return names


def game_phase(board: chess.Board) -> int:
    """0 = opening, 1 = middlegame, 2 = endgame."""
    if board.fullmove_number <= OPENING_MOVES:
        return 0
    minor_and_rooks = (board.knights | board.bishops | board.rooks).bit_count()
    if not board.queens or minor_and_rooks <= 4:
        return 2
    return 1


class PositionContext:
    """Everything about a position that is shared by all of its moves."""

    __slots__ = (
        "board", "turn", "phase", "own", "them", "occupied", "own_pawns", "enemy_pawns",
        "enemy_pawn_attacks", "enemy_king", "own_king", "last_to", "opening",
        "check_squares", "discoverers", "attacked_cache", "home_rank",
    )

    def __init__(self, board: chess.Board):
        self.board = board
        turn = self.turn = board.turn
        self.phase = game_phase(board)
        self.opening = board.fullmove_number <= OPENING_MOVES
        own = self.own = board.occupied_co[turn]
        them = self.them = board.occupied_co[not turn]
        occupied = self.occupied = board.occupied
        self.own_pawns = board.pawns & own
        enemy_pawns = self.enemy_pawns = board.pawns & them
        if turn:  # enemy pawns are black: they attack downwards
            self.enemy_pawn_attacks = (((enemy_pawns >> 7) & ~chess.BB_FILE_A)
                                       | ((enemy_pawns >> 9) & ~chess.BB_FILE_H))
        else:
            self.enemy_pawn_attacks = (((enemy_pawns << 7) & ~chess.BB_FILE_H)
                                       | ((enemy_pawns << 9) & ~chess.BB_FILE_A)) & chess.BB_ALL
        self.enemy_king = (board.kings & them).bit_length() - 1
        self.own_king = (board.kings & own).bit_length() - 1
        self.last_to = board.move_stack[-1].to_square if board.move_stack else -1
        self.home_rank = 0 if turn else 7
        self.attacked_cache: Dict[int, bool] = {}

        # Squares from which each piece type would give check.
        king = self.enemy_king
        diagonal = chess.BB_DIAG_ATTACKS[king][chess.BB_DIAG_MASKS[king] & occupied]
        straight = (chess.BB_RANK_ATTACKS[king][chess.BB_RANK_MASKS[king] & occupied]
                    | chess.BB_FILE_ATTACKS[king][chess.BB_FILE_MASKS[king] & occupied])
        self.check_squares = (0, chess.BB_PAWN_ATTACKS[not turn][king],
                              chess.BB_KNIGHT_ATTACKS[king], diagonal, straight,
                              diagonal | straight, 0)
        snipers = ((chess.BB_DIAG_ATTACKS[king][0] & (board.bishops | board.queens))
                   | ((chess.BB_RANK_ATTACKS[king][0] | chess.BB_FILE_ATTACKS[king][0])
                      & (board.rooks | board.queens))) & own
        discoverers = 0
        while snipers:
            sniper = snipers & -snipers
            snipers ^= sniper
            between = chess.between(king, sniper.bit_length() - 1) & occupied
            if between and not between & (between - 1):
                discoverers |= between
        self.discoverers = discoverers & own

    def escapes_attack(self, from_sq: int, piece_type: int) -> bool:
        """Is the piece on `from_sq` attacked by something cheaper, or loose and attacked?"""
        cached = self.attacked_cache.get(from_sq)
        if cached is not None:
            return cached
        board = self.board
        attackers = board.attackers_mask(not self.turn, from_sq)
        result = False
        if attackers:
            value = _VALUE[piece_type]
            if ((attackers & board.pawns and value > 1)
                    or (attackers & (board.knights | board.bishops) and value > 3)
                    or (attackers & board.rooks and value > 5)):
                result = True
            elif piece_type != chess.KING and not board.attackers_mask(self.turn, from_sq):
                result = True
        self.attacked_cache[from_sq] = result
        return result


def _piece_type(board: chess.Board, mask: int) -> int:
    if board.pawns & mask:
        return 1
    if board.knights & mask:
        return 2
    if board.bishops & mask:
        return 3
    if board.rooks & mask:
        return 4
    if board.queens & mask:
        return 5
    return 6


def _attacks_from(piece_type: int, sq: int, occupied: int, turn: bool) -> int:
    if piece_type == 1:
        return chess.BB_PAWN_ATTACKS[turn][sq]
    if piece_type == 2:
        return chess.BB_KNIGHT_ATTACKS[sq]
    if piece_type == 6:
        return chess.BB_KING_ATTACKS[sq]
    attacks = 0
    if piece_type != 4:
        attacks |= chess.BB_DIAG_ATTACKS[sq][chess.BB_DIAG_MASKS[sq] & occupied]
    if piece_type != 3:
        attacks |= (chess.BB_RANK_ATTACKS[sq][chess.BB_RANK_MASKS[sq] & occupied]
                    | chess.BB_FILE_ATTACKS[sq][chess.BB_FILE_MASKS[sq] & occupied])
    return attacks


def move_features(ctx: PositionContext, move: chess.Move) -> List[Tuple[int, float]]:
    """Sparse style features of one legal move: [(weight index, value), ...].

    The two engine features (`engine_loss`, `engine_best`) are not included;
    the caller adds them once the engine has scored the move.
    """
    board = ctx.board
    turn = ctx.turn
    from_sq, to_sq = move.from_square, move.to_square
    from_bb, to_bb = _BB[from_sq], _BB[to_sq]
    piece = _piece_type(board, from_bb)
    base = ctx.phase * N_PHASE
    feats: List[Tuple[int, float]] = [(base + piece - 1, 1.0)]  # piece_pawn .. piece_king
    add = feats.append

    from_rank, to_rank = from_sq >> 3, to_sq >> 3
    to_file = to_sq & 7
    forward = (to_rank - from_rank) if turn else (from_rank - to_rank)
    castling = piece == 6 and abs(from_sq - to_sq) == 2
    en_passant = piece == 1 and to_sq == board.ep_square and not ctx.occupied & to_bb
    capture = bool(ctx.them & to_bb) or en_passant
    victim = 1 if en_passant else (_piece_type(board, to_bb) if capture else 0)

    # ---- phase-dependent features
    if capture:
        add((base + _P["capture"], 1.0))
        add((base + _P["capture_value"], _VALUE[victim] / 9.0))
        if to_sq == ctx.last_to:
            add((base + _P["recapture"], 1.0))
        if _VALUE[victim] == _VALUE[piece]:
            add((base + _P["even_trade"], 1.0))

    occupied_after = (ctx.occupied ^ from_bb) | to_bb
    if move.promotion or castling or en_passant:
        check = board.gives_check(move)
    elif from_bb & ctx.discoverers and not chess.ray(from_sq, ctx.enemy_king) & to_bb:
        check = True
    elif piece in (3, 4, 5):
        # A slider's checking squares must be recomputed once it has moved off its line.
        check = bool(_attacks_from(piece, to_sq, occupied_after, turn) & _BB[ctx.enemy_king])
    else:
        check = bool(ctx.check_squares[piece] & to_bb)
    if check:
        add((base + _P["check"], 1.0))

    if forward:
        add((base + _P["forward"], forward / 7.0))
        if forward < 0 and piece != 1:
            add((base + _P["retreat"], 1.0))
    centre_to, centre_from = _CENTRALITY[to_sq], _CENTRALITY[from_sq]
    add((base + _P["to_centre"], centre_to))
    if centre_to != centre_from:
        add((base + _P["centre_gain"], centre_to - centre_from))
    near_to = (7 - chess.square_distance(to_sq, ctx.enemy_king)) / 7.0
    near_from = (7 - chess.square_distance(from_sq, ctx.enemy_king)) / 7.0
    add((base + _P["near_enemy_king"], near_to))
    if near_to != near_from:
        add((base + _P["king_approach"], near_to - near_from))

    escapes = ctx.escapes_attack(from_sq, piece)
    if escapes:
        add((base + _P["escapes_attack"], 1.0))
    if piece != 1 and ctx.enemy_pawn_attacks & to_bb:
        add((base + _P["into_pawn_attack"], 1.0))
    if board.attackers_mask(turn, to_sq) & ~from_bb:
        add((base + _P["to_defended"], 1.0))

    threat = False
    if piece != 6:
        targets = _attacks_from(piece, to_sq, occupied_after, turn) & ctx.them & ~to_bb & ~board.kings
        value = _VALUE[piece]
        while targets:
            target = targets & -targets
            targets ^= target
            if (_VALUE[_piece_type(board, target)] > value
                    or not board.attackers_mask(not turn, target.bit_length() - 1)):
                threat = True
                break
    if threat:
        add((base + _P["creates_threat"], 1.0))
    if not (capture or check or threat or escapes or castling or move.promotion):
        add((base + _P["quiet_move"], 1.0))
    if not castling and not move.promotion and static_exchange(board, move) < 0:
        add((base + _P["sacrifice"], 1.0))

    # ---- whole-game features
    if castling:
        add((_G["castle_kingside"] if to_file == 6 else _G["castle_queenside"], 1.0))
    if move.promotion:
        add((_G["promotion"], 1.0))

    if piece == 1:
        if not capture:
            if to_file in (3, 4):
                add((_G["pawn_centre_push"], 1.0))
            elif to_file in (2, 5):
                add((_G["pawn_bishop_file_push"], 1.0))
            else:
                add((_G["pawn_flank_push"], 1.0))
            if forward == 2:
                add((_G["pawn_double_step"], 1.0))
        if chess.BB_PAWN_ATTACKS[turn][to_sq] & ctx.enemy_pawns:
            add((_G["pawn_lever"], 1.0))
        ahead = _ahead_mask(to_sq, turn)
        if not ahead & ctx.enemy_pawns:
            add((_G["pawn_passed_push"], 1.0))
        relative_rank = to_rank if turn else 7 - to_rank
        if relative_rank >= 3 and abs(to_file - (ctx.enemy_king & 7)) <= 1 and not ctx.phase == 2:
            add((_G["pawn_storm"], 1.0))
        if abs((from_sq & 7) - (ctx.own_king & 7)) <= 1 and (ctx.own_king >> 3) == ctx.home_rank:
            add((_G["pawn_shelter_push"], 1.0))
    elif piece == 2:
        if from_rank == ctx.home_rank and to_rank != ctx.home_rank:
            add((_G["knight_develops"], 1.0))
        if to_bb & _RIM:
            add((_G["knight_to_rim"], 1.0))
        relative_rank = to_rank if turn else 7 - to_rank
        if (3 <= relative_rank <= 5
                and chess.BB_PAWN_ATTACKS[not turn][to_sq] & ctx.own_pawns
                and not _attack_span(to_sq, turn) & ctx.enemy_pawns):
            add((_G["knight_outpost"], 1.0))
        if capture and victim == 3:
            add((_G["knight_takes_bishop"], 1.0))
    elif piece == 3:
        if from_rank == ctx.home_rank and to_rank != ctx.home_rank:
            add((_G["bishop_develops"], 1.0))
        if to_bb & _FIANCHETTO:
            add((_G["bishop_fianchetto"], 1.0))
        if to_bb & _LONG_DIAGONALS:
            add((_G["bishop_long_diagonal"], 1.0))
        if capture and victim == 2:
            add((_G["bishop_takes_knight"], 1.0))
    elif piece == 4:
        file_bb = chess.BB_FILES[to_file]
        if (from_sq & 7) != to_file and not ctx.own_pawns & file_bb:
            add((_G["rook_semi_open_file"] if ctx.enemy_pawns & file_bb else _G["rook_open_file"], 1.0))
        if (to_rank if turn else 7 - to_rank) == 6 and from_rank != to_rank:
            add((_G["rook_seventh_rank"], 1.0))
    elif piece == 5:
        if ctx.opening:
            add((_G["queen_early"], 1.0))
        if capture and victim == 5:
            add((_G["queen_trade"], 1.0))
    elif not castling:
        if ctx.phase == 2:
            if centre_to > centre_from:
                add((_G["king_to_centre_endgame"], 1.0))
        else:
            add((_G["king_walk"], 1.0))

    # ---- opening repertoire: where this piece goes in the first moves
    if ctx.opening:
        square = to_sq if turn else to_sq ^ 56
        add((_REPERTOIRE_OFFSET + (0 if turn else 384) + (piece - 1) * 64 + square, 1.0))
    return feats


_AHEAD = ([0] * 64, [0] * 64)        # same and adjacent files, squares in front
_ATTACK_SPAN = ([0] * 64, [0] * 64)  # adjacent files only, squares in front
for _sq in range(64):
    _f, _r = _sq & 7, _sq >> 3
    _adjacent = (chess.BB_FILES[_f - 1] if _f > 0 else 0) | (chess.BB_FILES[_f + 1] if _f < 7 else 0)
    _up = _down = 0
    for _rr in range(_r + 1, 8):
        _up |= chess.BB_RANKS[_rr]
    for _rr in range(0, _r):
        _down |= chess.BB_RANKS[_rr]
    _AHEAD[True][_sq] = (_adjacent | chess.BB_FILES[_f]) & _up
    _AHEAD[False][_sq] = (_adjacent | chess.BB_FILES[_f]) & _down
    _ATTACK_SPAN[True][_sq] = _adjacent & _up
    _ATTACK_SPAN[False][_sq] = _adjacent & _down


def _ahead_mask(sq: int, turn: bool) -> int:
    return _AHEAD[turn][sq]


def _attack_span(sq: int, turn: bool) -> int:
    """Squares from which an enemy pawn could ever attack `sq`."""
    return _ATTACK_SPAN[turn][sq]


class StyleModel:
    """Linear conditional-logit scorer over move features."""

    def __init__(self, weights: Optional[List[float]] = None, metadata: Optional[dict] = None):
        self.weights = list(weights) if weights is not None else [0.0] * N_FEATURES
        if len(self.weights) != N_FEATURES:
            raise ValueError(
                f"Weight vector has {len(self.weights)} entries, expected {N_FEATURES}"
            )
        self.metadata = metadata or {}
        #: Extra reluctance to leave the engine's first choice (chosen by cross-validation).
        self.engine_preference = float(self.metadata.get("engine_preference", 0.0))

    # ------------------------------------------------------------- scoring

    def style_scores(self, board: chess.Board) -> List[Tuple[chess.Move, float]]:
        """(move, style score) for every legal move, most Fischer-like first.

        Engine features are left out: this is pure stylistic preference.
        """
        ctx = PositionContext(board)
        w = self.weights
        scored = []
        for move in board.legal_moves:
            scored.append((move, sum(w[i] * v for i, v in move_features(ctx, move))))
        scored.sort(key=lambda t: t[1], reverse=True)
        return scored

    def rank_moves(self, board: chess.Board) -> List[tuple]:
        """(move, probability) for every legal move by style alone."""
        import math
        scored = self.style_scores(board)
        if not scored:
            return []
        peak = scored[0][1]
        exps = [math.exp(score - peak) for _, score in scored]
        total = sum(exps)
        return [(move, e / total) for (move, _), e in zip(scored, exps)]

    def allowed_loss(self, phase: int, style_gain: float) -> float:
        """Centipawns the bot may give up for a move that is `style_gain` more Fischer-like.

        Derived from the learned weights: a move replaces the engine's first
        choice when  style_gain + engine_loss_weight * loss/100  exceeds the
        engine_best weight plus `engine_preference`.
        """
        base = phase * N_PHASE
        loss_weight = self.weights[base + ENGINE_LOSS]   # negative: losing centipawns is bad
        best_bonus = self.weights[base + ENGINE_BEST] + self.engine_preference
        margin = style_gain - best_bonus
        if margin <= 0:
            return -1.0   # not Fischer-like enough to displace the engine's choice
        if loss_weight >= -1e-9:
            return float("inf")
        return 100.0 * margin / -loss_weight

    # --------------------------------------------------------- persistence

    def save(self, path: Path = MODEL_PATH, metadata: Optional[dict] = None):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if metadata is not None:
            self.metadata = metadata
            self.engine_preference = float(metadata.get("engine_preference", 0.0))
        names = feature_names()
        dense = {name: round(w, 5) for name, w in zip(names[:_REPERTOIRE_OFFSET],
                                                      self.weights[:_REPERTOIRE_OFFSET])}
        # The repertoire block is sparse: most squares are never visited.
        repertoire = {name: round(w, 5) for name, w in zip(names[_REPERTOIRE_OFFSET:],
                                                           self.weights[_REPERTOIRE_OFFSET:])
                      if abs(w) >= 5e-6}
        payload = {
            "format": 2,
            "phases": list(PHASES),
            "phase_features": PHASE_FEATURES,
            "global_features": GLOBAL_FEATURES,
            "weights": dense,
            "repertoire": repertoire,
            "metadata": self.metadata,
        }
        path.write_text(json.dumps(payload, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "StyleModel":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if (payload.get("format") != 2
                or payload.get("phase_features") != PHASE_FEATURES
                or payload.get("global_features") != GLOBAL_FEATURES):
            raise ValueError("Model file feature set does not match this code version")
        index = {name: i for i, name in enumerate(feature_names())}
        weights = [0.0] * N_FEATURES
        for block in ("weights", "repertoire"):
            for name, value in payload.get(block, {}).items():
                weights[index[name]] = float(value)
        return cls(weights, payload.get("metadata"))

    @classmethod
    def load_or_none(cls, path: Path = MODEL_PATH) -> Optional["StyleModel"]:
        try:
            return cls.load(path)
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            return None
