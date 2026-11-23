"""Vercel serverless entry point: every request is routed into the Flask app.

vercel.json sends every path to this one function as /api/index?__path=/<the
path that was asked for>; the app puts that path back before routing (see
OriginalPath in fischerbot/api.py).
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fischerbot.api import create_app  # noqa: E402

app = create_app()
