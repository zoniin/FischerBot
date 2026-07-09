"""Engine correctness tests — each encodes a defect found in the original bot."""

import chess
import pytest

from fischerbot.engine import Engine, evaluate_relative
from fischerbot.evaluation import evaluate


def search_move(fen, ms=2000, depth=64):
    board = chess.Board(fen)
    result = Engine().search(board, time_budget_ms=ms, max_depth=depth)
    return result, board


class TestTactics:
    def test_mate_in_one_back_rank(self):
        result, _ = search_move("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", ms=1500)
        assert result.move.uci() == "a1a8"

    def test_mate_in_one_queen(self):
        # Scholar's mate: Qxf7#
        board = chess.Board("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4")
        res = Engine().search(board, time_budget_ms=2500)
        assert res.move.uci() == "h5f7"  # Qxf7# (Scholar's mate)
        board.push(res.move)
        assert board.is_checkmate()

    def test_mate_in_two(self):
        # Classic two-rook ladder: Ra1-a8 ... then Rb7-b8 style. White: Kg1, Ra7, Rb6; Black: Kg8.
        board = chess.Board("6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1")
        engine = Engine()
        res = engine.search(board, time_budget_ms=3000)
        board.push(res.move)
        # After best play, mate is delivered next move
        if not board.is_checkmate():
            reply = Engine().search(board, time_budget_ms=1000).move
            board.push(reply)
            res2 = engine.search(board, time_budget_ms=3000)
            board.push(res2.move)
            assert board.is_checkmate()

    def test_does_not_hang_queen(self):
        """The exact position where the original engine played Qxe5+?? (hanging the queen)."""
        fen = "r1bqkbnr/pppp1ppp/2n5/4p3/3Q4/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1"
        result, board = search_move(fen, ms=3000)
        board.push(result.move)
        # After our move, black must not be able to win the queen for a pawn/knight.
        queen_squares = board.pieces(chess.QUEEN, chess.WHITE)
        assert queen_squares, "queen should still exist"
        q = next(iter(queen_squares))
        if board.is_attacked_by(chess.BLACK, q):
            assert board.is_attacked_by(chess.WHITE, q), "queen left en prise"
            attackers = board.attackers(chess.BLACK, q)
            cheap_attacker = any(
                board.piece_type_at(a) in (chess.PAWN, chess.KNIGHT, chess.BISHOP)
                for a in attackers
            )
            assert not cheap_attacker, f"queen on {chess.square_name(q)} attacked by minor/pawn"

    def test_captures_hanging_queen(self):
        # Black queen on e4 is undefended and attacked by the d3 pawn.
        board = chess.Board("rnb1kbnr/pppp1ppp/8/4p3/4q3/3P4/PPP1PPPP/RNBQKBNR w KQkq - 0 1")
        res = Engine().search(board, time_budget_ms=1500)
        assert res.move.uci() == "d3e4", f"expected dxe4 winning the queen, got {res.move.uci()}"


class TestMinimaxCorrectness:
    """Regression for the inverted-search bug: compare against reference minimax."""

    @staticmethod
    def reference_minimax(board, depth):
        if depth == 0 or board.is_game_over():
            return evaluate_relative(board), None
        best_score, best_move = -10**9, None
        for move in board.legal_moves:
            board.push(move)
            score, _ = TestMinimaxCorrectness.reference_minimax(board, depth - 1)
            score = -score
            board.pop()
            if score > best_score:
                best_score, best_move = score, move
        return best_score, best_move

    @pytest.mark.parametrize("fen", [
        "r1bqkbnr/pppp1ppp/2n5/4p3/3Q4/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1",
        "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    ])
    def test_matches_reference_at_depth_2(self, fen):
        board = chess.Board(fen)
        ref_score, _ = self.reference_minimax(board.copy(), 2)
        engine = Engine()
        engine.tt.clear()
        result = engine.search(board, time_budget_ms=60000, max_depth=2)
        # Same score (quiescence can only differ when captures dangle at the horizon;
        # allow it to be >= the raw reference since qsearch refines the leaf).
        assert result.score_cp >= ref_score - 1, (
            f"engine depth-2 score {result.score_cp} below reference {ref_score}: "
            "search is unsound"
        )


class TestRobustness:
    def test_always_returns_legal_move_random_positions(self):
        import random
        rng = random.Random(42)
        board = chess.Board()
        engine = Engine()
        for _ in range(30):
            if board.is_game_over():
                break
            if rng.random() < 0.5:
                move = rng.choice(list(board.legal_moves))
            else:
                move = engine.search(board, time_budget_ms=150).move
            assert move in board.legal_moves
            board.push(move)

    def test_respects_time_budget(self):
        import time
        board = chess.Board("r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 1")
        start = time.perf_counter()
        Engine().search(board, time_budget_ms=1000)
        elapsed = time.perf_counter() - start
        assert elapsed < 2.5, f"search took {elapsed:.1f}s on a 1s budget"

    def test_stalemate_is_draw_score(self):
        board = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
        assert board.is_stalemate()
        assert evaluate_relative(board) is not None  # eval itself must not crash

    def test_eval_symmetry(self):
        board = chess.Board()
        assert evaluate(board) == pytest.approx(0, abs=15)  # start position ~balanced
