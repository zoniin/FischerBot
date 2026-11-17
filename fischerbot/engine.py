"""Alpha-beta search engine.

A principal-variation search (negamax) with iterative deepening inside a hard
time budget. python-chess supplies the rules; everything here is about
looking at fewer positions and looking at them in the right order:

* transposition table (two generations) with exact / lower / upper bounds
* null-move pruning, reverse futility pruning, futility and late-move pruning
* late-move reductions with re-search
* move ordering: hash move, winning captures (MVV-LVA + static exchange
  evaluation), killer moves, history heuristic, losing captures last
* quiescence search over captures and queen promotions, with check evasions
* repetition and fifty-move draw detection along the search path

Scores are centipawns from the side to move's point of view.
"""

import math
import time
from dataclasses import dataclass, field
from typing import List, Optional

import chess

from .evaluation import MATE_SCORE, PIECE_VALUE, evaluate

INF = 1_000_000
MATE_BOUND = MATE_SCORE - 1_000  # scores beyond this are forced mates
MAX_PLY = 96
_TIME_CHECK_MASK = 511

# Transposition table entry flags
EXACT, LOWER, UPPER = 0, 1, 2

# Move-ordering bands (history scores live between the killers and bad captures)
_GOOD_CAPTURE = 1_000_000
_QUEEN_PROMOTION = 900_000
_KILLER_1 = 30_000
_KILLER_2 = 29_999
_HISTORY_MAX = 16_384
_BAD_CAPTURE = -100_000
_UNDER_PROMOTION = -200_000

# Pruning margins (centipawns)
_RFP_MARGIN = 85          # reverse futility, per ply of depth
_FUTILITY_MARGIN = (0, 150, 280, 420)
_LMP_LIMIT = (0, 6, 10, 16)   # quiet moves tried before the rest are skipped
_DELTA_MARGIN = 180       # quiescence: a capture must get within this of alpha

# Start another iteration only while less than this share of the budget is
# used. A deeper iteration that is cut short still counts if it has already
# found a better move, so it pays to start one with well under half the time left.
_NEXT_ITERATION_LIMIT = 0.6

_BB_SQUARES = chess.BB_SQUARES
_KNIGHT_ATTACKS = chess.BB_KNIGHT_ATTACKS
_KING_ATTACKS = chess.BB_KING_ATTACKS
_PAWN_ATTACKS = chess.BB_PAWN_ATTACKS
_DIAG_MASKS, _DIAG_ATTACKS = chess.BB_DIAG_MASKS, chess.BB_DIAG_ATTACKS
_FILE_MASKS, _FILE_ATTACKS = chess.BB_FILE_MASKS, chess.BB_FILE_ATTACKS
_RANK_MASKS, _RANK_ATTACKS = chess.BB_RANK_MASKS, chess.BB_RANK_ATTACKS
_PROMOTION_RANK = (chess.BB_RANK_2, chess.BB_RANK_7)  # where a pawn promotes from, by colour
_NULL_MOVE = chess.Move.null()
_QUEEN = chess.QUEEN

# Late-move reduction table: how many plies to trim from the Nth quiet move.
_LMR = [[0] * 64 for _ in range(64)]
for _d in range(1, 64):
    for _n in range(1, 64):
        _LMR[_d][_n] = int(0.6 + math.log(_d) * math.log(_n) / 2.2)


class SearchTimeout(Exception):
    """Raised inside the tree when the time budget is exhausted."""


@dataclass
class SearchResult:
    move: Optional[chess.Move]
    score_cp: int  # from the side to move's perspective
    depth: int
    nodes: int
    time_ms: int
    pv: List[str] = field(default_factory=list)
    root_scores: dict = field(default_factory=dict)  # uci -> score of every root move that was resolved exactly


def position_key(board: chess.Board) -> int:
    """Exact (collision-free) identity of a position, packed into one integer."""
    ep = board.ep_square
    if ep is None or not board.has_legal_en_passant():
        ep = 64
    return (board.occupied_co[True]
            | board.pawns << 64
            | board.knights << 128
            | board.bishops << 192
            | board.rooks << 256
            | board.queens << 320
            | board.kings << 384
            | board.clean_castling_rights() << 448
            | ep << 512
            | board.turn << 520)


def _piece_type_at(board: chess.Board, mask: int) -> int:
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


