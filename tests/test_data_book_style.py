"""Corpus authenticity, opening book, style model, bot and API tests."""

import time

import chess
import pytest
from pathlib import Path

from fischerbot.book import BOOK_PATH, OpeningBook, recency
from fischerbot.bot import FischerBot
from fischerbot.dataset import CORE_SOURCES, load_corpus
from fischerbot.style import (
    ENGINE_BEST, ENGINE_LOSS, GLOBAL_FEATURES, N_FEATURES, N_PHASE, PHASE_FEATURES,
    PositionContext, StyleModel, feature_names, game_phase, move_features,
)


@pytest.fixture(scope="module")
def corpus():
    return load_corpus()


@pytest.fixture(scope="module")
def book(corpus):
    return OpeningBook(corpus, seed=1972)


def game(corpus, source, number):
    return next(g for g in corpus if g.source == source and g.number == number)


def record(games):
    """(wins, draws, losses) from Fischer's point of view."""
    scores = [g.fischer_score for g in games]
    return scores.count(1.0), scores.count(0.5), scores.count(0.0)


class TestCorpus:
    def test_counts(self, corpus):
        m60 = [g for g in corpus if g.source == "m60mg"]
        wc = [g for g in corpus if g.source == "wc1972"]
        career = [g for g in corpus if g.source == "career"]
        assert len(m60) == 60
        assert len(wc) == 20  # 21 rounds minus the game-2 forfeit
        assert len(career) == 651
        assert len(corpus) == 731
        assert len(load_corpus(CORE_SOURCES)) == 80
        assert len({g.key for g in corpus}) == 731, "every game has its own key"
        with pytest.raises(ValueError):
            load_corpus(["blitz"])

    def test_every_move_of_every_game_is_legal(self, corpus):
        for fg in corpus:
            board = fg.game.board()
            for move in fg.game.mainline_moves():
                assert move in board.legal_moves, fg.citation
                board.push(move)

    def test_every_game_has_a_result(self, corpus):
        for fg in corpus:
            assert fg.result in ("1-0", "0-1", "1/2-1/2"), fg.citation

    def test_results_match_the_historical_record(self, corpus):
        # My 60 Memorable Games: 48 wins, 9 draws, 3 losses.
        assert record(g for g in corpus if g.source == "m60mg") == (48, 9, 3)
        # Reykjavik 1972, games actually played: +7 =11 -2 (12.5-8.5 with the forfeit).
        assert record(g for g in corpus if g.source == "wc1972") == (7, 11, 2)
        # The rest of his serious games, 1955-1992.
        assert record(g for g in corpus if g.source == "career") == (352, 221, 78)

    def test_career_games_do_not_repeat_the_core_games(self, corpus):
        """career.pgn holds only games that are not already in the two core files."""
        def positions(fg):
            board = fg.game.board()
            seen = set()
            for move in fg.game.mainline_moves():
                board.push(move)
                seen.add(board.epd())
            return seen
        core = [(g.year, g.fischer_color, positions(g)) for g in corpus if g.source != "career"]
        years = {year for year, _, _ in core}
        repeats = []
        for fg in corpus:
            if fg.source != "career" or fg.year not in years:
                continue
            mine = positions(fg)
            for year, color, theirs in core:
                # Two scores of one game share nearly every position; two games
                # that follow the same opening share a third at most.
                if year == fg.year and color == fg.fischer_color \
                        and len(mine & theirs) / min(len(mine), len(theirs)) >= 0.8:
                    repeats.append(fg.citation)
        assert not repeats

    def test_career_games_span_his_whole_career(self, corpus):
        career = [g for g in corpus if g.source == "career"]
        assert min(g.year for g in career) == 1955 and max(g.year for g in career) == 1992
        assert not [g.event for g in career if "blitz" in g.event.lower() or " sim" in g.event.lower()]
        taimanov = [g for g in career if g.opponent == "Taimanov" and g.year == 1971]
        assert len(taimanov) == 6 and all(g.fischer_score == 1.0 for g in taimanov)   # the 6-0 match
        assert taimanov[0].citation.endswith("Candidates quarter-final 1971")
        # The Game of the Century: D. Byrne-Fischer, New York 1956, 17...Be6!!
        century = next(g for g in career if g.opponent == "D. Byrne" and g.year == 1956 and g.fischer_score == 1.0)
        board = century.game.board()
        moves = list(century.game.mainline_moves())
        for move in moves[:33]:
            board.push(move)
        assert board.san(moves[33]) == "Be6"

    def test_the_three_losses_in_the_book(self, corpus):
        lost = sorted(g.number for g in corpus if g.source == "m60mg" and g.fischer_score == 0.0)
        assert lost == [17, 18, 58]  # Tal 1959, Spassky 1960, Geller 1967

    @pytest.mark.parametrize("number, plies, last_move", [
        (7, 80, "e3e2"),     # Olafsson-Fischer: 40...e2
        (15, 108, "d6e6"),   # Smyslov-Fischer: 54...Re6
        (16, 96, "e4h1"),    # Fischer-Petrosian: 48...Qh1
        (27, 114, "e5f5"),   # Reshevsky-Fischer: 57...Kf5
        (37, 153, "f8f7"),   # Keres-Fischer: 77.Qf7+
    ])
    def test_games_the_source_left_unfinished_are_complete(self, corpus, number, plies, last_move):
        moves = list(game(corpus, "m60mg", number).game.mainline_moves())
        assert len(moves) == plies
        assert moves[-1].uci() == last_move

    def test_olafsson_game_has_the_missing_exchange(self, corpus):
        moves = [m.uci() for m in game(corpus, "m60mg", 7).game.mainline_moves()]
        assert moves[30:33] == ["c3a4", "d7a4", "b2b3"]  # 16.Nxa4 Bxa4 17.b3

    def test_four_queens_game(self, corpus):
        """Fischer-Petrosian 1959: after 37.h8=Q there are four queens on the board."""
        board = game(corpus, "m60mg", 16).game.board()
        most_queens = 0
        for move in game(corpus, "m60mg", 16).game.mainline_moves():
            board.push(move)
            most_queens = max(most_queens, chess.popcount(board.queens))
        assert most_queens == 4

    def test_wc_game6_authentic(self, corpus):
        g6 = game(corpus, "wc1972", 6)
        assert g6.fischer_color == chess.WHITE
        moves = list(g6.game.mainline_moves())
        assert moves[0].uci() == "c2c4"  # the famous 1.c4
        assert len(moves) == 81 and moves[-1].uci() == "e4f4"  # 41.Qf4 1-0
        assert g6.result == "1-0"

    def test_wc_game1_authentic(self, corpus):
        g1 = game(corpus, "wc1972", 1)
        assert g1.fischer_color == chess.BLACK
        assert "Spassky" in g1.white
        board = g1.game.board()
        moves = list(g1.game.mainline_moves())
        for move in moves[:57]:
            board.push(move)
        assert board.san(moves[57]) == "Bxh2"  # 29...Bxh2, the notorious pawn grab

    def test_citations_name_the_event(self, corpus):
        assert game(corpus, "m60mg", 1).citation == \
            "Fischer–Sherwin, New Jersey Open Championship 1957 (My 60 Memorable Games, #1)"
        assert game(corpus, "m60mg", 37).citation == \
            "Keres–Fischer, Curaçao 1962 (My 60 Memorable Games, #37)"
        assert game(corpus, "wc1972", 6).citation == \
            "Fischer–Spassky, World Championship 1972, Game 6"
        for fg in corpus:
            assert "http" not in fg.citation

    def test_one_name_per_event(self, corpus):
        """The book's chapter headings and the database agree on what an event is called."""
        assert game(corpus, "m60mg", 39).citation == \
            "Botvinnik–Fischer, Varna Olympiad 1962 (My 60 Memorable Games, #39)"
        assert game(corpus, "m60mg", 2).event_name == "Portorož Interzonal"
        names = {fg.event_name for fg in corpus}
        for stray in ("USA Championship", "Candidates' Tournament", "Leipzig Olympic", "Portoroz"):
            assert stray not in names

    def test_the_game_of_the_century_is_marked(self, corpus):
        marked = [fg for fg in corpus if fg.is_game_of_the_century]
        assert len(marked) == 1
        assert marked[0].citation == \
            "D. Byrne–Fischer, Rosenwald Trophy, New York 1956 (the “Game of the Century”)"
        board = marked[0].game.board()
        moves = list(marked[0].game.mainline_moves())
        for move in moves[:33]:
            board.push(move)
        assert board.san(moves[33]) == "Be6"   # 17...Be6, leaving the queen to be taken


