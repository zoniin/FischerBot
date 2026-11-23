# FischerBot

<img src="web/static/img/fischer-wide.webp" alt="The portrait of Bobby Fischer used on the page" width="230" align="right">

A chess opponent that plays like Bobby Fischer and runs in your browser.

It is built from 731 of his real games. In the opening it plays the moves he
actually played and tells you which game they come from. After that it
thinks for itself with its own chess engine, and where several moves are
sound it prefers the one that a model trained on his games finds most like
him. He sits above the board and talks while you play — now and then in his
own words.

```bash
pip install -r requirements.txt
python app.py          # -> http://127.0.0.1:5000
```

## Four Fischers

You choose which one you face. Each plays the openings he knew *then* — the
boy of 1956 has only the games he had played by 1956 — and each is about as
strong as he was: his first published rating, in May 1956, was 1726, a year
later he was a master at 2231, in 1958 a grandmaster, and in 1972 he was
rated 2785.

| | Year | His book | Thinks | Plays at |
| --- | --- | --- | --- | --- |
| **Bobby, age 13** | 1956 | games to 1956 | 6 plies | about 2100 |
| **Grandmaster at 15** | 1958 | games to 1958 | 10 plies | about 2400 |
| **U.S. Champion, 11–0** | 1963 | games to 1963 | 12 plies | about 2650 |
| **World Champion** | 1972 | every game he played | 2.5 seconds, about 20 plies | about 2800 |

