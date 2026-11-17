"""Engine and evaluation correctness tests.

Every position with a "right answer" here was checked with Stockfish first.
"""

import random
import time

import chess
import pytest

from fischerbot.dataset import load_corpus
from fischerbot.engine import (
    INF, MATE_BOUND, MATE_SCORE, Engine, _check_squares, _may_give_check,
    evaluate_relative, position_key, static_exchange,
)
from fischerbot.evaluation import evaluate


def search_move(fen, ms=2000, depth=64):
    board = chess.Board(fen)
    result = Engine().search(board, time_budget_ms=ms, max_depth=depth)
    return result, board


@pytest.fixture(scope="module")
def corpus_positions():
    """A fixed, varied sample of positions from the real games."""
    rng = random.Random(7)
    boards = []
    for fg in load_corpus():
        board = fg.game.board()
        for move in fg.game.mainline_moves():
            board.push(move)
            boards.append(board.copy())
    return rng.sample(boards, 250)


class TestTactics:
    def test_mate_in_one_back_rank(self):
        result, _ = search_move("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", ms=1500)
        assert result.move.uci() == "a1a8"

    def test_mate_in_one_queen(self):
        # Scholar's mate: Qxf7#
        board = chess.Board("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4")
        res = Engine().search(board, time_budget_ms=2500)
        assert res.move.uci() == "h5f7"
        board.push(res.move)
        assert board.is_checkmate()

    def test_mate_in_two(self):
        # Two-rook ladder. White: Kg1, Ra7, Rb6; Black: Kg8.
        board = chess.Board("6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1")
        engine = Engine()
        res = engine.search(board, time_budget_ms=3000)
        assert res.score_cp >= MATE_BOUND
        board.push(res.move)
        if not board.is_checkmate():
            board.push(Engine().search(board, time_budget_ms=1000).move)
            board.push(engine.search(board, time_budget_ms=3000).move)
            assert board.is_checkmate()

    @pytest.mark.parametrize("fen, first_move, mate_in", [
        # 1.Nf6+ gxf6 2.Bxf7#
        ("r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 1", "d5f6", 2),
        # Queen sacrifice: 1.Qxh8+ Kxh8 2.Bf6+ Kg8 3.Re8#
        ("r1b3kr/ppp1Bp1p/1b6/n2P4/2p3q1/2Q2N2/P4PPP/RN2R1K1 w - - 1 1", "c3h8", 3),
        # 1.Ra6+ f6 2.Bxf6+ Rg7 3.Rxa8#
        ("r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1", "f6a6", 3),
        # Black to move: 1...Qg6+ 2.Kg4 Qf5+ 3.Kh5 Qh3#
        ("2r3k1/p4p2/3Rp2p/1p2P1pK/8/1P4P1/P3Q2P/1q6 b - - 0 1", "b1g6", 3),
    ])
    def test_finds_forced_mate(self, fen, first_move, mate_in):
        result, _ = search_move(fen, ms=3000)
        assert result.move.uci() == first_move
        # A mate in N is scored MATE_SCORE minus the plies needed to deliver it.
        assert result.score_cp == MATE_SCORE - (2 * mate_in - 1)

    def test_does_not_hang_queen(self):
        """The exact position where the original engine played Qxe5+?? (hanging the queen)."""
        fen = "r1bqkbnr/pppp1ppp/2n5/4p3/3Q4/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1"
        result, board = search_move(fen, ms=3000)
        board.push(result.move)
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

    def test_saves_lost_game_by_perpetual_check(self):
        # White is a rook down and about to be mated; 1.Qg5+ forces a repetition.
        result, _ = search_move("6k1/5p1p/8/8/8/8/rq6/2Q4K w - - 0 1", ms=2500)
        assert result.move.uci() == "c1g5"
        assert result.score_cp == 0, "a forced repetition is a draw"


