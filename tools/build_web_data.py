"""Build the data files the browser loads.

    python tools/build_web_data.py

Writes web/static/data/book.json from the PGNs in data/. (The other files in
that directory are written elsewhere: style.json by train_style.py,
commentary.json by hand.) Re-run it whenever the games or fischerbot/book.py
change; a test fails if the saved book is stale.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from fischerbot.book import BOOK_PATH, OpeningBook  # noqa: E402
from fischerbot.dataset import load_corpus  # noqa: E402


def book_document() -> str:
    """The book exactly as it is saved (compact, stable ordering)."""
    return json.dumps(OpeningBook(load_corpus()).to_json(), separators=(",", ":"), ensure_ascii=False) + "\n"


def main():
    BOOK_PATH.parent.mkdir(parents=True, exist_ok=True)
    document = book_document()
    BOOK_PATH.write_text(document, encoding="utf-8", newline="\n")
    data = json.loads(document)
    print(f"wrote {BOOK_PATH.relative_to(ROOT)}: {len(document) // 1024} KB, {len(data['games'])} games, "
          f"{len(data['positions'])} positions with his moves, {len(data['replies'])} with his opponents'")


if __name__ == "__main__":
    main()
