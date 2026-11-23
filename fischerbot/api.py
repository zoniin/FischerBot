"""Stateless Flask API.

The client owns game state and sends the full UCI move history with every
request; the server replays it onto a fresh board. This works identically
on a laptop and on serverless hosting (no in-memory session store to lose).
"""

import mimetypes
import threading
from pathlib import Path

import chess
from flask import Flask, jsonify, request

from .bot import FischerBot

WEB_DIR = Path(__file__).resolve().parent.parent / "web"

# time_budget_ms bounds the whole reply (search plus style verification).
# It is also what one request can cost the server, and anyone can send one:
# no setting thinks for more than four seconds.
# style_margin_cp caps what a Fischer-like move may cost against the engine's
# first choice; the style model usually asks for much less.
DIFFICULTIES = {
    "easy": {"time_budget_ms": 700, "max_depth": 3, "style_margin_cp": 60},
    "medium": {"time_budget_ms": 2500, "max_depth": 64, "style_margin_cp": 40},
    "hard": {"time_budget_ms": 4000, "max_depth": 64, "style_margin_cp": 30},
}

# The four Fischers of the web page (LEVELS in web/static/js/bot.js). The
# browser normally plays them itself, with its own much faster engine; these
# are what the server answers with when it cannot. `book_year` limits the
# opening book to the games he had played by then.
LEVELS = {
    "prodigy": {"time_budget_ms": 1500, "max_depth": 4, "style_margin_cp": 60, "book_year": 1956},
    "grandmaster": {"time_budget_ms": 2500, "max_depth": 7, "style_margin_cp": 50, "book_year": 1958},
    "champion": {"time_budget_ms": 3000, "max_depth": 64, "style_margin_cp": 40, "book_year": 1963},
    "world": {"time_budget_ms": 4000, "max_depth": 64, "style_margin_cp": 30,
              "book_year": 1972, "book_later": True},
}
_SETTINGS = {**DIFFICULTIES, **LEVELS}

# Requests for one setting take turns at its bot. One that has waited this
# long is told the server is busy, rather than left in a queue of any length.
BUSY_WAIT_S = 8.0

# The portrait, the pieces and the typeface may be kept by a browser for a
# day; scripts, styles and data are checked against the server on every
# visit, so that a page is never assembled from two versions of the site.
KEPT_PATHS = ("/static/img/", "/static/fonts/")
KEPT_MAX_AGE_S = 24 * 60 * 60

MAX_HISTORY = 1024  # longest legal chess games are far below this
MAX_BODY_BYTES = 64 * 1024  # a history of MAX_HISTORY moves is under 10 kB of JSON

# The page is made of ES modules, and every reply says "nosniff": a browser
# refuses a script or a stylesheet served under the wrong type. Python asks
# the operating system for these types where it can - the Windows registry
# often has .js as text/plain, and Pythons before 3.11 do not know .webp - so
# the types of the files the page loads are stated here.
STATIC_TYPES = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
}

_bots = {}
_bots_guard = threading.Lock()


def _get_bot(setting: str):
    """One (bot, lock) per difficulty or level so the transposition table persists.

    The engine holds mutable search state (deadline, killers, TT), so each
    bot instance must serve one request at a time.
    """
    with _bots_guard:
        if setting not in _bots:
            cfg = _SETTINGS.get(setting, DIFFICULTIES["medium"])
            _bots[setting] = (FischerBot(**cfg), threading.Lock())
        return _bots[setting]


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
    for extension, content_type in STATIC_TYPES.items():
        mimetypes.add_type(content_type, extension)

    app = Flask(
        __name__,
        static_folder=str(WEB_DIR / "static"),
        static_url_path="/static",
    )
    app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES

    @app.get("/")
    def index():
        return (WEB_DIR / "index.html").read_text(encoding="utf-8")

    @app.after_request
    def security_headers(response):
        # Everything the page loads comes from the site itself: its scripts
        # (ES modules and the worker), stylesheets, typeface, images and data.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; style-src 'self'; font-src 'self'; "
            "img-src 'self'; connect-src 'self'; "
            "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if request.path.startswith(KEPT_PATHS) and response.status_code == 200:
            response.cache_control.no_cache = None
            response.cache_control.public = True
            response.cache_control.max_age = KEPT_MAX_AGE_S
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
        try:
            data = request.get_json(silent=True)
        except RecursionError:  # brackets nested thousands deep
            data = None
        if not isinstance(data, dict):
            data = {}
        history = data.get("history")
        if not isinstance(history, list):
            return jsonify({"error": "Body must include 'history': list of UCI moves"}), 400
        level = data.get("level")
        if level is not None:
            if not isinstance(level, str) or level not in LEVELS:
                return jsonify({"error": "Unknown level"}), 400
            setting = level
        else:
            setting = data.get("difficulty", "medium")
            if not isinstance(setting, str) or setting not in DIFFICULTIES:
                return jsonify({"error": "Unknown difficulty"}), 400

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

        bot, lock = _get_bot(setting)
        if not lock.acquire(timeout=BUSY_WAIT_S):
            return jsonify({"error": "The server is busy. Try again in a moment."}), 503
        try:
            choice = bot.choose(board)
        finally:
            lock.release()
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
        if choice.book_move is not None:
            # the game cited first, as the web page's book describes it, and how
            # many of his games reached this move
            payload["book"] = {"game": choice.book_move.games[0].to_json(),
                               "count": choice.book_move.count}
        if choice.eval_cp is not None:
            payload["eval_cp"] = choice.eval_cp
            payload["depth"] = choice.depth
            payload["nodes"] = choice.nodes
            payload["time_ms"] = choice.time_ms
            payload["pv"] = choice.pv
        if choice.engine_san:
            payload["engine_move_san"] = choice.engine_san  # what the style choice replaced
        return jsonify(payload)

    @app.errorhandler(404)
    def not_found(_e):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(413)
    def too_large(_e):
        return jsonify({"error": "Request too large"}), 413

    @app.errorhandler(500)
    def internal(_e):
        return jsonify({"error": "Internal server error"}), 500

    return app
