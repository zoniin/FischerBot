"""Vercel serverless entry point: every request is routed into the Flask app."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fischerbot.api import create_app

app = create_app()
