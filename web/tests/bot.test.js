// The bot's decision procedure (book -> search -> style), tested with a
// scripted engine so every branch can be forced. See fischerbot/bot.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { staticData } from './helpers.js';
import { Position } from '../static/js/rules.js';
import { Book } from '../static/js/book.js';
import { FischerBot, LEVELS } from '../static/js/bot.js';

const MIDDLEGAME = 'r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 14';
const ENDGAME = '8/5pk1/6p1/8/8/6P1/5PK1/3R4 w - - 0 40';
const BEST = 'a2a3';            // what the scripted engine prefers in MIDDLEGAME
const LEVEL = { id: 'test', year: 1972, book: { year: 1972, later: true },
                timeMs: 1000, maxDepth: 64, nodeLimit: 500000, styleMarginCp: 40 };

/** An engine that answers from a script and records how it was called. */
class ScriptedEngine {
  constructor({ move = BEST, scoreCp = 30, depth = 8, scores = {}, deeper = {} } = {}) {
    Object.assign(this, { move, scoreCp, depth, scores, deeper, calls: [] });
  }
  newGame() { this.calls.push(['newGame']); }
  setPosition(fen, moves = []) { this.calls.push(['setPosition', fen, moves.slice()]); }
  search(limits) {
    this.calls.push(['search', limits]);
    return { move: this.move, scoreCp: this.scoreCp, depth: this.depth, nodes: 1234, timeMs: 5, pv: [this.move] };
  }
  scoreMove(uci, lower, upper, depth, limits) {
    this.calls.push(['scoreMove', uci, lower, upper, depth, limits]);
    const table = depth > this.depth ? { ...this.scores, ...this.deeper } : this.scores;
    return uci in table ? table[uci] : lower;      // unknown moves fail low
  }
  probes(depth) { return this.calls.filter(c => c[0] === 'scoreMove' && (depth === undefined || c[4] === depth)); }
}

/** A style model that ranks `order` best-first and allows a loss computed from the gain. */
function scriptedStyle(order, allowed) {
  return {
    enginePreference: 0,
    styleScores(position) {
      const rank = uci => (order.includes(uci) ? order.length - order.indexOf(uci) : -100);
      return position.legalMoves().map(move => ({ move, score: rank(move.uci()) }))
        .sort((a, b) => b.score - a.score);
    },
    allowedLoss: (phase, gain) => (gain > 0 ? allowed(gain) : -1),
  };
}

function bot(engine, style, level = LEVEL, book = null) {
  return new FischerBot({ engine, book, style, level, random: () => 0 });
}

test('levels: four eras, youngest first', () => {
  assert.deepEqual(LEVELS.map(l => l.id), ['prodigy', 'grandmaster', 'champion', 'world']);
  assert.deepEqual(LEVELS.map(l => l.year), [1956, 1958, 1963, 1972]);
  assert.deepEqual(LEVELS.map(l => l.book), [
    { year: 1956, later: false }, { year: 1958, later: false },
    { year: 1963, later: false }, { year: 1972, later: true }]);
  for (const level of LEVELS) {
    assert.ok(level.timeMs > 0 && level.styleMarginCp >= 0 && typeof level.title === 'string');
  }
  assert.ok(LEVELS[0].timeMs <= LEVELS[3].timeMs);
});

test('a book move is played without searching', () => {
  const engine = new ScriptedEngine();
  const book = new Book(staticData('book.json'));
  const choice = bot(engine, null, LEVEL, book).choose({ fen: new Position().fen(), moves: [] });
  assert.equal(choice.source, 'book');
  assert.equal(choice.uci, 'e2e4');           // random() = 0 picks the heaviest move
  assert.equal(choice.san, 'e4');
  assert.ok(choice.book.count > 300);
  assert.match(choice.book.game.cite, /Fischer/);
  assert.equal(engine.calls.filter(c => c[0] === 'search').length, 0);
});