class TestSearchCorrectness:
    """With pruning switched off the search must equal a textbook minimax exactly."""

    @staticmethod
    def reference(engine, board, depth, ply, path):
        in_check = board.is_check()
        if in_check:
            depth += 1
        if depth <= 0:
            return engine._quiesce(board, -INF, INF, ply)
        if board.halfmove_clock >= 100:
            return 0
        key = position_key(board)
        if key in path:
            return 0
        moves = list(board.legal_moves)
        if not moves:
            return ply - MATE_SCORE if in_check else 0
        path.add(key)
        best = -INF
        for move in moves:
            board.push(move)
            best = max(best, -TestSearchCorrectness.reference(engine, board, depth - 1, ply + 1, path))
            board.pop()
        path.discard(key)
        return best

    @pytest.mark.parametrize("fen, depths", [
        ("r1bqkbnr/pppp1ppp/2n5/4p3/3Q4/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1", (1, 2)),
        ("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", (1, 2)),
        # Tactically loaded (castling, pins, promotion threats): one ply is plenty.
        ("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", (1,)),
        ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", (1, 2, 3)),
        ("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", (1, 2)),
    ])
    def test_full_width_search_equals_minimax(self, fen, depths):
        for depth in depths:
            board = chess.Board(fen)
            helper = Engine(selective=False)
            helper._deadline = float("inf")
            path = {position_key(board)}
            want = -INF
            for move in list(board.legal_moves):
                board.push(move)
                want = max(want, -self.reference(helper, board, depth - 1, 1, path))
                board.pop()
            got = Engine(selective=False).search(chess.Board(fen), time_budget_ms=600_000,
                                                 max_depth=depth)
            assert got.score_cp == want, f"depth {depth}: engine {got.score_cp}, minimax {want}"

    def test_node_limit_makes_search_reproducible(self):
        fen = "r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 1"
        runs = [Engine().search(chess.Board(fen), time_budget_ms=600_000, node_limit=6_000)
                for _ in range(2)]
        assert runs[0].move == runs[1].move
        assert runs[0].score_cp == runs[1].score_cp
        assert runs[0].nodes == runs[1].nodes
        assert runs[0].nodes < 8_000

    def test_staged_generation_covers_every_legal_move(self, corpus_positions):
        special = [
            "8/P6k/8/8/8/8/6pK/8 w - - 0 1",                                  # promotions
            "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3",   # en passant
            "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1",              # castling
            "4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1",                              # in check
            "1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1",                                # capture-promotion
        ]
        engine = Engine()
        rng = random.Random(3)
        for board in corpus_positions + [chess.Board(fen) for fen in special]:
            legal = sorted(m.uci() for m in board.legal_moves)
            hash_moves = [None] + (rng.sample(list(board.legal_moves), 1) if legal else [])
            for hash_move in hash_moves:
                good, losing = engine._noisy_moves(board, hash_move)
                quiets = engine._quiet_moves(board, 2, hash_move)
                staged = [m.uci() for _, _, m, _ in good + losing + quiets]
                if hash_move is not None:
                    staged.append(hash_move.uci())
                assert sorted(staged) == legal, board.fen()
                assert all(board.is_capture(m) or m.promotion for _, _, m, _ in good + losing)
                assert not any(board.is_capture(m) or m.promotion for _, _, m, _ in quiets)

    def test_static_exchange(self):
        # Pawn takes a pawn that is defended by a pawn: an even trade.
        assert static_exchange(chess.Board("4k3/8/2p5/3p4/4P3/8/8/4K3 w - - 0 1"),
                               chess.Move.from_uci("e4d5")) == 0
        # Queen takes a defended pawn: wins a pawn, loses the queen.
        board = chess.Board("4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1")
        assert static_exchange(board, chess.Move.from_uci("d1d5")) == 100 - 950
        # Rook takes an undefended knight.
        board = chess.Board("4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1")
        assert static_exchange(board, chess.Move.from_uci("d1d5")) == 320
        # X-ray: the second rook backs up the first, so the exchange wins a pawn.
        board = chess.Board("3rk3/8/8/3p4/8/8/3R4/3RK3 w - - 0 1")
        assert static_exchange(board, chess.Move.from_uci("d2d5")) == 100
        # A quiet move onto a square covered by a pawn loses the piece; a safe one loses nothing.
        board = chess.Board("4k3/8/2p5/8/8/2N5/8/4K3 w - - 0 1")
        assert static_exchange(board, chess.Move.from_uci("c3d5")) == -320
        assert static_exchange(board, chess.Move.from_uci("c3e4")) == 0
        # The king may not recapture on a square that is still defended.
        board = chess.Board("3rk3/8/8/8/8/2n5/8/3RK3 b - - 0 1")
        assert static_exchange(board, chess.Move.from_uci("c3d1")) == 500
        # ... but it may when nothing else covers the square.
        board = chess.Board("4k3/8/8/8/8/2n5/8/3RK3 b - - 0 1")
        assert static_exchange(board, chess.Move.from_uci("c3d1")) == 500 - 320

    def test_check_detection_never_misses_a_check(self, corpus_positions):
        for board in corpus_positions:
            squares = _check_squares(board)
            for move in board.legal_moves:
                if board.is_capture(move) or move.promotion:
                    continue
                if board.gives_check(move):
                    assert _may_give_check(board, move, squares), (board.fen(), move)

    def test_position_key_identifies_positions(self):
        a = chess.Board()
        for uci in ("g1f3", "g8f6", "b1c3", "b8c6"):
            a.push_uci(uci)
        b = chess.Board()
        for uci in ("b1c3", "b8c6", "g1f3", "g8f6"):
            b.push_uci(uci)
        assert position_key(a) == position_key(b), "transpositions share a key"
        start = chess.Board()
        assert position_key(start) != position_key(a)
        no_castling = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1")
        assert position_key(start) != position_key(no_castling)
        black_to_move = chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1")
        assert position_key(start) != position_key(black_to_move)


