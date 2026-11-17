"""Train the Fischer style model on the real corpus.

    python train_style.py                 # train from the cached engine analysis
    python train_style.py --analyse       # redo the engine analysis first (slow)
    python train_style.py --cv-only       # just report cross-validated accuracy

Pipeline
--------
1. For every position where Fischer was to move, the engine lists the moves
   it scores within ANALYSIS_WINDOW centipawns of its favourite. That is slow
   (the better part of an hour on four cores), deterministic, and cached in
   data/engine_candidates.json.gz.
2. A conditional-logit model is fitted so that, among those playable moves,
   the one Fischer actually chose gets the highest probability. Two of the
   features are the engine's own verdict (centipawns lost, and "is the
   engine's first choice"), so the model also learns how much objective
   value Fischer's preferences are worth.
3. Accuracy is reported by cross-validation over whole games: the model is
   always scored on games it has not seen.
"""

import argparse
import gzip
import json
import math
import os
import random
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

import chess

from fischerbot.dataset import load_corpus
from fischerbot.engine import Engine
from fischerbot.style import (
    ENGINE_BEST, ENGINE_LOSS, MODEL_PATH, N_FEATURES, N_PHASE, PositionContext, StyleModel,
    _REPERTOIRE_OFFSET, feature_names, move_features,
)

CANDIDATES_PATH = Path(__file__).parent / "data" / "engine_candidates.json.gz"

# --- engine analysis (changing any of these means re-running --analyse)
ANALYSIS_DEPTH = 8            # iterative deepening stops here ...
ANALYSIS_NODES = 50_000       # ... or after this many nodes, whichever is first
ANALYSIS_WINDOW = 100         # centipawns: how far below the best move we keep scores
CANDIDATE_NODES = 100_000     # node budget for scoring the other root moves

# --- model
TRAIN_WINDOW = 60             # moves within this many centipawns form the choice set
PLAY_WINDOW = 40              # hard cap on what the bot may give up for style
# Extra weight on the engine's own choice when deciding (not when fitting).
# Cross-validation is flat between 0 and 0.5, and at 0.5 the bot departs from
# the engine half as often for the same agreement with Fischer - so prefer it.
ENGINE_PREFERENCE = 0.5
L2_STYLE = 2.0
L2_REPERTOIRE = 6.0
L2_ENGINE = 0.02
ITERATIONS = 1500
LEARNING_RATE = 0.05
FOLDS = 8
SEED = 1972


# ------------------------------------------------------------ engine analysis

def decisions(games):
    """Every Fischer decision: (key, moves played so far, Fischer's move)."""
    out = []
    for fg in games:
        board = fg.game.board()
        for ply, move in enumerate(fg.game.mainline_moves()):
            if board.turn == fg.fischer_color and board.legal_moves.count() > 1:
                out.append((f"{fg.source}#{fg.number}:{ply}",
                            [m.uci() for m in board.move_stack], move.uci()))
            board.push(move)
    return out


def _analyse_chunk(chunk):
    out = {}
    for key, stack, _fischer in chunk:
        board = chess.Board()
        for uci in stack:
            board.push_uci(uci)
        engine = Engine()  # fresh engine: results do not depend on processing order
        result = engine.search(board, time_budget_ms=10 ** 9, max_depth=ANALYSIS_DEPTH,
                               node_limit=ANALYSIS_NODES)
        scores = engine.candidates(board, result, ANALYSIS_WINDOW, node_limit=CANDIDATE_NODES)
        out[key] = {"best": result.move.uci(), "score": result.score_cp,
                    "depth": result.depth, "moves": scores}
    return out


