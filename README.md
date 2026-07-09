# FischerBot

A chess bot that plays in the style of Bobby Fischer, built from his real games:
all 60 games of **My 60 Memorable Games** and all 21 games of the
**1972 World Championship** match against Boris Spassky.

## How it plays

1. **Opening book from Fischer's actual games.** Positions are keyed by board
   state (transposition-aware), and only moves *Fischer himself* played are in
   the book — weighted by frequency and results. Every book move comes with a
   citation, e.g. *"Fischer–Spassky, World Championship 1972, Game 6"*.
2. **A real search engine.** Negamax alpha-beta with iterative deepening, a
   transposition table with bound flags, null-move pruning, killer/history
   move ordering, quiescence search, and a hard per-move time budget.
3. **A trained style model.** A conditional-logit move ranker trained on the
   ~3,200 moves Fischer played in the corpus (real gradients, game-level
   held-out validation; top-3 accuracy ≈ 40% vs 5% random baseline). When
   several moves are near-equal, the bot plays the most Fischer-like one —
   each candidate is first verified by a null-window search so style never
   costs more than a configurable margin (default 0.3 pawns).

## Quick start

```bash
pip install -r requirements.txt
python app.py          # -> http://127.0.0.1:5000
```

Play in the browser: choose your color and difficulty, and watch the book
citations as the bot follows Fischer's real games.

## API

The API is stateless — the client sends the full move history each request,
so it works identically on a laptop or serverless hosting.

```
POST /api/move
{"history": ["e2e4", "e7e5"], "difficulty": "easy" | "medium" | "hard"}

-> {"bot_move": "g1f3", "bot_move_san": "Nf3", "source": "book",
    "book_citation": "Fischer–...", "fen": "...", "status": "playing", ...}
```

## Development

```bash
python -m pytest tests -q       # engine/book/style/API test suite
python train_style.py           # retrain the style model (models/style.json)
```

Project layout:

```
fischerbot/
├── engine.py      # negamax alpha-beta search
├── evaluation.py  # tapered positional evaluation
├── book.py        # opening book from the real games (with citations)
├── style.py       # Fischer style model (conditional logit)
├── dataset.py     # corpus loading (data/m60mg.pgn, data/wc1972.pgn)
├── bot.py         # book -> search -> style selection
└── api.py         # stateless Flask API
data/              # the real PGNs (validated: zero illegal moves)
models/style.json  # trained style weights (JSON, human-readable)
web/               # browser UI
tests/             # pytest suite
```

## Requirements

- Python 3.9+
- python-chess ≥ 1.10, Flask ≥ 2.3, NumPy ≥ 1.24

## License

MIT