class TestBook:
    def test_start_position_in_book(self, book):
        board = chess.Board()
        moves = book.lookup(board)
        assert moves, "start position must be in the book"
        # Every first move of his serious career: 1.e4 nearly always, 1.Nf3 as a
        # boy, 1.c4 in 1970-72, and four games with 1.b3.
        assert [m.uci for m in moves] == ["e2e4", "g1f3", "c2c4", "b2b3"]
        assert moves[0].count > 300  # "best by test"
        core = OpeningBook(load_corpus(CORE_SOURCES))
        assert {m.uci for m in core.lookup(board)} == {"e2e4", "c2c4"}

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
        assert moves[0].uci == "c7c5"  # the Sicilian

    def test_transpositions_are_recognised(self, book):
        """The book is keyed by position, so a different move order still finds his reply."""
        direct, transposed = chess.Board(), chess.Board()
        for uci in ["d2d4", "g8f6", "c2c4"]:
            direct.push_uci(uci)
        for uci in ["c2c4", "g8f6", "d2d4"]:
            transposed.push_uci(uci)
        replies = [m.uci for m in book.lookup(direct)]
        assert replies and replies == [m.uci for m in book.lookup(transposed)]
        assert "g7g6" in replies  # the King's Indian / Gruenfeld

    def test_only_fischers_side_is_in_the_book(self, book, corpus):
        board = chess.Board()
        for uci in ["e2e4", "e7e5"]:
            board.push_uci(uci)
        assert book.lookup(board), "as White he faced 1...e5 many times"
        g1 = game(corpus, "wc1972", 1)  # Fischer was Black: White-to-move positions are not his
        board = g1.game.board()
        moves = list(g1.game.mainline_moves())
        for move in moves[:10]:
            board.push(move)
        assert board.turn == chess.WHITE and not book.lookup(board)
        # ... but the book does remember what his opponent played there.
        replies = book.replies(board)
        assert [m.uci for m in replies] == [moves[10].uci()]
        assert replies[0].games[0].opponent == "Spassky"

    def test_eras(self, book):
        """A level set in 1956 knows only the games he had played by then."""
        board = chess.Board()
        boy = book.lookup(board, year=1956)
        assert [m.uci for m in boy] == ["e2e4", "g1f3"]          # no 1.c4 or 1.b3 yet
        assert all(g.year <= 1956 for m in boy for g in m.games)
        assert boy[1].count >= 8, "the King's Indian Attack was half his repertoire as a boy"
        everything = book.lookup(board, year=1972, later=True)
        assert {m.uci for m in everything} == {"e2e4", "g1f3", "c2c4", "b2b3"}
        assert max(g.year for m in everything for g in m.games) == 1992
        # In 1972 the old 1.Nf3 games count for little.
        nf3 = next(m for m in everything if m.uci == "g1f3")
        assert nf3.weight < 0.5 * next(m for m in book.lookup(board) if m.uci == "g1f3").weight

    def test_recency(self):
        assert recency(None, 1956) == 1.0
        assert recency(1972, 1972) == recency(1972, 1968) == recency(1972, 1992) == 1.0
        assert recency(1972, 1967) == pytest.approx(0.92)
        assert recency(1972, 1956) == 0.35

    def test_choose_is_reproducible(self, book):
        board = chess.Board()
        moves = book.lookup(board)
        assert book.choose(board, r=0.0).uci == moves[0].uci
        assert book.choose(board, r=0.999999).uci == moves[-1].uci
        assert book.choose(chess.Board("8/8/8/4k3/8/8/8/KR6 w - - 0 1")) is None

    def test_famous_games_are_cited_first(self, book):
        board = chess.Board()
        for uci in ["c2c4", "e7e6", "g1f3", "d7d5", "d2d4", "g8f6", "b1c3", "f8e7"]:
            board.push_uci(uci)
        best = book.lookup(board)[0]
        assert best.uci == "c1g5"
        assert best.citations[0] == "Fischer–Spassky, World Championship 1972, Game 6"

    def test_saved_book_matches_the_games(self, corpus):
        """web/static/data/book.json must be rebuilt whenever the games or the book change."""
        tools = pytest.importorskip("tools.build_web_data")
        assert BOOK_PATH.read_text(encoding="utf-8") == tools.book_document(), \
            "book.json is stale: run python tools/build_web_data.py"

    def test_book_round_trips_through_json(self, book):
        loaded = OpeningBook.load()
        assert loaded.size == book.size and len(loaded.games) == len(book.games)
        board = chess.Board()
        for uci in ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4", "c5d4", "f3d4", "g8f6", "b1c3", "a7a6"]:
            for kwargs in ({}, {"year": 1958}, {"year": 1972, "later": True}):
                a, b = book.lookup(board, **kwargs), loaded.lookup(board, **kwargs)
                assert [(m.uci, m.count, m.weight, m.citations) for m in a] == \
                       [(m.uci, m.count, m.weight, m.citations) for m in b]
                a, b = book.replies(board, **kwargs), loaded.replies(board, **kwargs)
                assert [(m.uci, m.count) for m in a] == [(m.uci, m.count) for m in b]
            board.push_uci(uci)

    def test_results_shape_the_weights(self, book):
        board = chess.Board()
        for entry in book.lookup(board):
            assert 0.0 <= entry.result_points <= entry.count
            assert entry.weight > 0

    def test_citations_present(self, book):
        board = chess.Board()
        entry = book.choose(board)
        assert entry is not None
        assert entry.citations and isinstance(entry.citations[0], str)
        assert "Fischer" in entry.citations[0]

    def test_book_moves_always_legal(self, book):
        board = chess.Board()
        for _ in range(12):
            entry = book.choose(board)
            if entry is None:
                break
            move = chess.Move.from_uci(entry.uci)
            assert move in board.legal_moves
            board.push(move)
            if board.is_game_over():
                break
            board.push(next(iter(board.legal_moves)))

    def test_book_can_replay_a_whole_opening(self, corpus):
        """If the opponent follows game 6, the bot plays Fischer's first twenty moves."""
        g6 = game(corpus, "wc1972", 6)
        book = OpeningBook([g6])
        board = g6.game.board()
        for ply, move in enumerate(g6.game.mainline_moves()):
            if ply >= 40:
                break
            if board.turn == chess.WHITE:
                entry = book.choose(board)
                assert entry is not None and entry.uci == move.uci()
            board.push(move)
        assert book.choose(board) is None  # out of book after move 20