class TestCandidates:
    FEN = "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 8"

    def test_candidates_are_within_the_window(self):
        board = chess.Board(self.FEN)
        engine = Engine()
        result = engine.search(board, time_budget_ms=600_000, max_depth=5)
        scores = engine.candidates(board, result, window_cp=60)
        assert scores[result.move.uci()] == result.score_cp
        assert len(scores) >= 2, "a quiet opening position has more than one playable move"
        for uci, score in scores.items():
            assert chess.Move.from_uci(uci) in board.legal_moves
            assert score >= result.score_cp - 60
        assert board == chess.Board(self.FEN), "analysis must leave the board untouched"

    def test_verify_agrees_with_candidates(self):
        board = chess.Board(self.FEN)
        engine = Engine()
        result = engine.search(board, time_budget_ms=600_000, max_depth=5)
        scores = engine.candidates(board, result, window_cp=60)
        deadline = time.perf_counter() + 60
        for uci, score in scores.items():
            move = chess.Move.from_uci(uci)
            assert engine.verify_at_least(board, move, score - 25, result.depth, deadline)
            assert not engine.verify_at_least(board, move, score + 120, result.depth, deadline)
        assert board == chess.Board(self.FEN)

    def test_verify_out_of_time_says_no(self):
        board = chess.Board(self.FEN)
        engine = Engine()
        result = engine.search(board, time_budget_ms=600_000, max_depth=4)
        assert not engine.verify_at_least(board, result.move, -INF, 4, deadline=time.perf_counter() - 1)


class TestEvaluation:
    def test_start_position_is_balanced(self):
        assert evaluate(chess.Board()) == pytest.approx(0, abs=15)

    def test_colour_symmetry(self, corpus_positions):
        """Swapping colours must flip the sign exactly - catches table-orientation bugs."""
        for board in corpus_positions:
            assert evaluate(board) == -evaluate(board.mirror()), board.fen()

    def test_material(self):
        up_a_queen = chess.Board("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")
        assert evaluate(up_a_queen) > 800
        assert evaluate(up_a_queen.mirror()) < -800

    def test_dead_draws_score_near_zero(self):
        assert evaluate(chess.Board("8/8/8/4k3/8/8/8/KB6 w - - 0 1")) == 0          # K+B v K
        assert abs(evaluate(chess.Board("8/8/8/4k3/8/8/8/KNN5 w - - 0 1"))) < 60    # K+N+N v K
        assert abs(evaluate(chess.Board("8/8/8/4k3/8/3b4/8/KR6 w - - 0 1"))) < 60   # K+R v K+B

    def test_mating_material_drives_king_to_the_edge(self):
        centre = evaluate(chess.Board("8/8/8/4k3/8/8/8/KQ6 w - - 0 1"))
        corner = evaluate(chess.Board("k7/8/8/8/8/8/8/KQ6 w - - 0 1"))
        assert corner > centre > 700


class TestEndgameTechnique:
    @pytest.mark.parametrize("name, fen, max_moves", [
        ("K+Q v K", "8/8/8/4k3/8/8/8/KQ6 w - - 0 1", 20),
        ("K+R v K", "8/8/8/4k3/8/8/8/KR6 w - - 0 1", 30),
    ])
    def test_delivers_elementary_mates(self, name, fen, max_moves):
        board = chess.Board(fen)
        attacker, defender = Engine(), Engine()
        while not board.is_game_over(claim_draw=True) and board.fullmove_number <= max_moves:
            engine = attacker if board.turn == chess.WHITE else defender
            board.push(engine.search(board, time_budget_ms=150).move)
        assert board.is_checkmate(), f"{name}: no mate within {max_moves} moves"


class TestRobustness:
    def test_always_returns_legal_move_random_positions(self):
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
        board = chess.Board("r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 1")
        start = time.perf_counter()
        Engine().search(board, time_budget_ms=1000)
        elapsed = time.perf_counter() - start
        assert elapsed < 1.5, f"search took {elapsed:.1f}s on a 1s budget"

    def test_tiny_budget_still_returns_a_move(self):
        board = chess.Board("r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 1")
        result = Engine().search(board, time_budget_ms=1)
        assert result.move in board.legal_moves
        assert result.depth >= 1 and abs(result.score_cp) < MATE_BOUND

    def test_search_leaves_the_board_untouched(self):
        fen = "r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 1"
        board = chess.Board(fen)
        Engine().search(board, time_budget_ms=120)   # will be interrupted mid-iteration
        assert board.fen() == fen and not board.move_stack

    def test_game_over_positions(self):
        stalemate = chess.Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")
        assert stalemate.is_stalemate()
        assert Engine().search(stalemate, time_budget_ms=100).move is None
        assert evaluate_relative(stalemate) is not None
        mated = chess.Board("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1")
        assert mated.is_checkmate()
        assert Engine().search(mated, time_budget_ms=100).move is None

    def test_single_legal_move_is_played_at_once(self):
        board = chess.Board("7k/8/5K2/6Q1/8/8/8/8 b - - 0 1")  # only ...Kh7
        assert board.legal_moves.count() == 1
        start = time.perf_counter()
        result = Engine().search(board, time_budget_ms=3000)
        assert result.move.uci() == "h8h7"
        assert time.perf_counter() - start < 1.0
