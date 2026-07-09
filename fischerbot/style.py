"""Fischer style model: a conditional-logit move ranker.

P(move | position) ∝ exp(w · f(position, move)) over the legal moves.
Trained on the positions where Fischer was to move in the real corpus,
with proper gradients (see train_style.py) and game-level held-out
validation. Weights are stored as JSON — human-readable, no pickle.

The model captures move-choice *style priors* (development, castling,
captures toward the initiative, rook activity...). It is used to pick
between near-equal moves at the root — never to override tactics.
"""

import json
import math
from pathlib import Path
from typing import List, Optional

import chess

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "style.json"

PHASES = ("opening", "middlegame", "endgame")

BASE_FEATURES = [
    "bias",
    "is_capture",
    "captured_value",
    "gives_check",
    "is_promotion",
    "castle_kingside",
    "castle_queenside",
    "piece_pawn",
    "piece_knight",
    "piece_bishop",
    "piece_rook",
    "piece_queen",
    "piece_king",
    "to_centrality",
    "forwardness",
    "develops_minor",
    "early_queen",
    "rook_to_open_file",
    "center_pawn_push",
    "flank_pawn_push",
    "to_attacked_by_pawn",
    "to_defended",
    "king_proximity",
    "is_recapture",
    "retreat",
]

N_BASE = len(BASE_FEATURES)
N_FEATURES = N_BASE * len(PHASES)


def game_phase(board: chess.Board) -> int:
    """0=opening, 1=middlegame, 2=endgame."""
    if board.fullmove_number <= 10:
        return 0
    queens = chess.popcount(board.queens)
    heavy = chess.popcount(board.knights | board.bishops | board.rooks)
    if queens == 0 or heavy <= 4:
        return 2
    return 1


def move_features(board: chess.Board, move: chess.Move) -> List[float]:
    """Feature vector for one legal move (phase-interacted)."""
    base = [0.0] * N_BASE
    base[0] = 1.0

    piece_type = board.piece_type_at(move.from_square) or chess.PAWN
    color = board.turn

    if board.is_capture(move):
        base[1] = 1.0
        victim = board.piece_type_at(move.to_square) or chess.PAWN
        base[2] = {
            chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
            chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0,
        }[victim] / 9.0

    if board.gives_check(move):
        base[3] = 1.0
    if move.promotion:
        base[4] = 1.0
    if board.is_kingside_castling(move):
        base[5] = 1.0
    if board.is_queenside_castling(move):
        base[6] = 1.0

    base[6 + piece_type] = 1.0  # indices 7..12 for P..K

    tf, tr = chess.square_file(move.to_square), chess.square_rank(move.to_square)
    ff, fr = chess.square_file(move.from_square), chess.square_rank(move.from_square)
    base[13] = (3.5 - abs(tf - 3.5)) / 3.5 * (3.5 - abs(tr - 3.5)) / 3.5

    direction = 1 if color == chess.WHITE else -1
    base[14] = (tr - fr) * direction / 7.0

    home_rank = 0 if color == chess.WHITE else 7
    if piece_type in (chess.KNIGHT, chess.BISHOP) and fr == home_rank and tr != home_rank:
        base[15] = 1.0
    if piece_type == chess.QUEEN and board.fullmove_number < 10:
        base[16] = 1.0
    if piece_type == chess.ROOK:
        file_bb = chess.BB_FILES[tf]
        own_pawns = board.pawns & board.occupied_co[color]
        if not (own_pawns & file_bb):
            base[17] = 1.0
    if piece_type == chess.PAWN:
        if tf in (3, 4):
            base[18] = 1.0
        elif tf in (0, 1, 6, 7):
            base[19] = 1.0

    enemy_pawns = board.pawns & board.occupied_co[not color]
    pawn_attackers = board.attackers_mask(not color, move.to_square) & enemy_pawns
    if pawn_attackers and piece_type != chess.PAWN:
        base[20] = 1.0
    if board.attackers_mask(color, move.to_square) & ~chess.BB_SQUARES[move.from_square]:
        base[21] = 1.0

    enemy_king = board.king(not color)
    if enemy_king is not None:
        dist = chess.square_distance(move.to_square, enemy_king)
        base[22] = (7 - dist) / 7.0

    if board.move_stack and board.move_stack[-1].to_square == move.to_square:
        base[23] = 1.0
    if (tr - fr) * direction < 0 and piece_type != chess.PAWN:
        base[24] = 1.0

    phase = game_phase(board)
    full = [0.0] * N_FEATURES
    offset = phase * N_BASE
    full[offset:offset + N_BASE] = base
    return full


class StyleModel:
    """Linear conditional-logit scorer over move features."""

    def __init__(self, weights: Optional[List[float]] = None):
        self.weights = list(weights) if weights is not None else [0.0] * N_FEATURES
        if len(self.weights) != N_FEATURES:
            raise ValueError(
                f"Weight vector has {len(self.weights)} entries, expected {N_FEATURES}"
            )

    def logit(self, board: chess.Board, move: chess.Move) -> float:
        feats = move_features(board, move)
        w = self.weights
        return sum(w[i] * f for i, f in enumerate(feats) if f)

    def rank_moves(self, board: chess.Board) -> List[tuple]:
        """(move, probability) for every legal move, most Fischer-like first."""
        moves = list(board.legal_moves)
        if not moves:
            return []
        logits = [self.logit(board, m) for m in moves]
        peak = max(logits)
        exps = [math.exp(l - peak) for l in logits]
        total = sum(exps)
        ranked = [(m, e / total) for m, e in zip(moves, exps)]
        ranked.sort(key=lambda t: t[1], reverse=True)
        return ranked

    def save(self, path: Path = MODEL_PATH, metadata: Optional[dict] = None):
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "features": BASE_FEATURES,
            "phases": list(PHASES),
            "weights": self.weights,
            "metadata": metadata or {},
        }
        path.write_text(json.dumps(payload, indent=1), encoding="utf-8")

    @classmethod
    def load(cls, path: Path = MODEL_PATH) -> "StyleModel":
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if payload.get("features") != BASE_FEATURES:
            raise ValueError("Model file feature set does not match this code version")
        return cls(payload["weights"])

    @classmethod
    def load_or_none(cls, path: Path = MODEL_PATH) -> Optional["StyleModel"]:
        try:
            return cls.load(path)
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            return None