The ratings are estimates from matches against Stockfish 16 held to a fixed
rating — see [How strong is it?](#how-strong-is-it). None of the four is an
easy game, and that is deliberate: he never was.

## How it plays

1. **His own openings.** A book of every position from the first twenty
   moves of his games, with the move he played there and the game it is
   from: *"Fischer–Spassky, World Championship 1972, Game 6"*. Moves are
   weighted by how often he played them, how the games went and how recently
   he had played them at the level's date. The book also knows what his
   opponents played, so he can tell you when you are following one of his
   games and when you have left it.
2. **A chess engine in the browser.** `web/static/js/engine.js` is a
   principal-variation search with a transposition table, null move,
   late-move reductions, futility pruning and a quiescence search, over a
   tapered evaluation (material, piece-square tables, pawn structure,
   mobility, king safety, endgame knowledge). It runs in a Web Worker at
   about a million positions a second, so the page never waits for a server.
3. **A style model trained on his games.** For each of his 30,270 decisions
   the engine listed the moves that were *sound* — within about half a pawn
   of its favourite. A conditional-logit model then learned which of those he
   chose. The engine's own verdict is one of its features, so it also learned
   what a preference is worth in centipawns. At the board the most
   Fischer-like move replaces the engine's choice only if a search of that
   move, confirmed one ply deeper, shows it costs less than that — never more
   than 0.3 to 0.6 pawns depending on the level, and 0.15 in endgames. Style
   never overrides tactics.

The same three steps exist in Python (`fischerbot/`), where the book and the
model are built and trained, and where the server can answer for the browser
if the worker cannot start.

## What he says

A portrait with a speech bubble sits above the board. He speaks at the start,
when a move comes from one of his games ("I played this against Larsen at
Portorož"), when you follow or leave that game, when an opening is on the
board, when somebody blunders, when he sees mate, and at the end — otherwise
only now and then, and never the same line twice in a game. A blunder also
gets a red **??** on its square, and his verdicts on your moves are in the
scoresheet.

There are 637 lines in `web/static/data/commentary.json`. Almost all were
written for the bot, in the voice of Fischer at the board: terse, exacting,
about the moves and nothing else. **Eighteen are his own words**, shown as
quotations with their source — "Best by test." after 1.e4; "The only trouble
with the move, however, is that it loses." Each was checked against the text
before it went in; `data/fischer_quotes.json` is the record, and a test
refuses any line presented as a quotation that is not in it.

## How Fischer-like is it?

Measured, not asserted, and always on games the model has not seen
(cross-validation over whole games: train on seven eighths, test on the
rest, eight times). The question each time: among the moves the engine
considers sound, is the one chosen the one Fischer played?

| Fischer's move chosen | Engine alone | Engine + style |
| --- | ---: | ---: |
| All 30,270 decisions | 48.4% | **51.1%** |
| Opening | 41.4% | **49.7%** |
| Middlegame | 45.7% | 47.3% |
| Endgame | 48.7% | 50.0% |

(The rows by phase count the 21,210 decisions where more than one move was
playable. This is the engine at 100,000 positions a move, the depth it was
analysed at.) Style changed the engine's move in one such position in seven,
at an average cost of under one centipawn, and helped in all eight folds.

A second check asks the whole bot, at full strength, for its move in 320
positions from move 9 onward, taken from 92 games that a model fitted for the
purpose had never seen (opening book off, 2.5 seconds a move, about 23
plies). It played Fischer's move in **58.8%** of them. The engine alone
scored 59.4%: at that depth the style model changed only 16 of the 320 moves,
and a difference of two positions is noise — so at the top level, outside the
opening, style neither helps nor hurts. For scale, on a similar test of the
earlier Python version of this bot (356 positions from other games) the bot
scored about 54% and Stockfish 16 itself 66%.

Most of what makes a move Fischer's is simply that it is a very good move,
which is why the engine matters more than the style model; the model's own
contribution is largest in the opening, where it keeps the bot developing
the way he did once the book runs out. Some of what it learned, read
straight from `web/static/data/style.json`: knights before bishops, no early
checks, rooks to the seventh rank and to half-open files, pieces toward the
enemy king in the middlegame, and in the endgame the king walks to the
centre.

## How strong is it?

Against Stockfish 16 held to a fixed rating (`UCI_LimitStrength`, 0.2–0.3
seconds a move), starting from the initial position with the book on:

| Level | Stockfish held to | Games | Score |
| --- | ---: | ---: | --- |
| Bobby, age 13 | 1900 | 20 | 72.5% (+13 =3 −4) |
| | 2100 | 20 | 52.5% (+8 =5 −7) |
| Grandmaster at 15 | 2300 | 20 | 60.0% (+10 =4 −6) |
| | 2500 | 20 | 42.5% (+5 =7 −8) |
| U.S. Champion | 2200 | 16 | 87.5% (+12 =4 −0) |
| | 2500 | 16 | 71.9% (+10 =3 −3) |
| | 2700 | 16 | 43.8% (+3 =8 −5) |
| World Champion | 2500 | 12 | 100% (+12 =0 −0) |
| | 2800 | 12 | 50.0% (+5 =2 −5) |

Treat these as rough: a few dozen games a level, and Stockfish's rating
scale assumes a slower game than this, so its numbers flatter the bot
somewhat. What can be said plainly is that the levels are well apart and
that the top one is far stronger than the earlier, Python version of this
bot (about 2000 on the same scale, searching 25,000 positions a second).

About the engine itself, measured in Node on a four-core machine: a million
positions a second; fifteen or sixteen plies in a tenth of a second from a
typical middlegame; exact move counts on every reference position; it wins
K+Q, K+R, K+B+B and K+B+N against its own best defence and knows that K+N+N
does not win.

## Running and deploying

`python app.py` serves the page, its files and one fallback endpoint. All
the play happens in the browser.

```
POST /api/move
{"history": ["e2e4", "e7e5"], "level": "prodigy" | "grandmaster" | "champion" | "world"}

-> {"bot_move": "g1f3", "bot_move_san": "Nf3", "source": "book",
    "book_citation": "Fischer–...", "book": {"game": {...}, "count": 104},
    "fen": "...", "status": "playing", ...}
```

The endpoint is stateless (the client sends the whole game each time) and is
used only when the Web Worker cannot start. It runs the Python engine, which
is much weaker. It has no rate limit: a request can cost the server up to
four seconds of thinking, requests for one level take turns, and one that
would wait too long is told the server is busy. The repository deploys to
Vercel as it is (`api/index.py`).

## Development

```bash
python -m pytest tests -q            # the Python side: data, book, style, bot, API, commentary
node --test web/tests/*.test.js      # the browser side: rules, engine, book, style, bot, board, page logic
```

The JavaScript is plain ES modules — no dependencies, no build step — and the
pure modules run unchanged in Node, which is how they are tested. The rules
library, the book, the style features and the bot are each checked against
their Python counterparts (python-chess is the oracle for the rules) through
fixtures written by `tools/make_fixtures.py`.

```bash
python tools/build_career.py DOWNLOADED.pgn   # rebuild data/career.pgn from a fresh download
python tools/build_web_data.py                # the opening book the browser loads
python train_style.py --analyse               # engine analysis of every decision (about an hour), then training
python train_style.py                         # retrain from the cached analysis
python tools/make_fixtures.py                 # reference answers for the JavaScript tests
node web/tools/uci.js                         # the engine - or a whole level - as a UCI engine
```

```
web/
  index.html
  static/js/      rules.js      the rules of chess
                  engine.js     the search engine
                  book.js, style.js, bot.js, worker.js    the bot, in a Web Worker
                  board.js      the board
                  app.js, opponent.js, chooser.js, commentary.js, events.js, ...   the page
  static/data/    book.json, style.json, commentary.json
  static/img/     the portrait (see its README for where it is from), the pieces
  static/fonts/   the typeface, with its licence
  tests/, tools/
fischerbot/       the same bot in Python: dataset, book, engine, style, bot, API
data/             the games, the cached analysis, the record of quotations (see data/README.md)
tools/            data preparation and fixtures
train_style.py    analysis, training, cross-validation
tests/            pytest suite
```

## The games

`data/README.md` documents where the 731 games came from and what was fixed:
the 60 of *My 60 Memorable Games* (five of them completed and all given
their results, against an independent source), the 20 played games of the
1972 match, and 651 other tournament and match games from 1955 to 1992.
Blitz, simultaneous and casual games are left out. His record across them:
+407 =241 −83.

## Credits

* The portrait is the one the owner of this project chose: an avatar of
  Fischer from a TikTok post, enlarged, sharpened and coloured for the page.
  Its author is not known to us; `web/static/img/README.md` says what was
  done to it and how its author can ask for credit or removal.
* The chess pieces are Colin M.L. Burnett's "cburnett" set, drawn for
  Wikipedia and used under the BSD licence
  (`web/static/img/pieces/LICENSE.txt`).
* The game scores are public record; the files they were taken from are
  PGN Mentor's collection of Fischer's games and of the 1972 match, and the
  Lichess study "All Variations of My 60 Memorable Games" (moves and results
  only - none of the book's text). `data/README.md` has the details.
* The typeface is Playfair Display, by Claus Eggers Sørensen and the Playfair
  Display Project Authors, under the SIL Open Font License; the site serves
  its own copy (`web/static/fonts`), and asks nothing of any other host.
* The piece-square tables in both engines are PeSTO's, by Ronald Friederich.
* python-chess is used for data preparation, training and as the reference
  the JavaScript rules are tested against.

## Limits, honestly

* **It is not Fischer.** It plays his openings and leans his way among good
  moves; it does not plan as he did. On unseen games it finds his move a
  little more than half the time.
* **The style model's share is modest** outside the opening: a point or two
  in the middlegame and endgame at analysis depth, even with 731 games, and
  nothing measurable at the top level's full depth.
* **The ratings are estimates** from short matches against a rating-limited
  engine, not from play against people.
* **The younger Fischers are weakened by searching less**, which makes them
  miss tactics the way a computer does, not the way a boy of thirteen did.
* **There is no easy level.** The weakest plays at about 2100.
* **The portrait is not ours** and has been heavily processed: it was
  rebuilt from a copy about 70 pixels wide, so the detail of the face is a
  network's reconstruction, and its colours are invented.
* **What he says is mostly not what he said.** Only the lines marked as his
  own words are quotations.

## Requirements

- A current browser to play.
- Python 3.10+ with python-chess ≥ 1.10 and Flask ≥ 2.3 to serve it (NumPy
  ≥ 1.24 and pytest for training and tests); Node 20+ for the JavaScript
  tests and for `train_style.py --analyse`.

## License

The code is under the MIT licence (`LICENSE`). Not everything in the
repository is ours to license: the portrait (author unknown), the chess
pieces (Colin M.L. Burnett, BSD), the typeface (SIL Open Font License) and
the piece-square tables (PeSTO) belong to the people named under
[Credits](#credits), on their terms.