class TestStyleFeatures:
    def test_layout(self):
        names = feature_names()
        assert len(names) == N_FEATURES == len(set(names))
        assert N_FEATURES == 3 * len(PHASE_FEATURES) + len(GLOBAL_FEATURES) + 768
        assert names[ENGINE_LOSS] == "opening:engine_loss"
        assert names[N_PHASE + ENGINE_BEST] == "middlegame:engine_best"

    def test_features_agree_with_the_rules(self, corpus):
        names = feature_names()
        board = game(corpus, "m60mg", 48).game.board()   # Byrne-Fischer, the brilliancy prize
        for move in game(corpus, "m60mg", 48).game.mainline_moves():
            ctx = PositionContext(board)
            for legal in board.legal_moves:
                feats = move_features(ctx, legal)
                indices = [i for i, _ in feats]
                assert len(indices) == len(set(indices)), "a feature fired twice"
                assert all(0 <= i < N_FEATURES for i in indices)
                fired = {names[i].split(":", 1)[-1] if not names[i].startswith("repertoire")
                         else "repertoire" for i in indices}
                assert ("check" in fired) == board.gives_check(legal), (board.fen(), legal)
                assert ("capture" in fired) == board.is_capture(legal)
                assert ("castle_kingside" in fired) == board.is_kingside_castling(legal)
                assert ("castle_queenside" in fired) == board.is_queenside_castling(legal)
                assert ("promotion" in fired) == bool(legal.promotion)
                assert ("repertoire" in fired) == (board.fullmove_number <= 12)
                assert "engine_loss" not in fired and "engine_best" not in fired
            board.push(move)

    def test_named_features(self):
        names = feature_names()

        def fired(fen, uci):
            board = chess.Board(fen)
            ctx = PositionContext(board)
            return {names[i] for i, _ in move_features(ctx, chess.Move.from_uci(uci))}

        start = chess.STARTING_FEN
        assert {"pawn_centre_push", "pawn_double_step", "opening:piece_pawn",
                "repertoire:white:Pe4"} <= fired(start, "e2e4")
        assert {"knight_develops", "opening:piece_knight"} <= fired(start, "g1f3")
        assert "knight_to_rim" in fired(start, "g1h3")
        # Black's features are mirrored: ...g6/...Bg7 is the same fianchetto as g3/Bg2.
        kid = "rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq - 1 3"
        assert {"bishop_fianchetto", "bishop_long_diagonal", "bishop_develops",
                "repertoire:black:Bg2"} <= fired(kid, "f8g7")
        # Rook to the open e-file; bishop takes knight.
        assert "rook_open_file" in fired("4k3/pp3ppp/8/8/8/8/PP3PPP/R5K1 w - - 0 30", "a1e1")
        assert "bishop_takes_knight" in fired(
            "r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4", "b5c6")

    def test_phases(self):
        assert game_phase(chess.Board()) == 0
        middlegame = chess.Board("r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 14")
        assert game_phase(middlegame) == 1
        assert game_phase(chess.Board("8/5pk1/6p1/8/8/6P1/5PK1/3R4 w - - 0 40")) == 2


