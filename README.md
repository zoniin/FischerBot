# FischerBot

A chess bot that plays in the style of Bobby Fischer, built only from his real
games: the 60 games of **My 60 Memorable Games** and the 20 games played in
the **1972 World Championship** match against Boris Spassky.

## How it plays

1. **Opening book from Fischer's actual games.** Positions are keyed by board
   state (transposition-aware), and only moves *Fischer himself* played are in
   the book — weighted by frequency and by how the game went. Every book move
   comes with a citation, e.g. *"Fischer–Spassky, World Championship 1972,
   Game 6"*. If you follow one of his games, the bot replays his first twenty
   moves of it.
2. **A real search engine.** Principal-variation alpha-beta with iterative
   deepening, a transposition table, null-move and futility pruning, late-move
   reductions, staged move generation with static exchange evaluation, a
   quiescence search that handles checks, and repetition detection — on top of
   an evaluation that knows pawn structure, mobility, king safety and how to
   mate a bare king. The whole reply stays inside a hard time budget.
3. **A style model trained on his games.** For each of Fischer's 3,270
   decisions in the corpus the engine lists the moves that are *sound* (within
   about half a pawn of its favourite); a conditional-logit model then learns
   which of those he actually chose. The engine's own verdict is one of the
   features, so the model also learns what a stylistic preference is worth in
   centipawns. At the board, the most Fischer-like move replaces the engine's
   choice only if a full-depth search, confirmed one ply deeper, proves it
   costs less than that — and never more than a fixed cap (0.4 pawns at
   medium difficulty, 0.15 in endgames). Style never overrides tactics.

## How Fischer-like is it?

Measured, not asserted. The yardstick is simple: take positions from games
the bot's style model has **never seen**, let the bot think, and count how
often it plays the move Fischer played. Twelve games (356 positions from
move 9 on) are held out for this; the book is switched off so the bot has to
find every move itself. Stockfish 16 then judges how much each move gives
away.

| "Medium" difficulty, 2.5 s per move | v2.0 | **v2.1** |
| --- | ---: | ---: |
| Plays Fischer's move | 44.9% | **about 54%** |
| Average loss per move (centipawns) | 53 | **29** |
| Moves that drop a pawn or more | 16% | **8%** |
| Moves that drop three pawns or more | 3.9% | **0.6%** |
| Search depth reached | 5.3 | **9.8** |
| Average / longest reply | 2.2 s / 2.8 s | **1.8 s / 2.5 s** |

The v2.1 figures are averages over repeated runs. A search that stops on the
clock does not play exactly the same moves twice, and on 356 positions that
shows: five runs of this search agreed with Fischer between 52% and 58% of
the time — the two runs of the released build were at the low end, 52% and
53% — while v2.0 gave 44.9% both times it was run.

For scale: Stockfish's own first choice is Fischer's move in 66% of these
positions, and Fischer himself gives up 19 centipawns a move by Stockfish's
reckoning. A stronger engine is a more Fischer-like engine — he simply played
very good moves — which is why most of the gain comes from the search.

What the style model adds is measured separately, by cross-validation over
whole games (train on 70, test on the other 10, eight times over):

| Fischer's move chosen (held-out games) | Engine alone | Engine + style |
| --- | ---: | ---: |
| All 3,270 decisions | 47.4% | **50.5%** |
| Opening (first 12 moves) | 37.2% | **48.1%** |
| Middlegame | 46.3% | 48.5% |
| Endgame | 47.6% | 47.7% |

It changes the engine's move in about one position in nine, at an average
cost of under one centipawn, and helped in all eight folds. Its value is
mostly in the opening: once the game leaves the book, the bot still develops
the way Fischer did. In v2.0 the style layer made the bot *less* like Fischer
(44.9% against 48.0% for its own engine) and tripled its serious blunders,
because it was trained on all legal moves and verified only shallowly.

Some of what it learned, read straight from `models/style.json`:

* as White: `e4`, then the Ruy Lopez bishop tour (`Ba4`, `Bc2`) and `Re1`;
* as Black: `...g6`, `...Bg7`, `...Nf6`, `...d6`, `...c5` — the King's Indian
  and the Najdorf;
* knights before bishops, pawn storms toward the enemy king, no early checks;
* in the endgame, the king walks to the centre.

## How strong is it?

All at one second per move, with the book switched off so that every move
is the bot's own:

