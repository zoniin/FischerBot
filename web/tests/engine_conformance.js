// Conformance suite for a FischerBot search engine.
//
//   import { Engine } from '../static/js/engine.js';
//   import { conformance } from './engine_conformance.js';
//   conformance(Engine, 'engine');
//
// It checks the rules (perft), the public contract described in the engine
// spec, and basic search competence. It deliberately knows nothing about how
// the engine is built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';

const MATE = 100000;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const QUIET = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 8';

export function conformance(Engine, label) {
  const data = fixture('engine');
  const fresh = (fen = START, moves = []) => {
    const engine = new Engine();
    engine.setPosition(fen, moves);
    return engine;
  };

  test(`${label}: perft matches the reference node counts`, () => {
    for (const { fen, counts } of data.perft) {
      const engine = fresh(fen);
      for (let depth = 1; depth <= counts.length; depth++) {
        if (counts[depth - 1] > 5_000_000) break;
        assert.equal(engine.perft(depth), counts[depth - 1], `perft(${depth}) of ${fen}`);
      }
    }
  });

  test(`${label}: perft after replayed moves (setPosition applies the move list)`, () => {
    const engine = fresh(START, ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6']);
    const direct = fresh('rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6');
    assert.equal(engine.perft(1), direct.perft(1));
    assert.equal(engine.perft(3), direct.perft(3));
  });

  test(`${label}: search returns a legal move with a sane result object`, () => {
    for (const position of data.positions) {
      const engine = fresh(position.fen);
      const result = engine.search({ nodeLimit: 4000 });
      assert.ok(position.legal.includes(result.move), `${result.move} is not legal in ${position.fen}`);
      assert.ok(Number.isInteger(result.scoreCp), 'scoreCp must be an integer');
      assert.ok(result.depth >= 1, 'the first iteration always completes');
      assert.ok(result.nodes > 0 && Number.isFinite(result.timeMs));
      assert.ok(Array.isArray(result.pv) && result.pv[0] === result.move, 'pv starts with the chosen move');
    }
  });

  test(`${label}: static evaluation is colour-symmetric`, () => {
    for (const position of data.positions) {
      const a = fresh(position.fen).evaluate();
      const b = fresh(position.mirror).evaluate();
      assert.equal(a, b, `evaluate() differs between ${position.fen} and its mirror image`);
    }
    assert.ok(Math.abs(fresh().evaluate()) <= 40, 'the starting position is about level');
    assert.ok(fresh('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').evaluate() > 700, 'a queen up');
  });

  test(`${label}: finds forced mates and scores them by distance`, () => {
    for (const { fen, move, mateIn } of data.mates) {
      const result = fresh(fen).search({ timeMs: 4000 });
      assert.equal(result.move, move, `mate in ${mateIn}: ${fen}`);
      assert.equal(result.scoreCp, MATE - (2 * mateIn - 1), `mate score for ${fen}`);
    }
  });

  test(`${label}: wins material, does not lose it`, () => {
    // An undefended queen can be taken by a pawn.
    let result = fresh('rnb1kbnr/pppp1ppp/8/4p3/4q3/3P4/PPP1PPPP/RNBQKBNR w KQkq - 0 1').search({ timeMs: 500 });
    assert.equal(result.move, 'd3e4');
    // Qxe5+?? would lose the queen to ...Nxe5. White is a pawn down with the queen
    // attacked (about -2.5 for a strong engine), but nowhere near a queen down.
    result = fresh('r1bqkbnr/pppp1ppp/2n5/4p3/3Q4/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1').search({ timeMs: 500 });
    assert.notEqual(result.move, 'd4e5');
    assert.ok(result.scoreCp > -400 && result.scoreCp < 0, `score ${result.scoreCp}`);
  });

  test(`${label}: game over positions have no move`, () => {
    assert.equal(fresh('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1').search({ timeMs: 100 }).move, null);   // checkmate
    assert.equal(fresh('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').search({ timeMs: 100 }).move, null);   // stalemate
  });

  test(`${label}: a forced move is played at once`, () => {
    const engine = fresh('7k/8/5K2/6Q1/8/8/8/8 b - - 0 1');   // only ...Kh7
    const started = performance.now();
    const result = engine.search({ timeMs: 3000 });
    assert.equal(result.move, 'h8h7');
    assert.ok(performance.now() - started < 500, 'no need to think about a forced move');
  });

  test(`${label}: saves a lost game by perpetual check`, () => {
    const result = fresh('6k1/5p1p/8/8/8/8/rq6/2Q4K w - - 0 1').search({ timeMs: 3000 });
    assert.equal(result.move, 'c1g5');
    assert.equal(result.scoreCp, 0, 'a forced repetition is a draw');
  });

  test(`${label}: repetition counts positions from the game history`, () => {
    const draw = data.historyDraw;
    let result = fresh(draw.fen, draw.moves).search({ maxDepth: 2 });
    assert.equal(result.move, draw.move, 'the only way to draw is to repeat a position from the game');
    assert.equal(result.scoreCp, draw.score);
    const avoid = data.historyAvoid;
    result = fresh(avoid.fen, avoid.moves).search({ timeMs: 500 });
    assert.notEqual(result.move, avoid.avoid, 'the winning side must not repeat');
    assert.ok(result.scoreCp > 300);
  });

  test(`${label}: respects the time budget`, () => {
    for (const timeMs of [50, 150, 400]) {
      const engine = fresh(QUIET);
      const started = performance.now();
      const result = engine.search({ timeMs });
      const elapsed = performance.now() - started;
      assert.ok(elapsed <= timeMs + 80, `search took ${elapsed.toFixed(0)} ms on a ${timeMs} ms budget`);
      assert.ok(result.move && result.depth >= 1);
    }
    const tiny = fresh(QUIET).search({ timeMs: 1 });
    assert.ok(tiny.move && tiny.depth >= 1, 'even 1 ms yields a move from a completed first iteration');
  });

  test(`${label}: respects depth and node limits, reproducibly`, () => {
    const shallow = fresh(QUIET).search({ maxDepth: 3 });
    assert.equal(shallow.depth, 3);
    const a = fresh(QUIET).search({ nodeLimit: 20000 });
    const b = fresh(QUIET).search({ nodeLimit: 20000 });
    assert.ok(a.nodes <= 20000 + 4096, `searched ${a.nodes} nodes on a 20000 node limit`);
    assert.deepEqual([a.move, a.scoreCp, a.depth, a.nodes], [b.move, b.scoreCp, b.depth, b.nodes],
      'the same position and node limit must give the same answer');
  });

  test(`${label}: searching does not disturb the position`, () => {
    const engine = fresh(QUIET);
    const before = engine.perft(2);
    engine.search({ timeMs: 60 });           // interrupted mid-iteration
    engine.search({ nodeLimit: 3000 });
    assert.equal(engine.perft(2), before);
    const again = new Engine();
    again.setPosition(QUIET);
    assert.equal(engine.evaluate(), again.evaluate());
  });

  test(`${label}: scoreMove probes one root move inside a window`, () => {
    const engine = fresh(QUIET);
    const result = engine.search({ maxDepth: 6 });
    const score = engine.scoreMove(result.move, result.scoreCp - 80, result.scoreCp + 80, result.depth);
    assert.ok(Math.abs(score - result.scoreCp) <= 40, `best move rescored at ${score}, search said ${result.scoreCp}`);
    // A move that hangs the queen falls below any reasonable window.
    const blunder = fresh('r1bqkbnr/pppp1ppp/2n5/4p3/3Q4/8/PPPP1PPP/RNB1KBNR w KQkq - 0 1');
    blunder.search({ maxDepth: 4 });
    assert.ok(blunder.scoreMove('d4e5', -200, 200, 4) <= -200);
    // Out of time means "don't know".
    assert.equal(fresh(QUIET).scoreMove('e1g1', -50, 50, 30, { timeMs: 5 }), null);
  });

  test(`${label}: candidates lists every root move near the best`, () => {
    const position = data.positions.find(p => p.legal.length >= 25 && !p.check);
    const engine = fresh(position.fen);
    const result = engine.search({ maxDepth: 5 });
    const found = engine.candidates(result, 60);
    assert.equal(found[result.move], result.scoreCp, 'the best move is listed with its own score');
    for (const [uci, score] of Object.entries(found)) {
      assert.ok(position.legal.includes(uci), `${uci} is not legal`);
      assert.ok(score >= result.scoreCp - 60, `${uci} at ${score} is outside the 60 cp window`);
    }
    const wide = engine.candidates(result, 400);
    assert.ok(Object.keys(wide).length >= Object.keys(found).length);
  });

  test(`${label}: newGame() forgets the previous game`, () => {
    const engine = fresh(QUIET);
    const first = engine.search({ nodeLimit: 15000 });
    engine.newGame();
    engine.setPosition(QUIET);
    const second = engine.search({ nodeLimit: 15000 });
    assert.deepEqual([first.move, first.scoreCp, first.nodes], [second.move, second.scoreCp, second.nodes]);
  });
}