class TestStyleModel:
    def test_save_load_round_trip(self, tmp_path):
        weights = [0.0] * N_FEATURES
        weights[3] = 1.25
        weights[N_PHASE + ENGINE_LOSS] = -4.0
        weights[-5] = 0.5       # one repertoire square
        path = tmp_path / "style.json"
        StyleModel(weights).save(path, metadata={"note": "test"})
        loaded = StyleModel.load(path)
        assert loaded.weights == weights
        assert loaded.metadata == {"note": "test"}

    def test_rejects_models_from_other_versions(self, tmp_path):
        path = tmp_path / "old.json"
        path.write_text('{"features": ["bias"], "weights": [0.0]}', encoding="utf-8")
        assert StyleModel.load_or_none(path) is None
        assert StyleModel.load_or_none(tmp_path / "missing.json") is None

    def test_allowed_loss_follows_from_the_weights(self):
        weights = [0.0] * N_FEATURES
        for phase in range(3):
            weights[phase * N_PHASE + ENGINE_LOSS] = -5.0   # one pawn of loss costs 5 logits
            weights[phase * N_PHASE + ENGINE_BEST] = 0.5    # being the engine's choice is worth 0.5
        model = StyleModel(weights)
        assert model.allowed_loss(1, 0.4) < 0              # not enough style to bother
        assert model.allowed_loss(1, 0.5) < 0
        assert model.allowed_loss(1, 1.5) == pytest.approx(20.0)   # (1.5 - 0.5) / 5 pawns
        assert model.allowed_loss(1, 3.0) == pytest.approx(50.0)

    def test_engine_preference_comes_from_the_model_file(self):
        """A calibration chosen by cross-validation: extra reluctance to leave the engine's move."""
        weights = [0.0] * N_FEATURES
        for phase in range(3):
            weights[phase * N_PHASE + ENGINE_LOSS] = -4.0
        plain = StyleModel(weights)
        cautious = StyleModel(weights, {"engine_preference": 0.5})
        assert plain.allowed_loss(1, 1.0) == pytest.approx(25.0)
        assert cautious.allowed_loss(1, 1.0) == pytest.approx(12.5)
        assert cautious.allowed_loss(1, 0.5) < 0

    def test_style_scores_cover_all_legal_moves(self):
        model = StyleModel.load_or_none()
        if model is None:
            pytest.skip("no trained model bundled")
        board = chess.Board()
        scored = model.style_scores(board)
        assert len(scored) == 20
        assert [s for _, s in scored] == sorted((s for _, s in scored), reverse=True)
        ranked = model.rank_moves(board)
        assert abs(sum(p for _, p in ranked) - 1.0) < 1e-9

    def test_bundled_model_is_documented_and_helps(self):
        model = StyleModel.load()
        meta = model.metadata
        assert "My 60 Memorable Games" in meta["trained_on"]
        assert meta["decisions"] > 3200
        # Cross-validated on games held out of training: style must not make the
        # bot *less* like Fischer than the bare engine (it did in version 2.0).
        assert meta["cv_style_top1"] >= meta["cv_engine_top1"]
        for phase in range(3):
            assert model.weights[phase * N_PHASE + ENGINE_LOSS] < 0, "losing centipawns must cost"
        assert model.engine_preference == meta["engine_preference"] > 0

    def test_bundled_model_knows_his_openings(self):
        """Out of book the style model should still prefer Fischer's kind of move."""
        model = StyleModel.load()
        top = [move.uci() for move, _ in model.style_scores(chess.Board())[:3]]
        assert "e2e4" in top