def static_exchange(board: chess.Board, move: chess.Move) -> int:
    """Material won (or lost) by `move` once every recapture on its square is played out."""
    to_sq = move.to_square
    to_bb = _BB_SQUARES[to_sq]
    from_bb = _BB_SQUARES[move.from_square]
    pawns, knights, bishops = board.pawns, board.knights, board.bishops
    rooks, queens, kings = board.rooks, board.queens, board.kings
    occupied = board.occupied

    attacker_value = PIECE_VALUE[_piece_type_at(board, from_bb)]
    if occupied & to_bb:
        gain = [PIECE_VALUE[_piece_type_at(board, to_bb)]]
    elif pawns & from_bb and to_sq == board.ep_square:
        gain = [PIECE_VALUE[1]]
        occupied ^= _BB_SQUARES[to_sq + (-8 if board.turn else 8)]
    else:
        gain = [0]

    occupied ^= from_bb
    diagonal = bishops | queens
    straight = rooks | queens
    side = not board.turn
    colors = board.occupied_co
    while True:
        attackers = (
            (_KING_ATTACKS[to_sq] & kings)
            | (_KNIGHT_ATTACKS[to_sq] & knights)
            | (_RANK_ATTACKS[to_sq][_RANK_MASKS[to_sq] & occupied] & straight)
            | (_FILE_ATTACKS[to_sq][_FILE_MASKS[to_sq] & occupied] & straight)
            | (_DIAG_ATTACKS[to_sq][_DIAG_MASKS[to_sq] & occupied] & diagonal)
            | (_PAWN_ATTACKS[not side][to_sq] & pawns)
        ) & occupied & colors[side]
        if not attackers:
            break
        # Recapture with the least valuable piece.
        if attackers & pawns:
            piece, value = attackers & pawns, PIECE_VALUE[1]
        elif attackers & knights:
            piece, value = attackers & knights, PIECE_VALUE[2]
        elif attackers & bishops:
            piece, value = attackers & bishops, PIECE_VALUE[3]
        elif attackers & rooks:
            piece, value = attackers & rooks, PIECE_VALUE[4]
        elif attackers & queens:
            piece, value = attackers & queens, PIECE_VALUE[5]
        else:
            piece, value = attackers & kings, PIECE_VALUE[6]
        gain.append(attacker_value - gain[-1])
        if value == PIECE_VALUE[6] and len(gain) > 1:
            # A king may only recapture when nothing defends the square.
            occupied_after = occupied ^ (piece & -piece)
            defenders = (
                (_KING_ATTACKS[to_sq] & kings)
                | (_KNIGHT_ATTACKS[to_sq] & knights)
                | (_RANK_ATTACKS[to_sq][_RANK_MASKS[to_sq] & occupied_after] & straight)
                | (_FILE_ATTACKS[to_sq][_FILE_MASKS[to_sq] & occupied_after] & straight)
                | (_DIAG_ATTACKS[to_sq][_DIAG_MASKS[to_sq] & occupied_after] & diagonal)
                | (_PAWN_ATTACKS[side][to_sq] & pawns)
            ) & occupied_after & colors[not side]
            if defenders:
                gain.pop()
                break
        attacker_value = value
        occupied ^= piece & -piece
        side = not side

    for i in range(len(gain) - 1, 0, -1):
        if -gain[i] < gain[i - 1]:
            gain[i - 1] = -gain[i]
    return gain[0]


