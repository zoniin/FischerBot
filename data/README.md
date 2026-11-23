# The corpus

Everything FischerBot knows about Fischer comes from the 731 games in this
directory: the opening book is built from them and the style model is trained
on them.

| File | Games | What |
| --- | --- | --- |
| `m60mg.pgn` | 60 | *My 60 Memorable Games* (1957–1967), with the book's side variations |
| `wc1972.pgn` | 21 | The 1972 World Championship match against Spassky |
| `career.pgn` | 651 | His other serious tournament and match games, 1955–1992 |
| `engine_candidates.json.gz` | — | Derived: the engine's analysis of Fischer's decisions (see below) |
| `fischer_quotes.json` | — | The real quotations the bot may use, each with its source (see below) |

Game 2 of the match was a forfeit (Fischer did not appear), so 20 of the 21
match games carry moves. Fischer's record across the corpus: **+407 =241 −83**
(48 wins, 9 draws, 3 losses in the book; 7 wins, 11 draws, 2 losses played
in the match; +352 =221 −78 in the rest).

The first two files are the "core": the project started from those 80 games
(`load_corpus(CORE_SOURCES)`), and they are the ones cited first when a book
move occurs in several games.

## Where the games came from

* `m60mg.pgn` is an export of the Lichess study
  ["All Variations of My 60 Memorable Games"](https://lichess.org/study/4zOTO2ki)
  — each game's `Site` header links to its chapter.
* `wc1972.pgn` is the PGN Mentor file for the match.
* `career.pgn` is built by `tools/build_career.py` from PGN Mentor's
  collection of Fischer's games (827 games, 1955–1992). Kept: tournament and
  match play. Dropped: 95 blitz, simultaneous-display, casual and
  against-computer games, 2 forfeits, and the 79 games already in the two
  files above (matched by players, year and the positions reached, since the
  book and the database differ here and there in move order). Every game is
  re-parsed and must be fully legal.

## Corrections made to the study export

The study is a hand-typed transcription and five of its chapters stop before
the end of the game. Every main line was checked move by move against an
independent collection (PGN Mentor's file of Fischer's games):

| # | Game | Problem in the export | Fix |
| --- | --- | --- | --- |
| 7 | Olafsson–Fischer, Zurich 1959 | `16.Nxa4 Bxa4` skipped (17.b3 entered as move 16), then abandoned | Completed to 40...e2 |
| 15 | Smyslov–Fischer, Candidates 1959 | Stops after 44...Rf3 | Completed to 54...Re6 |
| 16 | Fischer–Petrosian, Candidates 1959 | Stops after 35.Qg8, before the four-queens finish | Completed to 48...Qh1 |
| 27 | Reshevsky–Fischer, match 1961 | The note `49...Ke4!` (a quicker mate Fischer pointed out) entered as the game move, then abandoned | Game move `49...g1=Q` restored, note kept as a variation, completed to 57...Kf5 |
| 37 | Keres–Fischer, Curaçao 1962 | Stops after 74.Kxh3 | Completed to 77.Qf7+ |

In addition, none of the 60 games had a result recorded (`*`); all results
are now filled in and agree with the reference collection and with the
book's well-known tally of 48 wins, 9 draws and 3 losses. One header typo
(`CURAÇLAO`) was fixed.

Where the book and the database disagree on the score of a *complete* game
(the move order in game 6, and the final moves of games 9 and 17), the
book's version has been kept. The other 53 main lines were identical in both
sources, as were all 20 match games.

`tests/test_data_book_style.py` pins all of this down: game counts, results,
the length of every repaired game, and full legality of every move.

## engine_candidates.json.gz

Training the style model needs to know, for each of Fischer's 30,270
decisions, which moves were actually *playable*. The site's own engine
(`web/static/js/engine.js`, run under Node by `web/tools/analyse.js`) gives
each position 100,000 nodes - about fourteen plies - and records its best
move and score and every other move it scores within a pawn of that. It takes
about an hour on four cores, so the result is cached here. It is derived data
- regenerate it with

```bash
python train_style.py --analyse
```

whenever the engine or its evaluation changes (Node 20 or later must be on the
path). An interrupted run can be resumed: pass the same `--work-dir`.

## fischer_quotes.json

Most of what the portrait says was written for the bot. Eighteen lines are
Fischer's own, and are shown as quotations with their source. This file is
the record of them: the wording, the source as it is shown, where the passage
stands (which game's notes, which move), and how it was checked.

* Fifteen come from his notes to the moves in *My 60 Memorable Games* (1969).
  Each was found word for word in three separately extracted copies of the
  book's text, and in the annotations - not in the introductions to the
  games, which Larry Evans wrote. One of them ("I have never opened with the
  d-pawn - on principle") is given as the current algebraic edition prints
  it; the first edition, in descriptive notation, has "the QP".
* Three more come from "A Bust to the King's Gambit", his article in the
  first issue of the *American Chess Quarterly* (1961), found in several
  independent transcriptions.

Ten further candidates were left out because they make no sense away from the
game they annotate. Nothing is presented as a quotation unless it is in this
file: `tests/test_data_book_style.py` checks every quoted line in
`web/static/data/commentary.json` against it.