class TestTraining:
    def test_analysis_cache_covers_every_decision(self):
        train_style = pytest.importorskip("train_style")
        if not train_style.CANDIDATES_PATH.exists():
            pytest.skip("engine analysis cache not built")
        corpus = load_corpus()
        cache = train_style.load_candidates()
        assert cache["meta"]["engine"], "the cache names the engine that made it"
        positions = cache["positions"]
        wanted = train_style.decisions(corpus)
        assert len(wanted) > 30000
        missing = [key for key, *_ in wanted if key not in positions]
        assert not missing, f"{len(missing)} decisions have no engine analysis, e.g. {missing[:3]}"
        key, start, stack, _ = wanted[100]
        board = chess.Board(start)
        for uci in stack:
            board.push_uci(uci)
        entry = positions[key]
        assert chess.Move.from_uci(entry["best"]) in board.legal_moves
        assert all(chess.Move.from_uci(uci) in board.legal_moves for uci in entry["moves"])

    def test_fitting_improves_on_the_engine_prior(self, corpus):
        """A short real training run must explain Fischer's choices better than 'play the engine move'."""
        train_style = pytest.importorskip("train_style")
        np = pytest.importorskip("numpy")
        if not train_style.CANDIDATES_PATH.exists():
            pytest.skip("engine analysis cache not built")
        samples, stats = train_style.build_samples(corpus[:10], train_style.load_candidates())
        assert len(samples) > 150 and stats["missing"] == 0
        start = np.zeros(N_FEATURES)
        for phase in range(3):
            start[phase * N_PHASE + ENGINE_LOSS] = -3.0
        before = train_style.score(start, samples)["nll"]
        weights = train_style.fit(samples, iterations=150)
        after = train_style.score(weights, samples)["nll"]
        assert after < before * 0.9, f"likelihood did not improve: {before:.1f} -> {after:.1f}"


