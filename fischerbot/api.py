"""Stateless Flask API.

The client owns game state and sends the full UCI move history with every
request; the server replays it onto a fresh board. This works identically
on a laptop and on serverless hosting (no in-memory session store to lose).
"""

import threading
from pathlib import Path

import chess
from flask import Flask, jsonify, request

from .bot import FischerBot

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

DIFFICULTIES = {
    "easy": {"time_budget_ms": 700, "max_depth": 3, "style_margin_cp": 60},
    "medium": {"time_budget_ms": 2500, "max_depth": 64, "style_margin_cp": 30},
    "hard": {"time_budget_ms": 6000, "max_depth": 64, "style_margin_cp": 20},
}

MAX_HISTORY = 1024  # longest legal chess games are far below this

_bots = {}
_bots_guard = threading.Lock()


def _get_bot(difficulty: str):
    """One (bot, lock) per difficulty so the transposition table persists.

    The engine holds mutable search state (deadline, killers, TT), so each
    bot instance must serve one request at a time.
    """
    with _bots_guard:
        if difficulty not in _bots:
            cfg = DIFFICULTIES.get(difficulty, DIFFICULTIES["medium"])
            _bots[difficulty] = (FischerBot(**cfg), threading.Lock())
        return _bots[difficulty]


def _replay(history) -> chess.Board:
    if len(history) > MAX_HISTORY:
        raise ValueError(f"History too long ({len(history)} > {MAX_HISTORY})")
    board = chess.Board()
    for i, uci in enumerate(history):
        if not isinstance(uci, str) or not 4 <= len(uci) <= 5:
            raise ValueError(f"Malformed move at index {i}")
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            raise ValueError(f"Malformed move at index {i}: {uci!r}")
        if move not in board.legal_moves:
            raise ValueError(f"Illegal move at index {i}: {uci!r}")
        board.push(move)
    return board


def _status(board: chess.Board) -> str:
    if board.is_checkmate():
        return "checkmate_black" if board.turn == chess.WHITE else "checkmate_white"
    if board.is_stalemate():
        return "stalemate"
    if board.is_insufficient_material():
        return "insufficient_material"
    if board.can_claim_fifty_moves():
        return "fifty_moves"
    if board.can_claim_threefold_repetition():
        return "repetition"
    return "playing"


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder=str(WEB_DIR / "static"),
        static_url_path="/static",
    )

    @app.get("/")
    def index():
        return (WEB_DIR / "index.html").read_text(encoding="utf-8")

    @app.after_request
    def security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src https://fonts.gstatic.com; "
            "img-src 'self' data:; connect-src 'self'; "
            "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

    @app.get("/api/health")
    def health():
        bot, _ = _get_bot("medium")
        return jsonify({
            "status": "healthy",
            "book_positions": bot.book.size if bot.book else 0,
            "style_model": bot.style is not None,
        })

    @app.post("/api/move")
    def move():
        data = request.get_json(silent=True) or {}
        history = data.get("history")
        if not isinstance(history, list):
            return jsonify({"error": "Body must include 'history': list of UCI moves"}), 400
        difficulty = data.get("difficulty", "medium")
        if difficulty not in DIFFICULTIES:
            return jsonify({"error": f"Unknown difficulty {difficulty!r}"}), 400

        try:
            board = _replay(history)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        if board.is_game_over(claim_draw=True):
            return jsonify({
                "fen": board.fen(),
                "status": _status(board),
                "bot_move": None,
                "legal_moves": [],
            })

        bot, lock = _get_bot(difficulty)
        with lock:
            choice = bot.choose(board)
        board.push(choice.move)

        payload = {
            "bot_move": choice.move.uci(),
            "bot_move_san": choice.san,
            "source": choice.source,
            "fen": board.fen(),
            "status": _status(board),
            "legal_moves": [m.uci() for m in board.legal_moves],
        }
        if choice.book_citation:
            payload["book_citation"] = choice.book_citation
        if choice.eval_cp is not None:
            payload["eval_cp"] = choice.eval_cp
            payload["depth"] = choice.depth
            payload["nodes"] = choice.nodes
            payload["time_ms"] = choice.time_ms
            payload["pv"] = choice.pv
        return jsonify(payload)

    @app.errorhandler(404)
    def not_found(_e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(500)
    def internal(_e):
        return jsonify({"error": "Internal server error"}), 500

    return app