class Engine:
    """Reusable engine; the transposition table persists across searches.

    `selective=False` switches off every heuristic that can change the result
    (pruning, reductions, hash cutoffs), leaving a plain full-width search that
    the test suite checks move-for-move against a textbook minimax.
    """

    def __init__(self, tt_max_entries: int = 120_000, selective: bool = True):
        self.selective = selective
        self.tt = {}
        self.tt_old = {}
        self.tt_max_entries = tt_max_entries
        self.nodes = 0
        self._deadline = float("inf")
        self._node_limit = float("inf")
        self._killers = [[None, None] for _ in range(MAX_PLY + 4)]
        self._history = ([0] * 4096, [0] * 4096)  # [colour][from << 6 | to]
        self._repetition = set()
        self._root_progress = None

    # ------------------------------------------------------------------ API

    def search(
        self,
        board: chess.Board,
        time_budget_ms: int = 3000,
        max_depth: int = MAX_PLY,
        node_limit: Optional[int] = None,
    ) -> SearchResult:
        """Iterative-deepening search. Always returns a legal move if one exists.

        The search stops at `max_depth`, when the time budget runs out, or -
        for reproducible analysis - after `node_limit` positions.
        """
        start = time.perf_counter()
        budget = time_budget_ms / 1000.0
        deadline = start + budget
        node_cap = node_limit if node_limit is not None else float("inf")
        self.nodes = 0
        self._age_tables()

        root_moves = self._root_order(board)
        if not root_moves:
            return SearchResult(None, evaluate_relative(board), 0, 0, 0)

        root_len = len(board.move_stack)
        self._seed_repetition(board)
        best_move = root_moves[0]
        best_score = -INF
        completed_depth = 0
        root_scores: dict = {}
        max_depth = max(1, min(max_depth, MAX_PLY - 1))

        for depth in range(1, max_depth + 1):
            self._root_progress = None
            # The first iteration always completes, so there is always a move and a score.
            self._deadline = deadline if depth > 1 else float("inf")
            self._node_limit = node_cap if depth > 1 else float("inf")
            try:
                score, move, scores = self._search_root(board, depth, root_moves, -INF, INF)
            except SearchTimeout:
                while len(board.move_stack) > root_len:
                    board.pop()
                # The previous best move is searched first, so a move that has
                # already beaten it at this depth is a genuine improvement.
                if self._root_progress is not None and completed_depth:
                    best_move, best_score = self._root_progress
                break
            best_move, best_score = move, score
            completed_depth = depth
            root_scores = scores
            root_moves.remove(move)
            root_moves.insert(0, move)

            if score >= MATE_BOUND and MATE_SCORE - score <= depth:
                break  # forced mate found
            if score <= -MATE_BOUND and MATE_SCORE + score <= depth:
                break  # being mated whatever we do
            if len(root_moves) == 1 and depth >= 2:
                break  # forced move: nothing to choose
            if time.perf_counter() - start > budget * _NEXT_ITERATION_LIMIT:
                break  # too little time left for the next iteration to tell us anything

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

    def score_move(
        self,
        board: chess.Board,
        move: chess.Move,
        lower: int,
        upper: int,
        depth: int,
        deadline: Optional[float] = None,
    ) -> Optional[int]:
        """Score one root move at the given depth, resolved exactly inside (lower, upper).

        A result <= lower or >= upper only says the true score lies beyond that
        bound, which is what makes the probe cheap: a move that is clearly too
        weak is refuted almost at once. Returns None if time runs out.
        """
        self._deadline = deadline if deadline is not None else time.perf_counter() + 2.0
        self._node_limit = float("inf")
        if time.perf_counter() >= self._deadline:
            return None
        root_len = len(board.move_stack)
        self._seed_repetition(board)
        self._repetition.add(position_key(board))
        depth = max(1, depth)
        board.push(move)
        try:
            return -self._negamax(board, depth - 1, -upper, -lower, 1, board.is_check(), True)
        except SearchTimeout:
            return None
        finally:
            while len(board.move_stack) > root_len:
                board.pop()

    def verify_at_least(
        self,
        board: chess.Board,
        move: chess.Move,
        threshold_cp: int,
        depth: int,
        deadline: Optional[float] = None,
    ) -> bool:
        """Does `move` score at least `threshold_cp` at the given depth?

        A null-window probe. Running out of time counts as "no".
        """
        score = self.score_move(board, move, threshold_cp - 1, threshold_cp, depth, deadline)
        return score is not None and score >= threshold_cp

    def candidates(
        self,
        board: chess.Board,
        result: SearchResult,
        window_cp: int,
        node_limit: Optional[int] = None,
    ) -> dict:
        """Every root move within `window_cp` of the best, with its exact score.

        Returns {uci: score} at the depth `result` reached. This is the
        engine's view of which moves are playable - the set the style model is
        trained to choose from. Far dearer than `verify_at_least`, so it is
        used for analysis and training rather than during play.
        """
        if result.move is None:
            return {}
        best, depth = result.score_cp, max(1, result.depth)
        scores = {result.move.uci(): best}
        if abs(best) >= MATE_BOUND:
            return scores
        floor = best - window_cp
        self._deadline = float("inf")
        self._node_limit = self.nodes + node_limit if node_limit is not None else float("inf")
        root_len = len(board.move_stack)
        self._seed_repetition(board)
        self._repetition.add(position_key(board))
        try:
            for _, _, move, _ in self._ordered_moves(board, 0, result.move):
                board.push(move)
                gives_check = board.is_check()
                score = -self._negamax(board, depth - 1, -floor, -floor + 1, 1, gives_check, True)
                if score >= floor:
                    score = -self._negamax(board, depth - 1, -best - 1, -floor + 1, 1, gives_check, True)
                    if score >= floor:
                        scores[move.uci()] = score
                board.pop()
        except SearchTimeout:
            pass
        finally:
            while len(board.move_stack) > root_len:
                board.pop()
        return scores

    # ----------------------------------------------------------- bookkeeping

    def _age_tables(self):
        if len(self.tt) > self.tt_max_entries:
            self.tt_old = self.tt
            self.tt = {}
        for table in self._history:
            for i, value in enumerate(table):
                if value:
                    table[i] = value // 4
        for slot in self._killers:
            slot[0] = slot[1] = None

    def _seed_repetition(self, board: chess.Board):
        """Positions already seen in the game: reaching one again is a draw."""
        seen = set()
        if board.halfmove_clock and board.move_stack:
            replay = board.copy()
            for _ in range(min(board.halfmove_clock, len(replay.move_stack))):
                replay.pop()
                seen.add(position_key(replay))
        self._repetition = seen

    def _root_order(self, board: chess.Board) -> list:
        entry = self.tt.get(position_key(board))
        tt_move = entry[3] if entry is not None else None
        ordered = [move for _, _, move, _ in self._ordered_moves(board, 0, tt_move)]
        if tt_move is not None and board.is_legal(tt_move):
            ordered.insert(0, tt_move)
        return ordered

    # --------------------------------------------------------------- search

    def _search_root(self, board: chess.Board, depth: int, root_moves: list,
                     alpha: int, beta: int):
        original_alpha = alpha
        best_score = -INF
        best_move = root_moves[0]
        scores: dict = {}
        key = position_key(board)
        self._repetition.add(key)

        for index, move in enumerate(root_moves):
            board.push(move)
            gives_check = board.is_check()
            if index == 0:
                score = -self._negamax(board, depth - 1, -beta, -alpha, 1, gives_check, True)
            else:
                score = -self._negamax(board, depth - 1, -alpha - 1, -alpha, 1, gives_check, True)
                if alpha < score < beta:
                    score = -self._negamax(board, depth - 1, -beta, -alpha, 1, gives_check, True)
            board.pop()
            if alpha < score < beta:
                scores[move.uci()] = score
            if score > best_score:
                best_score = score
                best_move = move
                if score > alpha:
                    # Better than everything searched before it at this depth.
                    self._root_progress = (move, score)
            if score > alpha:
                alpha = score
                if alpha >= beta:
                    break

        if original_alpha < best_score < beta:
            self.tt[key] = (depth, EXACT, best_score, best_move)
        return best_score, best_move, scores

    def _negamax(self, board: chess.Board, depth: int, alpha: int, beta: int,
                 ply: int, in_check: bool, allow_null: bool) -> int:
        if in_check:
            depth += 1  # never stop searching while in check
        if depth <= 0:
            return self._quiesce(board, alpha, beta, ply)

        nodes = self.nodes = self.nodes + 1
        if not nodes & _TIME_CHECK_MASK and (time.perf_counter() > self._deadline
                                             or nodes > self._node_limit):
            raise SearchTimeout()
        if ply >= MAX_PLY:
            return evaluate_relative(board)

        if board.halfmove_clock >= 100:
            return 0
        key = position_key(board)
        repetition = self._repetition
        if key in repetition:
            return 0

        # Mate-distance pruning: no line from here can beat a mate already found.
        if alpha < ply - MATE_SCORE:
            alpha = ply - MATE_SCORE
        if beta > MATE_SCORE - ply - 1:
            beta = MATE_SCORE - ply - 1
        if alpha >= beta:
            return alpha

        is_pv = beta - alpha > 1
        selective = self.selective

        tt_move = None
        entry = self.tt.get(key)
        if entry is None:
            entry = self.tt_old.get(key)
        if entry is not None:
            e_depth, e_flag, e_score, tt_move = entry
            if e_depth >= depth and not is_pv and selective:
                if e_score >= MATE_BOUND:
                    e_score -= ply
                elif e_score <= -MATE_BOUND:
                    e_score += ply
                if (e_flag == EXACT
                        or (e_flag == LOWER and e_score >= beta)
                        or (e_flag == UPPER and e_score <= alpha)):
                    return e_score

        turn = board.turn
        static = -INF
        prune = False
        if not in_check:
            static = evaluate(board)
            if not turn:
                static = -static
            if not is_pv and selective:
                prune = True
                # Reverse futility: already so far above beta that a quiet
                # reply will not bring the score back down.
                if depth <= 4 and static - _RFP_MARGIN * depth >= beta and static < MATE_BOUND:
                    return static
                # Null move: hand the opponent a free move; if we still beat
                # beta the position is good enough to stop looking.
                if (allow_null and depth >= 2 and static >= beta
                        and board.occupied_co[turn] & (board.knights | board.bishops
                                                       | board.rooks | board.queens)):
                    reduction = 3 + depth // 4
                    board.push(_NULL_MOVE)
                    score = -self._negamax(board, depth - 1 - reduction, -beta, -beta + 1,
                                           ply + 1, False, False)
                    board.pop()
                    if score >= beta:
                        return beta if score >= MATE_BOUND else score

        if tt_move is None and depth >= 4 and selective:
            depth -= 1  # no hash move: this node is probably not important

        futile = prune and depth <= 3 and static + _FUTILITY_MARGIN[depth] <= alpha
        lmp_limit = _LMP_LIMIT[depth] if prune and depth <= 3 else 1_000
        check_squares = None

        repetition.add(key)
        original_alpha = alpha
        best_score = -INF
        best_move = None
        searched = 0
        quiets_tried = []
        killers = self._killers[ply]
        history = self._history[turn]
        lmr_row = _LMR[depth if depth < 64 else 63]

        # Moves are generated in stages so that a cutoff by the hash move or a
        # capture never pays for generating and sorting the quiet moves:
        #   1 hash move, 2 winning/equal captures and queen promotions,
        #   3 quiet moves, 4 losing captures and under-promotions.
        stage = 0
        moves = ()
        index = 0
        losing = ()
        while True:
            if index >= len(moves):
                stage += 1
                index = 0
                if stage == 1:
                    if tt_move is None:
                        moves = ()
                    else:
                        quiet = not (board.occupied_co[not turn] & _BB_SQUARES[tt_move.to_square]
                                     or tt_move.promotion
                                     or (tt_move.to_square == board.ep_square
                                         and board.pawns & _BB_SQUARES[tt_move.from_square]))
                        moves = ((_GOOD_CAPTURE, 0, tt_move, quiet),)
                elif stage == 2:
                    moves, losing = self._noisy_moves(board, tt_move)
                elif stage == 3:
                    moves = self._quiet_moves(board, ply, tt_move)
                elif stage == 4:
                    # Material-losing captures are not worth a look once the
                    # position is already hopeless at this depth.
                    moves = () if futile and searched and best_score > -MATE_BOUND else losing
                else:
                    break
                continue
            order_score, _, move, quiet = moves[index]
            index += 1

            # Shallow pruning of quiet moves that cannot plausibly matter.
            if quiet and searched and (futile or searched >= lmp_limit) and best_score > -MATE_BOUND:
                if check_squares is None:
                    check_squares = _check_squares(board)
                if not _may_give_check(board, move, check_squares):
                    continue

            board.push(move)
            gives_check = board.is_check()
            new_depth = depth - 1

            if searched == 0:
                score = -self._negamax(board, new_depth, -beta, -alpha, ply + 1, gives_check, True)
            else:
                reduction = 0
                if (quiet and depth >= 3 and searched >= 3 and not in_check
                        and not gives_check and selective):
                    reduction = lmr_row[searched if searched < 64 else 63]
                    if is_pv:
                        reduction -= 1
                    if order_score >= _KILLER_2:
                        reduction -= 1
                    if reduction > new_depth - 1:
                        reduction = new_depth - 1
                    if reduction < 0:
                        reduction = 0
                score = -self._negamax(board, new_depth - reduction, -alpha - 1, -alpha,
                                       ply + 1, gives_check, True)
                if reduction and score > alpha:
                    score = -self._negamax(board, new_depth, -alpha - 1, -alpha,
                                           ply + 1, gives_check, True)
                if is_pv and alpha < score < beta:
                    score = -self._negamax(board, new_depth, -beta, -alpha,
                                           ply + 1, gives_check, True)
            board.pop()
            searched += 1

            if score > best_score:
                best_score = score
                best_move = move
                if score > alpha:
                    alpha = score
                    if alpha >= beta:
                        if quiet:
                            self._reward_quiet(move, killers, history, depth, quiets_tried)
                        break
            if quiet:
                quiets_tried.append(move)

        repetition.discard(key)

        if searched == 0:
            # The first move is never pruned, so nothing searched means no legal moves.
            return ply - MATE_SCORE if in_check else 0

        if best_score <= original_alpha:
            flag = UPPER
            best_move = tt_move  # a fail-low says nothing about which move is best
        elif best_score >= beta:
            flag = LOWER
        else:
            flag = EXACT
        stored = best_score
        if stored >= MATE_BOUND:
            stored += ply
        elif stored <= -MATE_BOUND:
            stored -= ply
        self.tt[key] = (depth, flag, stored, best_move)
        return best_score

    def _quiesce(self, board: chess.Board, alpha: int, beta: int, ply: int) -> int:
        """Search captures until the position is quiet enough to evaluate."""
        nodes = self.nodes = self.nodes + 1
        if not nodes & _TIME_CHECK_MASK and (time.perf_counter() > self._deadline
                                             or nodes > self._node_limit):
            raise SearchTimeout()

        turn = board.turn
        selective = self.selective
        stand_pat = evaluate(board)
        if not turn:
            stand_pat = -stand_pat
        if stand_pat >= beta or ply >= MAX_PLY:
            return stand_pat
        if stand_pat > alpha:
            alpha = stand_pat
        best_score = stand_pat

        them = board.occupied_co[not turn]
        pushers = board.pawns & board.occupied_co[turn] & _PROMOTION_RANK[turn]
        targets = them
        if selective and not pushers:
            # Delta pruning, applied before generating anything: a capture is
            # only interesting if the piece it wins lifts the score to alpha.
            need = alpha - stand_pat - _DELTA_MARGIN
            if need >= PIECE_VALUE[1]:
                targets &= ~board.pawns
                if need >= PIECE_VALUE[2]:
                    targets &= ~board.knights
                    if need >= PIECE_VALUE[3]:
                        targets &= ~board.bishops
                        if need >= PIECE_VALUE[4]:
                            targets &= ~board.rooks
                            if need >= PIECE_VALUE[5]:
                                targets &= ~board.queens
                if not targets:
                    return best_score
            elif board.ep_square is not None:
                targets |= _BB_SQUARES[board.ep_square]
        else:
            targets = chess.BB_ALL

        scored = []
        n = 0
        for move in board.generate_legal_captures(chess.BB_ALL, targets):
            promotion = move.promotion
            if promotion and promotion != _QUEEN:
                continue
            n += 1
            to_bb = _BB_SQUARES[move.to_square]
            victim = PIECE_VALUE[_piece_type_at(board, to_bb)] if them & to_bb else PIECE_VALUE[1]
            attacker = PIECE_VALUE[_piece_type_at(board, _BB_SQUARES[move.from_square])]
            if promotion:
                victim += PIECE_VALUE[5] - PIECE_VALUE[1]
            elif stand_pat + victim + _DELTA_MARGIN <= alpha and selective:
                continue  # even winning this piece cleanly would not reach alpha
            scored.append((victim * 16 - attacker, n, move, victim, attacker))

        if pushers:
            for move in board.generate_legal_moves(pushers, chess.BB_ALL & ~board.occupied):
                if move.promotion == _QUEEN:
                    n += 1
                    scored.append((PIECE_VALUE[5] * 16, n, move, PIECE_VALUE[5], 0))

        scored.sort(reverse=True)
        for _, _, move, victim, attacker in scored:
            if attacker > victim and static_exchange(board, move) < 0:
                continue  # loses material
            board.push(move)
            if board.is_check():
                score = -self._evade(board, -beta, -alpha, ply + 1)
            else:
                score = -self._quiesce(board, -beta, -alpha, ply + 1)
            board.pop()
            if score > best_score:
                best_score = score
                if score > alpha:
                    alpha = score
                    if alpha >= beta:
                        break
        return best_score

    def _evade(self, board: chess.Board, alpha: int, beta: int, ply: int) -> int:
        """Quiescence for a side in check: every legal reply must be tried."""
        nodes = self.nodes = self.nodes + 1
        if not nodes & _TIME_CHECK_MASK and (time.perf_counter() > self._deadline
                                             or nodes > self._node_limit):
            raise SearchTimeout()
        if ply >= MAX_PLY:
            return evaluate_relative(board)

        best_score = ply - MATE_SCORE
        for _, _, move, _ in self._ordered_moves(board, ply, None):
            board.push(move)
            if board.is_check():
                score = -self._evade(board, -beta, -alpha, ply + 1)
            else:
                score = -self._quiesce(board, -beta, -alpha, ply + 1)
            board.pop()
            if score > best_score:
                best_score = score
                if score > alpha:
                    alpha = score
                    if alpha >= beta:
                        break
        return best_score

    # ------------------------------------------------------- move ordering

    def _ordered_moves(self, board: chess.Board, ply: int, tt_move) -> list:
        """Legal moves except `tt_move`, best first, as (score, n, move, is_quiet)."""
        turn = board.turn
        them = board.occupied_co[not turn]
        pawns = board.pawns
        ep_square = board.ep_square
        history = self._history[turn]
        killer_1, killer_2 = self._killers[ply] if ply < len(self._killers) else (None, None)
        # Quiet moves are identified by from << 6 | to (no promotion piece to compare).
        killer_1 = killer_1.from_square << 6 | killer_1.to_square if killer_1 is not None else -1
        killer_2 = killer_2.from_square << 6 | killer_2.to_square if killer_2 is not None else -1
        if tt_move is not None:
            tt_from, tt_to, tt_promotion = tt_move.from_square, tt_move.to_square, tt_move.promotion
        else:
            tt_from = tt_to = tt_promotion = -1
        scored = []
        n = 0
        for move in board.generate_legal_moves():
            to_sq = move.to_square
            promotion = move.promotion
            if to_sq == tt_to and move.from_square == tt_from and promotion == tt_promotion:
                continue
            n -= 1
            to_bb = _BB_SQUARES[to_sq]
            if them & to_bb:
                victim = PIECE_VALUE[_piece_type_at(board, to_bb)]
                attacker = PIECE_VALUE[_piece_type_at(board, _BB_SQUARES[move.from_square])]
                if attacker > victim and not promotion and static_exchange(board, move) < 0:
                    score = _BAD_CAPTURE + victim * 16 - attacker // 16
                else:
                    score = _GOOD_CAPTURE + victim * 16 - attacker // 16
                    if promotion == _QUEEN:
                        score += PIECE_VALUE[5] * 16
                scored.append((score, n, move, False))
            elif promotion:
                scored.append((_QUEEN_PROMOTION if promotion == _QUEEN else _UNDER_PROMOTION,
                               n, move, False))
            elif to_sq == ep_square and pawns & _BB_SQUARES[move.from_square]:
                scored.append((_GOOD_CAPTURE + PIECE_VALUE[1] * 16, n, move, False))
            else:
                index = move.from_square << 6 | to_sq
                if index == killer_1:
                    scored.append((_KILLER_1, n, move, True))
                elif index == killer_2:
                    scored.append((_KILLER_2, n, move, True))
                else:
                    scored.append((history[index], n, move, True))
        scored.sort(reverse=True)
        return scored

    def _noisy_moves(self, board: chess.Board, tt_move):
        """Captures and promotions except `tt_move`: (worth trying first, material-losing)."""
        turn = board.turn
        them = board.occupied_co[not turn]
        if tt_move is not None:
            tt_from, tt_to, tt_promotion = tt_move.from_square, tt_move.to_square, tt_move.promotion
        else:
            tt_from = tt_to = tt_promotion = -1
        good = []
        losing = []
        n = 0
        for move in board.generate_legal_captures():
            to_sq = move.to_square
            promotion = move.promotion
            if to_sq == tt_to and move.from_square == tt_from and promotion == tt_promotion:
                continue
            n -= 1
            to_bb = _BB_SQUARES[to_sq]
            victim = PIECE_VALUE[_piece_type_at(board, to_bb)] if them & to_bb else PIECE_VALUE[1]
            if promotion:
                if promotion == _QUEEN:
                    good.append((_GOOD_CAPTURE + (victim + PIECE_VALUE[5]) * 16, n, move, False))
                else:
                    losing.append((_UNDER_PROMOTION, n, move, False))
                continue
            attacker = PIECE_VALUE[_piece_type_at(board, _BB_SQUARES[move.from_square])]
            if attacker > victim and static_exchange(board, move) < 0:
                losing.append((_BAD_CAPTURE + victim * 16 - attacker // 16, n, move, False))
            else:
                good.append((_GOOD_CAPTURE + victim * 16 - attacker // 16, n, move, False))

        pushers = board.pawns & board.occupied_co[turn] & _PROMOTION_RANK[turn]
        if pushers:
            for move in board.generate_legal_moves(pushers, chess.BB_ALL & ~board.occupied):
                promotion = move.promotion
                if move.to_square == tt_to and move.from_square == tt_from and promotion == tt_promotion:
                    continue
                n -= 1
                if promotion == _QUEEN:
                    good.append((_QUEEN_PROMOTION, n, move, False))
                else:
                    losing.append((_UNDER_PROMOTION, n, move, False))
        good.sort(reverse=True)
        losing.sort(reverse=True)
        return good, losing

    def _quiet_moves(self, board: chess.Board, ply: int, tt_move) -> list:
        """Non-capturing, non-promoting moves except `tt_move`, most promising first."""
        turn = board.turn
        pawns = board.pawns
        ep_square = board.ep_square
        history = self._history[turn]
        killer_1, killer_2 = self._killers[ply] if ply < len(self._killers) else (None, None)
        killer_1 = killer_1.from_square << 6 | killer_1.to_square if killer_1 is not None else -1
        killer_2 = killer_2.from_square << 6 | killer_2.to_square if killer_2 is not None else -1
        skip = tt_move.from_square << 6 | tt_move.to_square if tt_move is not None else -1
        scored = []
        n = 0
        # Every square except enemy pieces: own squares must stay in the mask
        # because python-chess addresses castling by the rook's square.
        for move in board.generate_legal_moves(chess.BB_ALL, chess.BB_ALL & ~board.occupied_co[not turn]):
            if move.promotion:
                continue
            from_sq, to_sq = move.from_square, move.to_square
            if to_sq == ep_square and pawns & _BB_SQUARES[from_sq]:
                continue  # en passant is a capture
            index = from_sq << 6 | to_sq
            if index == skip:
                continue
            n -= 1
            if index == killer_1:
                scored.append((_KILLER_1, n, move, True))
            elif index == killer_2:
                scored.append((_KILLER_2, n, move, True))
            else:
                scored.append((history[index], n, move, True))
        scored.sort(reverse=True)
        return scored

    @staticmethod
    def _reward_quiet(move, killers, history, depth, quiets_tried):
        """A quiet move refuted the position: remember it, and demote the ones tried first."""
        if killers[0] != move:
            killers[1] = killers[0]
            killers[0] = move
        bonus = depth * depth
        if bonus > 400:
            bonus = 400
        index = move.from_square << 6 | move.to_square
        value = history[index]
        history[index] = value + bonus - value * bonus // _HISTORY_MAX
        for other in quiets_tried:
            index = other.from_square << 6 | other.to_square
            value = history[index]
            history[index] = value - bonus - value * bonus // _HISTORY_MAX

    # ------------------------------------------------------------------- PV

    def _extract_pv(self, board: chess.Board, first_move) -> list:
        if first_move is None:
            return []
        pv = [first_move.uci()]
        temp = board.copy(stack=False)
        temp.push(first_move)
        seen = set()
        for _ in range(15):
            key = position_key(temp)
            entry = self.tt.get(key)
            if entry is None or entry[3] is None or key in seen:
                break
            seen.add(key)
            move = entry[3]
            if not temp.is_legal(move):
                break
            pv.append(move.uci())
            temp.push(move)
        return pv


def _check_squares(board: chess.Board):
    """Squares from which each piece type would check the opponent's king."""
    turn = board.turn
    own = board.occupied_co[turn]
    occupied = board.occupied
    king = (board.kings & board.occupied_co[not turn]).bit_length() - 1
    diagonal = _DIAG_ATTACKS[king][_DIAG_MASKS[king] & occupied]
    straight = (_RANK_ATTACKS[king][_RANK_MASKS[king] & occupied]
                | _FILE_ATTACKS[king][_FILE_MASKS[king] & occupied])
    # Own pieces standing between one of our sliders and the king: moving
    # them may uncover a check.
    snipers = ((_DIAG_ATTACKS[king][0] & (board.bishops | board.queens))
               | ((_RANK_ATTACKS[king][0] | _FILE_ATTACKS[king][0])
                  & (board.rooks | board.queens))) & own
    discoverers = 0
    while snipers:
        sniper = snipers & -snipers
        snipers ^= sniper
        between = chess.between(king, sniper.bit_length() - 1) & occupied
        if between and not between & (between - 1):
            discoverers |= between
    return (_PAWN_ATTACKS[not turn][king], _KNIGHT_ATTACKS[king], diagonal, straight,
            discoverers & own)


def _may_give_check(board: chess.Board, move: chess.Move, check_squares) -> bool:
    """Conservative test: False only when a quiet move certainly gives no check."""
    pawn_sq, knight_sq, diagonal_sq, straight_sq, discoverers = check_squares
    from_bb = _BB_SQUARES[move.from_square]
    to_bb = _BB_SQUARES[move.to_square]
    if from_bb & discoverers:
        return True
    if from_bb & board.pawns:
        return bool(to_bb & pawn_sq)
    if from_bb & board.knights:
        return bool(to_bb & knight_sq)
    if from_bb & board.bishops:
        return bool(to_bb & diagonal_sq)
    if from_bb & board.rooks:
        return bool(to_bb & straight_sq)
    if from_bb & board.queens:
        return bool(to_bb & (diagonal_sq | straight_sq))
    # King moves only check by castling (the rook) - rare, so never prune them.
    return abs(move.from_square - move.to_square) == 2


def evaluate_relative(board: chess.Board) -> int:
    """Static eval from the side to move's perspective (negamax convention)."""
    score = evaluate(board)
    return score if board.turn else -score
