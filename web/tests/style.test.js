// The browser's style model must reproduce fischerbot/style.py: same
// features, same indices, same values, same scores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, staticData } from './helpers.js';
import { Position } from '../static/js/rules.js';
import {
  PHASE_FEATURES, GLOBAL_FEATURES, N_PHASE, N_FEATURES, ENGINE_LOSS, ENGINE_BEST,
  featureNames, gamePhase, PositionContext, moveFeatures, StyleModel,
} from '../static/js/style.js';

const data = fixture('style');
const document = staticData('style.json');
const model = StyleModel.fromJSON(document);

test('feature layout is the Python layout', () => {
  assert.deepEqual(PHASE_FEATURES, data.phaseFeatures);
  assert.deepEqual(GLOBAL_FEATURES, data.globalFeatures);
  assert.equal(N_PHASE, data.nPhase);
  assert.equal(N_FEATURES, data.nFeatures);
  assert.equal(ENGINE_LOSS, data.engineLoss);
  assert.equal(ENGINE_BEST, data.engineBest);
  assert.deepEqual(featureNames(), data.featureNames);
});

test('features of every legal move match the reference', () => {
  let moves = 0;
  for (const c of data.cases) {
    const position = Position.fromMoves(c.moves, c.start);
    assert.equal(position.fen(), c.fen);
    assert.equal(gamePhase(position), c.phase, `phase of ${c.fen}`);
    const ctx = new PositionContext(position);
    const legal = position.legalMoves();
    assert.equal(legal.length, Object.keys(c.features).length);
    for (const move of legal) {
      const want = c.features[move.uci()];
      const got = moveFeatures(ctx, move).slice().sort((a, b) => a[0] - b[0]);
      const where = `${move.uci()} in ${c.fen}`;
      const names = featureNames();
      assert.deepEqual(got.map(f => names[f[0]]), want.map(f => names[f[0]]), `features of ${where}`);
      got.forEach((f, i) => {
        assert.ok(Math.abs(f[1] - want[i][1]) < 1e-12, `${names[f[0]]} of ${where}: ${f[1]} vs ${want[i][1]}`);
      });
      moves++;
    }
    assert.equal(position.fen(), c.fen, 'computing features must not disturb the position');
  }
  assert.ok(moves > 5000);
});

test('the model scores moves as the Python model does', () => {
  for (const c of data.cases) {
    const position = Position.fromMoves(c.moves, c.start);
    const scored = model.styleScores(position);
    assert.equal(scored.length, Object.keys(c.scores).length);
    for (let i = 0; i < scored.length; i++) {
      const { move, score } = scored[i];
      assert.ok(Math.abs(score - c.scores[move.uci()]) < 1e-9, `score of ${move.uci()} in ${c.fen}`);
      if (i) assert.ok(scored[i - 1].score >= score, 'best first');
    }
  }
});

test('allowedLoss and the decision settings', () => {
  assert.equal(model.enginePreference, data.enginePreference);
  for (const [phase, gain, want] of data.allowedLoss) {
    assert.ok(Math.abs(model.allowedLoss(phase, gain) - want) < 1e-9, `allowedLoss(${phase}, ${gain})`);
  }
});

test('a model file from another version is rejected', () => {
  assert.throws(() => StyleModel.fromJSON({ ...document, phase_features: ['bias'] }));
  assert.throws(() => StyleModel.fromJSON({ ...document, format: 1 }));
});