class StubStyle(StyleModel):
    """A style model that insists on one particular move."""

    def __init__(self, favourite_uci, allowed=1000.0):
        super().__init__()
        self.favourite = favourite_uci
        self.allowed = allowed

    def style_scores(self, board):
        scored = [(m, 10.0 if m.uci() == self.favourite else 0.0) for m in board.legal_moves]
        scored.sort(key=lambda t: t[1], reverse=True)
        return scored

    def allowed_loss(self, phase, style_gain):
        return self.allowed if style_gain > 0 else -1.0


class TestBot:
    QUIET = "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 8"

    def test_book_move_comes_first(self):
        bot = FischerBot(time_budget_ms=300, seed=1)
        choice = bot.choose(chess.Board())
        assert choice.source == "book"
        assert choice.san in ("e4", "Nf3", "c4", "b3")
        assert "Fischer" in choice.book_citation

    def test_out_of_book_it_searches(self):
        bot = FischerBot(time_budget_ms=400)
        board = chess.Board(self.QUIET)
        choice = bot.choose(board)
        assert choice.move in board.legal_moves
        assert choice.source in ("search", "search+style")
        assert choice.depth >= 3 and choice.eval_cp is not None
        assert (choice.engine_san is not None) == (choice.source == "search+style")

    def test_style_never_overrides_tactics(self):
        """Even a style model that adores a blunder cannot make the bot play it."""
        fen = "r1bqkbnr/pppp1ppp/2n5/4p3/3Q4/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1"
        blunder = "d4e5"  # Qxe5+?? loses the queen to ...Nxe5
        bot = FischerBot(time_budget_ms=800, use_book=False, style_model=StubStyle(blunder))
        choice = bot.choose(chess.Board(fen))
        assert choice.move.uci() != blunder
        assert choice.source == "search"

    def test_style_picks_a_sound_alternative(self):
        """A stylistic favourite that is as good as the engine's move does get played."""
        board = chess.Board(self.QUIET)
        plain = FischerBot(time_budget_ms=600, max_depth=5, use_book=False, use_style=False)
        engine_move = plain.choose(board).move
        result = plain.engine.search(board, 600_000, 5)
        scores = plain.engine.candidates(board, result, 30)
        alternatives = sorted((result.score_cp - score, uci) for uci, score in scores.items()
                              if uci != engine_move.uci())
        assert alternatives, "a quiet developing position has more than one sound move"
        favourite = alternatives[0][1]   # the closest runner-up
        bot = FischerBot(time_budget_ms=3000, max_depth=5, use_book=False,
                         style_model=StubStyle(favourite))
        choice = bot.choose(board)
        assert choice.move.uci() == favourite
        assert choice.source == "search+style"
        assert choice.engine_san == board.san(engine_move)

    def test_style_margin_is_a_hard_cap(self):
        """With a zero margin a favourite that costs anything at all is refused."""
        board = chess.Board(self.QUIET)
        plain = FischerBot(time_budget_ms=600, max_depth=5, use_book=False, use_style=False)
        result = plain.engine.search(board, 600_000, 5)
        scores = plain.engine.candidates(board, result, 100)
        worse = [uci for uci, score in scores.items() if result.score_cp - score >= 30]
        if not worse:
            pytest.skip("no clearly inferior candidate in this position")
        bot = FischerBot(time_budget_ms=3000, max_depth=5, use_book=False,
                         style_margin_cp=0, style_model=StubStyle(worse[0]))
        assert bot.choose(board).move.uci() != worse[0]

    def test_style_margin_depends_on_the_phase(self):
        """Endgames punish small inaccuracies, so style gets less room there."""
        bot = FischerBot(time_budget_ms=100, use_book=False, use_style=False, style_margin_cp=40)
        assert [bot.style_margin(phase) for phase in range(3)] == [40, 40, 15]
        strict = FischerBot(time_budget_ms=100, use_book=False, use_style=False, style_margin_cp=10)
        assert [strict.style_margin(phase) for phase in range(3)] == [10, 10, 10]

    def test_whole_reply_stays_inside_the_time_budget(self):
        board = chess.Board(self.QUIET)
        bot = FischerBot(time_budget_ms=700, use_book=False)
        start = time.perf_counter()
        choice = bot.choose(board)
        elapsed = time.perf_counter() - start
        assert elapsed < 1.0, f"took {elapsed:.2f}s on a 0.7s budget (search + verification)"
        assert choice.time_ms <= 1000

    def test_game_over_is_an_error(self):
        mated = chess.Board("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1")
        with pytest.raises(ValueError):
            FischerBot(time_budget_ms=100).choose(mated)


