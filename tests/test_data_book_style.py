"""Corpus authenticity, opening book, style model, and API tests."""

import chess
import pytest

from fischerbot.book import OpeningBook
from fischerbot.dataset import load_corpus
from fischerbot.style import N_FEATURES, StyleModel, move_features


@pytest.fixture(scope="module")
def corpus():
    return load_corpus()


@pytest.fixture(scope="module")
def book(corpus):
    return OpeningBook(corpus, seed=1972)


class TestCorpus:
    def test_counts(self, corpus):
        m60 = [g for g in corpus if g.source == "m60mg"]
        wc = [g for g in corpus if g.source == "wc1972"]
        assert len(m60) == 60
        assert len(wc) == 20  # 21 rounds minus the game-2 forfeit

    def test_all_games_parse_fully_legal(self, corpus):
        # dataset.py raises on parse errors; walking mainlines re-verifies legality
        for fg in corpus[:10]:
            board = fg.game.board()
            for move in fg.game.mainline_moves():
                assert move in board.legal_moves
                board.push(move)

    def test_wc_game6_authentic(self, corpus):
        g6 = next(g for g in corpus if g.source == "wc1972" and g.number == 6)
        assert g6.fischer_color == chess.WHITE
        first = next(iter(g6.game.mainline_moves()))
        assert first.uci() == "c2c4"  # the famous 1.c4

    def test_wc_game1_authentic(self, corpus):
        g1 = next(g for g in corpus if g.source == "wc1972" and g.number == 1)
        assert g1.fischer_color == chess.BLACK
        assert "Spassky" in g1.white


class TestBook:
    def test_start_position_in_book(self, book):
        board = chess.Board()
        moves = book.lookup(board)
        assert moves, "start position must be in the book"
        ucis = {m.uci for m in moves}
        assert "e2e4" in ucis  # Fischer's signature first move
        top = moves[0]
        assert top.uci == "e2e4"

    def test_ruy_lopez_line(self, book):
        board = chess.Board()
        for uci in ["e2e4", "e7e5", "g1f3", "b8c6"]:
            board.push_uci(uci)
        moves = book.lookup(board)
        assert moves, "1.e4 e5 2.Nf3 Nc6 must be in Fischer's book"
        assert moves[0].uci == "f1b5", "Fischer played the Ruy Lopez"

    def test_black_defense_to_e4(self, book):
        board = chess.Board()
        board.push_uci("e2e4")
        moves = book.lookup(board)
        assert moves
        assert "c7c5" in {m.uci for m in moves}  # the Sicilian

    def test_citations_present(self, book):
        board = chess.Board()
        entry = book.choose(board)
        assert entry is not None
        assert entry.citations and isinstance(entry.citations[0], str)
        assert len(entry.citations[0]) > 10

    def test_book_moves_always_legal(self, book):
        board = chess.Board()
        for _ in range(12):
            entry = book.choose(board)
            if entry is None:
                break
            move = chess.Move.from_uci(entry.uci)
            assert move in board.legal_moves
            board.push(move)
            # opponent plays engine-free: first legal reply
            if board.is_game_over():
                break
            board.push(next(iter(board.legal_moves)))


class TestStyle:
    def test_feature_vector_shape(self):
        board = chess.Board()
        for move in board.legal_moves:
            feats = move_features(board, move)
            assert len(feats) == N_FEATURES

    def test_training_reduces_loss_quickly(self, corpus):
        """A short real training run must beat the uniform baseline."""
        import numpy as np
        from train_style import build_samples

        samples = build_samples(corpus[:8])
        assert len(samples) > 100
        w = np.zeros(N_FEATURES)
        def nll(weights):
            total = 0.0
            for feats, chosen in samples:
                logits = feats @ weights
                logits -= logits.max()
                p = np.exp(logits)
                p /= p.sum()
                total -= np.log(p[chosen] + 1e-12)
            return total / len(samples)

        before = nll(w)
        for _ in range(3):
            for feats, chosen in samples:
                logits = feats @ w
                logits -= logits.max()
                p = np.exp(logits)
                p /= p.sum()
                w -= 0.1 * (p @ feats - feats[chosen])
        after = nll(w)
        assert after < before - 0.15, f"loss did not fall: {before:.3f} -> {after:.3f}"

    def test_saved_model_loads_if_present(self):
        model = StyleModel.load_or_none()
        if model is not None:
            board = chess.Board()
            ranked = model.rank_moves(board)
            assert len(ranked) == 20
            total = sum(p for _, p in ranked)
            assert abs(total - 1.0) < 1e-6


class TestApi:
    @pytest.fixture(scope="class")
    def client(self):
        from fischerbot.api import create_app
        app = create_app()
        app.testing = True
        return app.test_client()

    def test_health(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.get_json()["book_positions"] > 500

    def test_first_move_is_book_with_citation(self, client):
        r = client.post("/api/move", json={"history": [], "difficulty": "easy"})
        assert r.status_code == 200
        data = r.get_json()
        assert data["source"] == "book"
        assert "book_citation" in data
        assert data["bot_move"] in ("e2e4", "d2d4", "c2c4", "g1f3", "b1c3")

    def test_illegal_history_rejected(self, client):
        r = client.post("/api/move", json={"history": ["e2e5"], "difficulty": "easy"})
        assert r.status_code == 400

    def test_missing_history_rejected(self, client):
        r = client.post("/api/move", json={})
        assert r.status_code == 400

    def test_non_string_history_rejected(self, client):
        for bad in ([123], [None], [{}], ["e2e4", 5]):
            r = client.post("/api/move", json={"history": bad, "difficulty": "easy"})
            assert r.status_code == 400, f"history={bad!r} should be a 400"

    def test_oversized_history_rejected(self, client):
        r = client.post("/api/move", json={"history": ["e2e4"] * 2000, "difficulty": "easy"})
        assert r.status_code == 400

    def test_security_headers_present(self, client):
        r = client.get("/api/health")
        assert "Content-Security-Policy" in r.headers
        assert r.headers["X-Content-Type-Options"] == "nosniff"

    def test_checkmate_reported(self, client):
        fools_mate = ["f2f3", "e7e5", "g2g4", "d8h4"]
        r = client.post("/api/move", json={"history": fools_mate, "difficulty": "easy"})
        assert r.status_code == 200
        data = r.get_json()
        assert data["status"] == "checkmate_black"
        assert data["bot_move"] is None