* **Against v2.0:** 39 wins, 1 draw, no losses in 40 games.
* **Against Stockfish 16 held to a fixed rating** (`UCI_LimitStrength`,
  Stockfish also thinking for a second), 12 games per level:

  | Stockfish level | v2.0 scored | v2.1 scored |
  | --- | ---: | ---: |
  | 1320 | 29% | |
  | 1500 | 58% | |
  | 1900 | | 58% |
  | 2100 | | 63% |

Twelve games a level is a small sample, so read it loosely: v2.0 played at
about 1400 on Stockfish's scale and v2.1 plays at about 2000 — strong club
player territory, and roughly 600 points better than before. It is still a
pure-Python engine searching some 25,000 positions a second, nowhere near
Fischer's own 2785.

## Quick start

```bash
pip install -r requirements.txt
python app.py          # -> http://127.0.0.1:5000
```

Play in the browser: choose your colour and difficulty, and watch the book
citations as the bot follows Fischer's real games. Out of book, the panel
shows the search depth and evaluation, and says so when the move was a
style choice.

## API

The API is stateless — the client sends the full move history each request,
so it works identically on a laptop or serverless hosting.

```
POST /api/move
{"history": ["e2e4", "e7e5"], "difficulty": "easy" | "medium" | "hard"}

-> {"bot_move": "g1f3", "bot_move_san": "Nf3", "source": "book",
    "book_citation": "Fischer–...", "fen": "...", "status": "playing", ...}
```

`source` is `book`, `search`, or `search+style`. Search replies add `eval_cp`,
`depth`, `nodes`, `time_ms` and `pv`; a style choice also reports
`engine_move_san`, the move it was preferred to.

| Difficulty | Time budget | Search | Most it gives up for style |
| --- | --- | --- | --- |
| easy | 0.7 s | 3 plies | 0.6 pawns |
| medium | 2.5 s | as deep as time allows | 0.4 pawns |
| hard | 6 s | as deep as time allows | 0.3 pawns |

The time budget covers the whole reply — search and style verification —
and the search usually stops early, so replies average well under it.

## Development

```bash
python -m pytest tests -q       # 93 tests: engine, evaluation, data, book, style, bot, API
python train_style.py           # retrain the style model from the cached engine analysis
python train_style.py --analyse # redo the engine analysis first (about 50 minutes on 4 cores)
```

`train_style.py` prints the cross-validation table above before it saves
anything. Re-run it with `--analyse` after changing the engine or the
evaluation, because the analysis in `data/engine_candidates.json.gz` is the
engine's opinion of every position.

The engine can be run with every pruning heuristic switched off
(`Engine(selective=False)`); the test suite checks that mode move-for-move
against a textbook minimax, and checks the evaluation is exactly symmetric
between the colours.

Project layout:

```
fischerbot/
├── engine.py      # alpha-beta search
├── evaluation.py  # tapered positional evaluation
├── book.py        # opening book from the real games (with citations)
├── style.py       # Fischer style model (features + conditional logit)
├── dataset.py     # corpus loading
├── bot.py         # book -> search -> style selection
└── api.py         # stateless Flask API
data/              # the real PGNs + cached engine analysis (see data/README.md)
models/style.json  # trained style weights (JSON, human-readable)
train_style.py     # engine analysis, training, cross-validation
web/               # browser UI
tests/             # pytest suite
```

## The games

`data/README.md` documents where the 80 games came from and what was fixed:
the source transcription of *My 60 Memorable Games* left five games
unfinished and recorded no results. All 80 are now complete, with results
that match the historical record (+55 =20 −5), and every move is checked for
legality by the tests.

## Limits, honestly

* **Eighty games is a small sample.** It is enough to learn Fischer's
  openings and a few habits; it is not enough to learn how he *thought*.
  Outside the opening the style model adds only a point or two.
* **Strength is the bottleneck.** Stockfish agrees with Fischer far more
  often than this engine does. Python caps the search at around ten plies in
  the time a web request allows.
* **The book is only as wide as the corpus.** He usually meets 1.e4 with
  the Sicilian and 1.d4 with the King's Indian, Grünfeld or Nimzo-Indian,
  because those are in the 80 games; lines he played elsewhere are not.

## Requirements

- Python 3.9+
- python-chess ≥ 1.10, Flask ≥ 2.3 (NumPy ≥ 1.24 and pytest for training and tests)

## License

MIT. The piece-square tables in `fischerbot/evaluation.py` are PeSTO's, by
Ronald Friederich.