@pytest.fixture(scope="module")
def client():
    from fischerbot.api import create_app
    app = create_app()
    app.testing = True
    return app.test_client()


class TestCommentary:
    """What the portrait says (web/static/data/commentary.json)."""

    @pytest.fixture
    def lines(self):
        import json
        path = Path(__file__).resolve().parent.parent / "web" / "static" / "data" / "commentary.json"
        document = json.loads(path.read_text(encoding="utf-8"))
        return [(category, line) for category, group in document["categories"].items() for line in group]

    def test_every_real_quotation_is_on_the_checked_list(self, lines):
        """Nothing is shown as Fischer's own words unless it was verified against its source."""
        import json
        record = Path(__file__).resolve().parent.parent / "data" / "fischer_quotes.json"
        checked = {q["text"]: q for q in json.loads(record.read_text(encoding="utf-8"))}
        quoted = [(category, line) for category, line in lines if "quote" in line]
        assert len(quoted) >= 15
        for category, line in quoted:
            assert line["text"] in checked, f"{category}: not a verified quotation: {line['text']!r}"
            assert line["quote"]["source"] == checked[line["text"]]["source"]
            assert line["quote"]["year"] == checked[line["text"]]["year"]
        for q in checked.values():
            assert q["evidence"] and q["source"] and 1955 <= q["year"] <= 1972

    def test_lines_are_short_and_fill_only_known_variables(self, lines):
        import re
        allowed = {"opponent", "year", "event", "game", "san", "n"}
        for category, line in lines:
            assert line["text"].strip() and len(line["text"]) <= 170, (category, line["text"])
            assert set(re.findall(r"\{(\w+)\}", line["text"])) <= allowed, (category, line["text"])
            assert line.get("mood", "neutral") in {"neutral", "pleased", "annoyed", "thinking", "surprised"}
            if "quote" in line:
                assert "{" not in line["text"], "a real quotation is never a template"

    def test_no_line_is_ahead_of_its_time(self, lines):
        """A line that mentions Reykjavik must not be said by the boy of 1956."""
        for category, line in lines:
            if "quote" in line or category.startswith("level_"):
                continue
            if any(word in line["text"] for word in ("Reykjavik", "title match", "my book")):
                assert line.get("since", 0) >= 1969, (category, line["text"])