test('the book follows the level\'s era', () => {
  const book = new Book(staticData('book.json'));
  const boy = { ...LEVEL, year: 1956, book: { year: 1956, later: false } };
  const choice = new FischerBot({ engine: new ScriptedEngine(), book, style: null, level: boy, random: () => 0.99 })
    .choose({ fen: new Position().fen(), moves: [] });
  assert.equal(choice.uci, 'g1f3');           // as a boy he opened 1.Nf3 nearly as often as 1.e4
  assert.ok(choice.book.games.every(g => g.year <= 1956));
});

test('out of book the engine is asked, within the level\'s limits', () => {
  const engine = new ScriptedEngine();
  const choice = bot(engine, null).choose({ fen: MIDDLEGAME, moves: [] });
  assert.equal(choice.uci, BEST);
  assert.equal(choice.san, 'a3');
  assert.equal(choice.source, 'search');
  assert.equal(choice.evalCp, 30);
  assert.equal(choice.depth, 8);
  assert.deepEqual(choice.pv, [BEST]);
  assert.equal(choice.engineSan, undefined);
  assert.deepEqual(engine.calls[0], ['setPosition', MIDDLEGAME, []]);
  const limits = engine.calls.find(c => c[0] === 'search')[1];
  assert.ok(limits.timeMs > 0 && limits.timeMs <= LEVEL.timeMs, 'the search gets most of the budget, never more');
  assert.equal(limits.maxDepth, 64);
  assert.equal(limits.nodeLimit, 500000);
});

test('the game history is handed to the engine', () => {
  const engine = new ScriptedEngine({ move: 'g8f6' });
  const moves = ['a2a3', 'e7e5', 'h2h3', 'd7d5', 'a3a4'];
  const choice = bot(engine, null).choose({ fen: new Position().fen(), moves });
  assert.deepEqual(engine.calls[0], ['setPosition', new Position().fen(), moves]);
  assert.equal(choice.san, 'Nf6');
});

test('a more Fischer-like move replaces the engine\'s when it costs little', () => {
  const engine = new ScriptedEngine({ scores: { f3e5: 20 }, deeper: { f3e5: 12 } });
  const choice = bot(engine, scriptedStyle(['f3e5', BEST], () => 25)).choose({ fen: MIDDLEGAME, moves: [] });
  assert.equal(choice.uci, 'f3e5');
  assert.equal(choice.source, 'search+style');
  assert.equal(choice.engineSan, 'a3');
  assert.equal(choice.evalCp, 30);
  // probed at the search depth inside (best - limit - 1, best + 1), then confirmed one ply deeper
  assert.deepEqual(engine.probes().map(c => c.slice(1, 5)), [['f3e5', 4, 31, 8], ['f3e5', 4, 5, 9]]);
});

test('a style move that costs more than its style is worth is refused', () => {
  const engine = new ScriptedEngine({ scores: { f3e5: 0 } });            // 30 cp worse, 25 allowed
  const choice = bot(engine, scriptedStyle(['f3e5', BEST], () => 25)).choose({ fen: MIDDLEGAME, moves: [] });
  assert.equal(choice.uci, BEST);
  assert.equal(choice.source, 'search');
  assert.equal(engine.probes().length, 1, 'no confirmation search for a refused move');
});

test('a style move must hold up one ply deeper', () => {
  const engine = new ScriptedEngine({ scores: { f3e5: 28 }, deeper: { f3e5: -40 } });
  const choice = bot(engine, scriptedStyle(['f3e5', BEST], () => 25)).choose({ fen: MIDDLEGAME, moves: [] });
  assert.equal(choice.uci, BEST);
  assert.equal(choice.source, 'search');
  assert.equal(engine.probes(9).length, 1);
});

