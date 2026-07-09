"""Train the Fischer style model (conditional logit) on the real corpus.

Unlike the original repo's "training" script, this one actually computes
gradients. For each position where Fischer moved, the model assigns a
softmax over all legal moves; the loss is the negative log-likelihood of
the move Fischer chose. Validation is held out at *game* level.

Run:  python train_style.py
"""

import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from fischerbot.dataset import load_corpus
from fischerbot.style import N_FEATURES, StyleModel, move_features

SEED = 1972
EPOCHS = 60
LEARNING_RATE = 0.05
LR_DECAY = 0.96  # per epoch
L2 = 1e-4
VALIDATION_FRACTION = 0.15


def build_samples(games):
    """One sample per Fischer decision: (feature matrix of legal moves, chosen index)."""
    samples = []
    for fg in games:
        board = fg.game.board()
        for move in fg.game.mainline_moves():
            if board.turn == fg.fischer_color:
                legal = list(board.legal_moves)
                if len(legal) > 1:
                    feats = np.array(
                        [move_features(board, m) for m in legal], dtype=np.float64
                    )
                    samples.append((feats, legal.index(move)))
            board.push(move)
    return samples


def evaluate_model(w, samples):
    nll = 0.0
    top1 = top3 = 0
    for feats, chosen in samples:
        logits = feats @ w
        logits -= logits.max()
        probs = np.exp(logits)
        probs /= probs.sum()
        nll -= np.log(probs[chosen] + 1e-12)
        order = np.argsort(-probs)
        if order[0] == chosen:
            top1 += 1
        if chosen in order[:3]:
            top3 += 1
    n = len(samples)
    return nll / n, top1 / n, top3 / n


def train():
    rng = random.Random(SEED)
    games = list(load_corpus())
    rng.shuffle(games)
    n_val = max(1, int(len(games) * VALIDATION_FRACTION))
    val_games, train_games = games[:n_val], games[n_val:]

    print(f"Corpus: {len(games)} games -> {len(train_games)} train / {n_val} validation")
    train_samples = build_samples(train_games)
    val_samples = build_samples(val_games)
    print(f"Samples: {len(train_samples)} train decisions, {len(val_samples)} validation")

    w = np.zeros(N_FEATURES)
    velocity = np.zeros(N_FEATURES)

    lr = LEARNING_RATE
    for epoch in range(1, EPOCHS + 1):
        rng.shuffle(train_samples)
        for feats, chosen in train_samples:
            logits = feats @ w
            logits -= logits.max()
            probs = np.exp(logits)
            probs /= probs.sum()
            # d(-log p[chosen])/dw = E_p[f] - f_chosen
            grad = probs @ feats - feats[chosen] + L2 * w
            velocity = 0.9 * velocity - lr * grad
            w += velocity
        lr *= LR_DECAY
        if epoch % 5 == 0 or epoch == 1:
            tr = evaluate_model(w, train_samples[:800])
            va = evaluate_model(w, val_samples)
            print(
                f"epoch {epoch:3d}  train nll={tr[0]:.3f} top1={tr[1]:.1%} | "
                f"val nll={va[0]:.3f} top1={va[1]:.1%} top3={va[2]:.1%}"
            )

    val_nll, val_top1, val_top3 = evaluate_model(w, val_samples)
    uniform_top1 = float(np.mean([1 / len(f) for f, _ in val_samples]))
    print()
    print(f"Final validation: top1={val_top1:.1%} top3={val_top3:.1%} "
          f"(uniform-random baseline top1={uniform_top1:.1%})")

    model = StyleModel(list(w))
    model.save(metadata={
        "seed": SEED,
        "epochs": EPOCHS,
        "train_games": len(train_games),
        "val_games": n_val,
        "val_top1": round(val_top1, 4),
        "val_top3": round(val_top3, 4),
        "uniform_baseline_top1": round(uniform_top1, 4),
    })
    print(f"Saved model to {Path('models/style.json').resolve()}")


if __name__ == "__main__":
    train()