class TestApi:
    def test_health(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        body = r.get_json()
        assert body["book_positions"] > 500
        assert body["style_model"] is True

    def test_index_page(self, client):
        r = client.get("/")
        assert r.status_code == 200
        html = r.get_data(as_text=True)
        assert "<title>FischerBot" in html
        assert "â€" not in html, "mis-encoded punctuation in the page"

    def test_first_move_is_book_with_citation(self, client):
        r = client.post("/api/move", json={"history": [], "difficulty": "easy"})
        assert r.status_code == 200
        data = r.get_json()
        assert data["source"] == "book"
        assert "book_citation" in data
        assert data["bot_move"] in ("e2e4", "g1f3", "c2c4", "b2b3")

    def test_search_reply_out_of_book(self, client):
        history = ["a2a3", "e7e5", "h2h3"]  # nothing Fischer ever faced
        r = client.post("/api/move", json={"history": history, "difficulty": "easy"})
        assert r.status_code == 200
        data = r.get_json()
        assert data["source"] in ("search", "search+style")
        assert data["status"] == "playing"
        assert data["depth"] >= 1 and isinstance(data["eval_cp"], int)
        assert ("engine_move_san" in data) == (data["source"] == "search+style")
        board = chess.Board()
        for uci in history + [data["bot_move"]]:
            board.push_uci(uci)   # raises if the bot's move were illegal
        assert data["fen"] == board.fen()
        assert sorted(data["legal_moves"]) == sorted(m.uci() for m in board.legal_moves)

    def test_illegal_history_rejected(self, client):
        r = client.post("/api/move", json={"history": ["e2e5"], "difficulty": "easy"})
        assert r.status_code == 400

    def test_missing_history_rejected(self, client):
        r = client.post("/api/move", json={})
        assert r.status_code == 400

    def test_unknown_difficulty_rejected(self, client):
        r = client.post("/api/move", json={"history": [], "difficulty": "impossible"})
        assert r.status_code == 400

    def test_levels_set_the_bot_in_a_year_of_his_career(self, client):
        """The web page's four Fischers: the book of 1956 holds only games he had played by then."""
        r = client.post("/api/move", json={"history": [], "level": "prodigy"})
        assert r.status_code == 200
        data = r.get_json()
        assert data["source"] == "book" and data["bot_move"] in ("e2e4", "g1f3")
        assert data["book"]["game"]["year"] <= 1956
        assert data["book"]["game"]["cite"] == data["book_citation"]
        assert data["book"]["count"] >= 10
        r = client.post("/api/move", json={"history": ["e2e4"], "level": "world"})
        assert r.get_json()["book"]["game"]["opponent"]
        assert client.post("/api/move", json={"history": [], "level": "impossible"}).status_code == 400

    def test_non_string_history_rejected(self, client):
        for bad in ([123], [None], [{}], ["e2e4", 5]):
            r = client.post("/api/move", json={"history": bad, "difficulty": "easy"})
            assert r.status_code == 400, f"history={bad!r} should be a 400"

    def test_oversized_history_rejected(self, client):
        r = client.post("/api/move", json={"history": ["e2e4"] * 2000, "difficulty": "easy"})
        assert r.status_code == 400

    def test_bodies_that_are_not_a_request_are_refused_politely(self, client):
        """Anything may be posted to a public address: none of it is the server's fault (a 500)."""
        for body in ('"x"', "5", "true", "null", "[]", "[" * 5000, '{"history": [], "level": ["world"]}',
                     '{"history": [], "level": {"a": 1}}', '{"history": [], "difficulty": ["easy"]}',
                     '{"history": [], "difficulty": 3}', "{not json", ""):
            r = client.post("/api/move", data=body, content_type="application/json")
            assert r.status_code == 400, f"{body[:40]!r} gave {r.status_code}"
            assert "error" in r.get_json()

    def test_a_huge_body_is_refused_unread(self, client):
        r = client.post("/api/move", data='{"history": [], "pad": "' + "x" * 200_000 + '"}',
                        content_type="application/json")
        assert r.status_code == 413
        assert r.get_json() == {"error": "Request too large"}
        longest = ["e2e4q"] * 1024      # the longest history accepted, at its widest
        r = client.post("/api/move", json={"history": longest, "level": "world"})
        assert r.status_code == 400 and "Illegal move" in r.get_json()["error"], "read, then judged on its moves"

    def test_the_pages_files_are_served_under_the_types_a_browser_requires(self):
        """ES modules, and "nosniff" on every reply: a script served as text/plain is a blank page.
        The operating system's opinion of .js (the Windows registry often says text/plain) must not matter."""
        import mimetypes
        from fischerbot.api import create_app
        mimetypes.add_type("text/plain", ".js")       # what a Windows machine may report
        try:
            app = create_app()
            app.testing = True
            c = app.test_client()
            expected = {
                "/static/js/app.js": "text/javascript",
                "/static/js/worker.js": "text/javascript",
                "/static/css/style.css": "text/css",
                "/static/data/style.json": "application/json",
                "/static/img/fischer.webp": "image/webp",
                "/static/img/fischer-192.png": "image/png",
                "/static/img/pieces/wK.svg": "image/svg+xml",
            }
            for url, content_type in expected.items():
                r = c.get(url)
                assert r.status_code == 200, url
                assert r.headers["Content-Type"].split(";")[0] == content_type, url
                assert r.headers["X-Content-Type-Options"] == "nosniff"
                r.close()
        finally:
            mimetypes.add_type("text/javascript", ".js")

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

    def test_underpromotion_in_history_is_accepted(self, client):
        """The web client can now promote to any piece."""
        history = ["e2e4", "d7d5", "e4d5", "c7c6", "d5c6", "g8f6", "c6b7", "f6d5", "b7a8n"]
        r = client.post("/api/move", json={"history": history, "difficulty": "easy"})
        assert r.status_code == 200
        assert r.get_json()["bot_move"]
