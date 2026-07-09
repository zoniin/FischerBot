"""Alpha-beta search engine (negamax formulation).

Negamax keeps every node's score in "side to move" perspective, which
removes the min/max sign juggling that broke the original engine. Search
features: iterative deepening with a hard time budget, a transposition
table with exact/lower/upper bound flags, MVV-LVA + killer + history move
ordering, quiescence search with delta pruning, check extensions, and
null-move pruning.
"""

import time
from dataclasses import dataclass, field
from typing import Optional

import chess

from .evaluation import evaluate, MATE_SCORE

INF = 1_000_000
MATE_BOUND = MATE_SCORE - 1_000  # scores beyond this are mate scores
MAX_PLY = 64
_TIME_CHECK_MASK = 1023

# Transposition table entry flags
EXACT, LOWER, UPPER = 0, 1, 2

_MVV_VALUE = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20_000,
}


class SearchTimeout(Exception):
    """Raised inside the tree when the time budget is exhausted."""


@dataclass
class SearchResult:
    move: Optional[chess.Move]
    score_cp: int  # from the side to move's perspective
    depth: int
    nodes: int
    time_ms: int
    pv: list = field(default_factory=list)
    root_scores: dict = field(default_factory=dict)  # uci -> exact-or-bound score


class Engine:
    """Reusable engine; the transposition table persists across searches."""

    def __init__(self, tt_max_entries: int = 400_000):
        self.tt = {}
        self.tt_max_entries = tt_max_entries
        self.nodes = 0
        self._deadline = float("inf")
        self._killers = [[None, None] for _ in range(MAX_PLY + 8)]
        self._history = {}

    # ------------------------------------------------------------------ API

    def search(
        self,
        board: chess.Board,
        time_budget_ms: int = 3000,
        max_depth: int = MAX_PLY,
    ) -> SearchResult:
        """Iterative-deepening search. Always returns a legal move if one exists."""
        start = time.perf_counter()
        self._deadline = start + time_budget_ms / 1000.0
        self.nodes = 0
        self._history.clear()
        if len(self.tt) > self.tt_max_entries:
            self.tt.clear()

        legal = list(board.legal_moves)
        if not legal:
            return SearchResult(None, evaluate_relative(board), 0, 0, 0)

        best_move = legal[0]
        best_score = -INF
        completed_depth = 0
        root_scores: dict = {}

        for depth in range(1, max_depth + 1):
            try:
                score, move, scores = self._search_root(board, depth, best_move)
            except SearchTimeout:
                break
            best_move, best_score = move, score
            completed_depth = depth
            root_scores = scores
            if abs(score) >= MATE_BOUND:
                break  # mate found; deeper search cannot improve it
            if time.perf_counter() - start > (time_budget_ms / 1000.0) * 0.55:
                break  # next iteration would likely blow the budget

        elapsed_ms = int((time.perf_counter() - start) * 1000)
        return SearchResult(
            move=best_move,
            score_cp=best_score,
            depth=completed_depth,
            nodes=self.nodes,
            time_ms=elapsed_ms,
            pv=self._extract_pv(board, best_move),
            root_scores=root_scores,
        )

    def verify_at_least(
        self,
        board: chess.Board,
        move: chess.Move,
        threshold_cp: int,
        depth: int,
        node_budget: int = 200_000,
    ) -> bool:
        """Cheap null-window probe: does `move` score >= threshold_cp?

        Used by the style layer to confirm that a Fischer-like move does not
        give away more than the allowed margin versus the engine's best move.
        """
        self._deadline = time.perf_counter() + 10.0
        start_nodes = self.nodes
        depth = max(1, depth)
        board.push(move)
        try:
            score = -self._negamax(board, depth - 1, -threshold_cp, -(threshold_cp - 1), 1)
        except SearchTimeout:
            return False
        finally:
            board.pop()
            if self.nodes - start_nodes > node_budget:
                pass  # informational only; probes are depth-limited anyway
        return score >= threshold_cp

    # ----------------------------------------------------------- internals

    def _search_root(self, board: chess.Board, depth: int, prev_best: chess.Move):
        alpha, beta = -INF, INF
        best_score = -INF
        best_move = prev_best
        scores: dict = {}

        moves = self._ordered_moves(board, 0, tt_move=prev_best)
        for move in moves:
            board.push(move)
            try:
                score = -self._negamax(board, depth - 1, -beta, -alpha, 1)
            finally:
                board.pop()
            scores[move.uci()] = score
            if score > best_score:
                best_score = score
                best_move = move
            if score > alpha:
                alpha = score
        self._tt_store(board, depth, best_score, EXACT, best_move)
        return best_score, best_move, scores

    def _negamax(self, board: chess.Board, depth: int, alpha: int, beta: int, ply: int) -> int:
        self.nodes += 1
        if (self.nodes & _TIME_CHECK_MASK) == 0 and time.perf_counter() > self._deadline:
            raise SearchTimeout()

        if board.halfmove_clock >= 100:
            return 0
        if board.halfmove_clock >= 4 and board.is_repetition(2):
            return 0

        in_check = board.is_check()
        if in_check:
            depth += 1  # check extension

        if depth <= 0 or ply >= MAX_PLY:
            return self._quiescence(board, alpha, beta, ply)

        key = board._transposition_key()
        tt_move = None
        entry = self.tt.get(key)
        if entry is not None:
            e_depth, e_flag, e_score, tt_move = entry
            if e_depth >= depth and abs(e_score) < MATE_BOUND:
                if e_flag == EXACT:
                    return e_score
                if e_flag == LOWER and e_score >= beta:
                    return e_score
                if e_flag == UPPER and e_score <= alpha:
                    return e_score

        # Null-move pruning: skip a turn; if we still beat beta, prune.
        # Guarded against low depth, check, and pawn-only endings (zugzwang).
        if depth >= 3 and not in_check and beta < MATE_BOUND and self._has_pieces(board):
            board.push(chess.Move.null())
            try:
                null_score = -self._negamax(board, depth - 3, -beta, -beta + 1, ply + 1)
            finally:
                board.pop()
            if null_score >= beta:
                return beta

        moves = self._ordered_moves(board, ply, tt_move)
        if not moves:
            if in_check:
                return -(MATE_SCORE - ply)  # checkmated: prefer later mates
            return 0  # stalemate

        orig_alpha = alpha
        best_score = -INF
        best_move = None

        for move in moves:
            is_quiet = not board.is_capture(move) and move.promotion is None
            board.push(move)
            try:
                score = -self._negamax(board, depth - 1, -beta, -alpha, ply + 1)
            finally:
                board.pop()

            if score > best_score:
                best_score = score
                best_move = move
            if score > alpha:
                alpha = score
            if alpha >= beta:
                if is_quiet:
                    self._store_killer(ply, move)
                    h_key = (board.turn, move.from_square, move.to_square)
                    self._history[h_key] = self._history.get(h_key, 0) + depth * depth
                break

        if best_score <= orig_alpha:
            flag = UPPER
        elif best_score >= beta:
            flag = LOWER
        else:
            flag = EXACT
        if abs(best_score) < MATE_BOUND:
            self._tt_store_key(key, depth, best_score, flag, best_move)
        return best_score

    def _quiescence(self, board: chess.Board, alpha: int, beta: int, ply: int) -> int:
        self.nodes += 1
        if (self.nodes & _TIME_CHECK_MASK) == 0 and time.perf_counter() > self._deadline:
            raise SearchTimeout()

        stand_pat = evaluate_relative(board)
        if ply >= MAX_PLY + 6:
            return stand_pat
        if stand_pat >= beta:
            return beta
        if stand_pat > alpha:
            alpha = stand_pat

        captures = []
        for move in board.legal_moves:
            if board.is_capture(move) or move.promotion:
                captures.append((self._capture_score(board, move), move))
        captures.sort(key=lambda t: t[0], reverse=True)

        for gain_estimate, move in captures:
            # Delta pruning: even winning this capture cannot lift alpha.
            if stand_pat + gain_estimate + 200 < alpha and move.promotion is None:
                continue
            board.push(move)
            try:
                score = -self._quiescence(board, -beta, -alpha, ply + 1)
            finally:
                board.pop()
            if score >= beta:
                return beta
            if score > alpha:
                alpha = score
        return alpha

    # ------------------------------------------------------- move ordering

    def _ordered_moves(self, board: chess.Board, ply: int, tt_move) -> list:
        killers = self._killers[ply] if ply < len(self._killers) else (None, None)
        scored = []
        for move in board.legal_moves:
            if move == tt_move:
                score = 10_000_000
            elif board.is_capture(move):
                score = 1_000_000 + self._capture_score(board, move)
            elif move.promotion:
                score = 900_000 + _MVV_VALUE.get(move.promotion, 0)
            elif move == killers[0]:
                score = 800_000
            elif move == killers[1]:
                score = 799_999
            elif board.is_castling(move):
                score = 700_000
            else:
                score = self._history.get((board.turn, move.from_square, move.to_square), 0)
            scored.append((score, move))
        scored.sort(key=lambda t: t[0], reverse=True)
        return [m for _, m in scored]

    def _capture_score(self, board: chess.Board, move: chess.Move) -> int:
        victim = board.piece_type_at(move.to_square)
        if victim is None:
            victim = chess.PAWN  # en passant
        attacker = board.piece_type_at(move.from_square) or chess.PAWN
        score = _MVV_VALUE[victim] * 10 - _MVV_VALUE[attacker] // 10
        if move.promotion:
            score += _MVV_VALUE.get(move.promotion, 0)
        return score

    def _store_killer(self, ply: int, move: chess.Move):
        if ply >= len(self._killers):
            return
        slot = self._killers[ply]
        if slot[0] != move:
            slot[1] = slot[0]
            slot[0] = move

    @staticmethod
    def _has_pieces(board: chess.Board) -> bool:
        """True if the side to move has at least one non-pawn, non-king piece."""
        us = board.occupied_co[board.turn]
        return bool(us & (board.knights | board.bishops | board.rooks | board.queens))

    # ------------------------------------------------------------------- TT

    def _tt_store(self, board: chess.Board, depth, score, flag, move):
        self._tt_store_key(board._transposition_key(), depth, score, flag, move)

    def _tt_store_key(self, key, depth, score, flag, move):
        entry = self.tt.get(key)
        if entry is None or entry[0] <= depth:
            self.tt[key] = (depth, flag, score, move)

    def _extract_pv(self, board: chess.Board, first_move) -> list:
        if first_move is None:
            return []
        pv = [first_move.uci()]
        temp = board.copy(stack=False)
        temp.push(first_move)
        for _ in range(11):
            entry = self.tt.get(temp._transposition_key())
            if entry is None or entry[3] is None:
                break
            move = entry[3]
            if move not in temp.legal_moves:
                break
            pv.append(move.uci())
            temp.push(move)
        return pv


def evaluate_relative(board: chess.Board) -> int:
    """Static eval from the side to move's perspective (negamax convention)."""
    score = evaluate(board)
    return score if board.turn else -score