test('the level\'s margin caps what style may cost; endgames are stricter', () => {
  let engine = new ScriptedEngine({ scores: { f3e5: 30 } });
  bot(engine, scriptedStyle(['f3e5', BEST], () => 200)).choose({ fen: MIDDLEGAME, moves: [] });
  assert.deepEqual(engine.probes(8)[0].slice(1, 5), ['f3e5', -11, 31, 8]);      // limit 40
  engine = new ScriptedEngine({ scores: { f3e5: 30 } });
  bot(engine, scriptedStyle(['f3e5', BEST], () => 200), { ...LEVEL, styleMarginCp: 10 }).choose({ fen: MIDDLEGAME, moves: [] });
  assert.deepEqual(engine.probes(8)[0].slice(1, 5), ['f3e5', 19, 31, 8]);       // limit 10
  engine = new ScriptedEngine({ move: 'd1d7', scores: { g2f3: 30 } });
  bot(engine, scriptedStyle(['g2f3', 'd1d7'], () => 200)).choose({ fen: ENDGAME, moves: [] });
  assert.deepEqual(engine.probes(8)[0].slice(1, 5), ['g2f3', 14, 31, 8]);       // limit 15 in the endgame
});

test('style is not consulted when the game is decided or the search was shallow', () => {
  for (const script of [{ scoreCp: 600 }, { scoreCp: -520 }, { scoreCp: 99997 }, { depth: 2 }]) {
    const engine = new ScriptedEngine({ ...script, scores: { f3e5: 1000 } });
    const choice = bot(engine, scriptedStyle(['f3e5', BEST], () => 25)).choose({ fen: MIDDLEGAME, moves: [] });
    assert.equal(choice.uci, BEST);
    assert.equal(engine.probes().length, 0);
  }
});

test('among several candidates the best balance of style and cost wins', () => {
  // gains: f3e5 +2 (20 cp allowed), c1d2 +1 (10 cp allowed)
  const style = scriptedStyle(['f3e5', 'c1d2', BEST], gain => gain * 10);
  let engine = new ScriptedEngine({ scores: { f3e5: 12, c1d2: 30 } });   // surplus 2 against surplus 10
  assert.equal(bot(engine, style).choose({ fen: MIDDLEGAME, moves: [] }).uci, 'c1d2');
  assert.deepEqual(engine.probes(9).map(c => c[1]), ['c1d2'], 'only the winner is confirmed');
  // When the first candidate's surplus already beats anything a later one could reach, stop probing.
  engine = new ScriptedEngine({ scores: { f3e5: 25, c1d2: 30 } });       // surplus 15 > the 10 c1d2 could ever have
  assert.equal(bot(engine, style).choose({ fen: MIDDLEGAME, moves: [] }).uci, 'f3e5');
  assert.deepEqual(engine.probes(8).map(c => c[1]), ['f3e5']);
});

test('at most four candidates are probed, and a probe that ran out of time is skipped', () => {
  const many = ['f3e5', 'c1d2', 'h2h3', 'd1e2', 'b2b3', 'g2g3', BEST];
  let engine = new ScriptedEngine();                                      // every probe fails low
  assert.equal(bot(engine, scriptedStyle(many, () => 25)).choose({ fen: MIDDLEGAME, moves: [] }).uci, BEST);
  assert.equal(engine.probes(8).length, 4);
  engine = new ScriptedEngine({ scores: { f3e5: null, c1d2: 30 } });
  const choice = bot(engine, scriptedStyle(['f3e5', 'c1d2', BEST], () => 25)).choose({ fen: MIDDLEGAME, moves: [] });
  assert.equal(choice.uci, 'c1d2');
});

test('moves the style model ranks below the engine\'s are never probed', () => {
  const engine = new ScriptedEngine({ scores: { f3e5: 30 } });
  const choice = bot(engine, scriptedStyle([BEST, 'f3e5'], () => 25)).choose({ fen: MIDDLEGAME, moves: [] });
  assert.equal(choice.uci, BEST);
  assert.equal(engine.probes().length, 0);
});

test('game over is an error; newGame() resets the engine', () => {
  const engine = new ScriptedEngine();
  const fischer = bot(engine, null);
  assert.throws(() => fischer.choose({ fen: '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', moves: [] }));
  fischer.newGame();
  assert.deepEqual(engine.calls.at(-1), ['newGame']);
});
