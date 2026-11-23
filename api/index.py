"""Vercel serverless entry point: every request is routed into the Flask app.

vercel.json sends every path to this one function as /api/index?__path=/<the
path that was asked for>, because the function itself is reached at
/api/index and would otherwise see that path, not the visitor's. The small
wrapper below puts the visitor's path back before Flask routes the request.
(Where the platform already passes the original path, it changes nothing.)
"""

import sys
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fischerbot.api import create_app  # noqa: E402

ENTRY_PATHS = {"/api/index", "/api/index.py", "/api"}
PATH_PARAM = "__path"


class OriginalPath:
    """WSGI middleware: restore the requested path from the rewrite's query parameter."""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        if environ.get("PATH_INFO", "") in ENTRY_PATHS:
            pairs = parse_qsl(environ.get("QUERY_STRING", ""), keep_blank_values=True)
            asked = [value for key, value in pairs if key == PATH_PARAM]
            if asked:
                path = "/" + unquote(asked[0]).lstrip("/")
                environ["PATH_INFO"] = path
                environ["QUERY_STRING"] = urlencode([(k, v) for k, v in pairs if k != PATH_PARAM])
        return self.wsgi_app(environ, start_response)


app = create_app()
app.wsgi_app = OriginalPath(app.wsgi_app)