def analyse(games, workers):
    todo = decisions(games)
    print(f"Analysing {len(todo)} positions with {workers} workers "
          f"(depth {ANALYSIS_DEPTH}, {ANALYSIS_NODES} nodes) ...", flush=True)
    start = time.time()
    chunks = [todo[i::workers * 8] for i in range(workers * 8)]
    positions = {}
    with ProcessPoolExecutor(workers) as pool:
        for done, part in enumerate(pool.map(_analyse_chunk, chunks), 1):
            positions.update(part)
            print(f"  {len(positions)}/{len(todo)} positions, {time.time() - start:.0f}s", flush=True)
    payload = {
        "meta": {"depth": ANALYSIS_DEPTH, "nodes": ANALYSIS_NODES, "window": ANALYSIS_WINDOW,
                 "candidate_nodes": CANDIDATE_NODES, "positions": len(positions)},
        "positions": dict(sorted(positions.items())),
    }
    with gzip.open(CANDIDATES_PATH, "wt", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"Wrote {CANDIDATES_PATH} ({os.path.getsize(CANDIDATES_PATH) / 1024:.0f} KB)")
    return payload


def load_candidates():
    with gzip.open(CANDIDATES_PATH, "rt", encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------ samples

class Sample:
    """One Fischer decision: the playable moves, their features, and his choice."""
    __slots__ = ("game", "phase", "rows", "cols", "vals", "n", "chosen", "loss", "best", "ucis")


def build_samples(games, candidates, window=TRAIN_WINDOW):
    """Samples grouped by game, plus counts of the decisions that had to be left out."""
    positions = candidates["positions"]
    samples, stats = [], {"decisions": 0, "outside_window": 0, "forced": 0, "missing": 0}
    for fg in games:
        game_id = f"{fg.source}#{fg.number}"
        board = fg.game.board()
        for ply, move in enumerate(fg.game.mainline_moves()):
            if board.turn == fg.fischer_color and board.legal_moves.count() > 1:
                stats["decisions"] += 1
                entry = positions.get(f"{game_id}:{ply}")
                if entry is None:
                    stats["missing"] += 1
                else:
                    sample = _make_sample(board, move, entry, window)
                    if sample is None:
                        stats["outside_window"] += 1
                    elif sample.n == 1:
                        stats["forced"] += 1
                    else:
                        sample.game = game_id
                        samples.append(sample)
            board.push(move)
    return samples, stats


def _make_sample(board, fischer_move, entry, window):
    best_score = entry["score"]
    playable = {uci: best_score - score for uci, score in entry["moves"].items()
                if best_score - score <= window}
    playable[entry["best"]] = 0
    if fischer_move.uci() not in playable:
        return None  # the engine thinks his move loses too much: nothing to learn here
    ctx = PositionContext(board)
    base = ctx.phase * N_PHASE
    sample = Sample()
    sample.phase = ctx.phase
    rows, cols, vals, losses, ucis = [], [], [], [], []
    for row, (uci, loss) in enumerate(sorted(playable.items())):
        loss = max(0, loss)
        feats = move_features(ctx, chess.Move.from_uci(uci))
        feats.append((base + ENGINE_LOSS, loss / 100.0))
        if uci == entry["best"]:
            feats.append((base + ENGINE_BEST, 1.0))
            sample.best = row
        for col, val in feats:
            rows.append(row)
            cols.append(col)
            vals.append(val)
        losses.append(loss)
        ucis.append(uci)
        if uci == fischer_move.uci():
            sample.chosen = row
    sample.rows = np.array(rows)
    sample.cols = np.array(cols)
    sample.vals = np.array(vals)
    sample.loss = np.array(losses, dtype=float)
    sample.ucis = ucis
    sample.n = len(ucis)
    return sample


# ----------------------------------------------------------------- training

def _stack(samples):
    """Concatenate samples into flat arrays for vectorised gradients."""
    offsets = np.cumsum([0] + [s.n for s in samples])
    rows = np.concatenate([s.rows + off for s, off in zip(samples, offsets)])
    cols = np.concatenate([s.cols for s in samples])
    vals = np.concatenate([s.vals for s in samples])
    group = np.concatenate([np.full(s.n, i) for i, s in enumerate(samples)])
    chosen = np.array([off + s.chosen for s, off in zip(samples, offsets)])
    return rows, cols, vals, group, chosen, int(offsets[-1]), len(samples)


def _l2_vector():
    l2 = np.full(N_FEATURES, L2_STYLE)
    l2[_REPERTOIRE_OFFSET:] = L2_REPERTOIRE
    for phase in range(3):
        l2[phase * N_PHASE + ENGINE_LOSS] = L2_ENGINE
        l2[phase * N_PHASE + ENGINE_BEST] = L2_ENGINE
    return l2


def fit(samples, iterations=ITERATIONS, verbose=False):
    """Maximise the L2-penalised likelihood of Fischer's choices (convex; Adam, full batch)."""
    rows, cols, vals, group, chosen, n_rows, n_groups = _stack(samples)
    l2 = _l2_vector()
    w = np.zeros(N_FEATURES)
    for phase in range(3):
        w[phase * N_PHASE + ENGINE_LOSS] = -3.0  # start from "prefer the engine's move"
    m = np.zeros(N_FEATURES)
    v = np.zeros(N_FEATURES)
    for step in range(1, iterations + 1):
        logits = np.bincount(rows, weights=vals * w[cols], minlength=n_rows)
        peak = np.full(n_groups, -np.inf)
        np.maximum.at(peak, group, logits)
        expd = np.exp(logits - peak[group])
        probs = expd / np.bincount(group, weights=expd, minlength=n_groups)[group]
        residual = probs.copy()
        residual[chosen] -= 1.0
        grad = np.bincount(cols, weights=vals * residual[rows], minlength=N_FEATURES) + l2 * w
        m = 0.9 * m + 0.1 * grad
        v = 0.999 * v + 0.001 * grad * grad
        w -= LEARNING_RATE * (m / (1 - 0.9 ** step)) / (np.sqrt(v / (1 - 0.999 ** step)) + 1e-8)
        if verbose and (step % 250 == 0 or step == 1):
            nll = -np.log(probs[chosen] + 1e-12).sum() + 0.5 * (l2 * w * w).sum()
            print(f"  step {step:4d}  penalised nll {nll:.2f}")
    return w


def choose(w, sample, play_window=PLAY_WINDOW, engine_preference=ENGINE_PREFERENCE):
    """Row the bot would play: best total score among moves inside the play window."""
    logits = np.bincount(sample.rows, weights=sample.vals * w[sample.cols], minlength=sample.n)
    logits[sample.best] += engine_preference
    logits = np.where(sample.loss <= play_window, logits, -np.inf)
    return int(np.argmax(logits))


def score(w, samples, play_window=PLAY_WINDOW):
    """Accuracy of the style choice vs the engine's first choice on the same decisions."""
    out = {"n": len(samples), "style": 0, "engine": 0, "nll": 0.0, "avg_loss": 0.0, "switched": 0}
    by_phase = {p: [0, 0, 0] for p in range(3)}
    for s in samples:
        pick = choose(w, s, play_window)
        out["style"] += pick == s.chosen
        out["engine"] += s.best == s.chosen
        out["switched"] += pick != s.best
        out["avg_loss"] += s.loss[pick]
        logits = np.bincount(s.rows, weights=s.vals * w[s.cols], minlength=s.n)
        logits -= logits.max()
        out["nll"] -= logits[s.chosen] - math.log(np.exp(logits).sum())
        by_phase[s.phase][0] += 1
        by_phase[s.phase][1] += pick == s.chosen
        by_phase[s.phase][2] += s.best == s.chosen
    out["by_phase"] = by_phase
    return out


def cross_validate(samples, folds=FOLDS, seed=SEED, verbose=True):
    """Leave-games-out cross-validation. Returns totals over all held-out decisions."""
    game_ids = sorted({s.game for s in samples})
    random.Random(seed).shuffle(game_ids)
    fold_of = {g: i % folds for i, g in enumerate(game_ids)}
    total = {"n": 0, "style": 0, "engine": 0, "nll": 0.0, "avg_loss": 0.0, "switched": 0}
    phases = {p: [0, 0, 0] for p in range(3)}
    for fold in range(folds):
        train = [s for s in samples if fold_of[s.game] != fold]
        held = [s for s in samples if fold_of[s.game] == fold]
        w = fit(train)
        r = score(w, held)
        for k in total:
            total[k] += r[k]
        for p in range(3):
            for i in range(3):
                phases[p][i] += r["by_phase"][p][i]
        if verbose:
            print(f"  fold {fold + 1}/{folds}: {r['n']:4d} decisions  "
                  f"engine {r['engine'] / r['n']:.1%}  with style {r['style'] / r['n']:.1%}")
    total["by_phase"] = phases
    return total


def report(total, stats):
    n = total["n"]
    all_decisions = stats["decisions"]
    forced = stats["forced"]
    print()
    print(f"Held-out decisions with a real choice: {n} of {all_decisions} "
          f"({forced} had one playable move, {stats['outside_window']} were moves "
          f"the engine scores more than {TRAIN_WINDOW}cp below its best)")
    print(f"  engine's first choice = Fischer's move : {total['engine'] / n:.1%}"
          f"   (all decisions: {(total['engine'] + forced) / all_decisions:.1%})")
    print(f"  engine + style        = Fischer's move : {total['style'] / n:.1%}"
          f"   (all decisions: {(total['style'] + forced) / all_decisions:.1%})")
    print(f"  style changes the move in {total['switched'] / n:.1%} of positions, "
          f"giving up {total['avg_loss'] / n:.1f}cp on average")
    for p, name in enumerate(("opening", "middlegame", "endgame")):
        cnt, style, engine = total["by_phase"][p]
        if cnt:
            print(f"  {name:10s} ({cnt:4d}): engine {engine / cnt:.1%} -> with style {style / cnt:.1%}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--analyse", action="store_true", help="rebuild the engine analysis cache")
    parser.add_argument("--cv-only", action="store_true", help="report accuracy, do not save a model")
    parser.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    args = parser.parse_args()

    games = list(load_corpus())
    if args.analyse or not CANDIDATES_PATH.exists():
        candidates = analyse(games, args.workers)
    else:
        candidates = load_candidates()

    samples, stats = build_samples(games, candidates)
    print(f"Corpus: {len(games)} games, {stats['decisions']} Fischer decisions, "
          f"{len(samples)} with at least two playable moves")

    print(f"Cross-validation ({FOLDS} folds, whole games held out):")
    total = cross_validate(samples)
    report(total, stats)
    if args.cv_only:
        return

    print("\nFitting the final model on all games ...")
    w = fit(samples, verbose=True)
    n = total["n"]
    everything = stats["decisions"]
    model = StyleModel(list(w))
    model.save(metadata={
        "trained_on": "My 60 Memorable Games + 1972 World Championship (80 games)",
        "decisions": stats["decisions"],
        "training_decisions": len(samples),
        "choice_set": f"moves the engine scores within {TRAIN_WINDOW}cp of its best "
                      f"(depth {candidates['meta']['depth']}, {candidates['meta']['nodes']} nodes)",
        "play_window_cp": PLAY_WINDOW,
        "engine_preference": ENGINE_PREFERENCE,
        "cv_folds": FOLDS,
        "cv_engine_top1": round((total["engine"] + stats["forced"]) / everything, 4),
        "cv_style_top1": round((total["style"] + stats["forced"]) / everything, 4),
        "cv_switch_rate": round(total["switched"] / everything, 4),
        "cv_avg_loss_cp": round(total["avg_loss"] / everything, 2),
        "cv_by_phase": {name: {"decisions": total["by_phase"][p][0],
                               "engine_top1": round(total["by_phase"][p][2] / max(1, total["by_phase"][p][0]), 4),
                               "style_top1": round(total["by_phase"][p][1] / max(1, total["by_phase"][p][0]), 4)}
                        for p, name in enumerate(("opening", "middlegame", "endgame"))},
    })
    print(f"Saved model to {MODEL_PATH}")
    names = feature_names()
    order = np.argsort(-np.abs(w[:_REPERTOIRE_OFFSET]))[:16]
    print("Strongest preferences:")
    for i in order:
        print(f"  {names[i]:34s} {w[i]:+.2f}")


if __name__ == "__main__":
    main()
