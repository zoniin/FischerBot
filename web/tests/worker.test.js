// The worker's protocol (worker.js, BotHost), driven without a Worker: a
// scripted engine, the real book, and a `post` that clones every answer the
// way postMessage would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { staticData } from './helpers.js';
import { Position } from '../static/js/rules.js';
import { Book } from '../static/js/book.js';
import { LEVELS } from '../static/js/bot.js';
import { BotHost } from '../static/js/worker.js';

const book = new Book(staticData('book.json'));
const START = new Position().fen();
const NAJDORF = ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3'];
const MIDDLEGAME = 'r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 14';
const MATED = '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1';

/** Plays the alphabetically first legal move, or what the script says, and records how it was asked. */
class ScriptedEngine {
  constructor({ scores = {}, scoreCp = 30, depth = 8 } = {}) {
    Object.assign(this, { scores, scoreCp, depth, calls: [] });
  }
  newGame() { this.calls.push(['newGame']); }
  setPosition(fen, moves = []) {
    this.calls.push(['setPosition', fen, moves.slice()]);
    this.position = Position.fromMoves(moves, fen);
  }
  search(limits) {
    this.calls.push(['search', limits]);
    const move = this.position.legalMoves().map(m => m.uci()).sort()[0];
    return { move, scoreCp: this.scoreCp, depth: this.depth, nodes: 99, timeMs: 1, pv: [move] };
  }
  scoreMove(uci, lower, upper, depth, limits) {
    this.calls.push(['scoreMove', uci, lower, upper, depth, limits]);
    return uci in this.scores ? this.scores[uci] : lower;
  }
}

/** A host around a scripted engine; `out` collects its answers as the page would receive them. */
function start({ engine = new ScriptedEngine(), style = null, random = () => 0, load } = {}) {
  const out = [];
  const host = new BotHost({
    post: message => out.push(structuredClone(message)),
    load: load ?? (async () => ({ engine, book, style, engineName: 'scripted' })),
    random,
  });
  return { host, out, engine };
}

test('init builds the bot and says what it knows', async () => {
  const { host, out } = start();
  await host.receive({ type: 'init', id: 1, urls: { book: '/b.json', style: '/s.json' } });
  assert.deepEqual(out, [{
    type: 'ready', id: 1,
    info: { engine: 'scripted', bookGames: 731, bookPositions: book.size, levels: ['prodigy', 'grandmaster', 'champion', 'world'] },
  }]);
});

test('init hands the URLs of the request to the loader', async () => {
  const seen = [];
  const { host } = start({ load: async urls => { seen.push(urls); return { engine: new ScriptedEngine(), book, style: null }; } });
  await host.receive({ type: 'init', id: 1, urls: { book: '/static/data/book.json', style: '/static/data/style.json' } });
  await host.receive({ type: 'init', id: 2 });
  assert.deepEqual(seen, [{ book: '/static/data/book.json', style: '/static/data/style.json' }, {}]);
});

test('a move request is answered with the choice and its context', async () => {
  const { host, out, engine } = start();
  await host.receive({ type: 'init', id: 1 });
  await host.receive({ type: 'move', id: 2, fen: START, moves: [], level: 'world' });
  await host.receive({ type: 'move', id: 3, fen: START, moves: NAJDORF, level: 'world' });
  await host.receive({ type: 'move', id: 4, fen: MIDDLEGAME, moves: [], level: 'champion' });

  const first = out[1];
  assert.equal(first.type, 'move');
  assert.equal(first.id, 2);
  assert.equal(first.result.uci, 'e2e4');
  assert.equal(first.result.san, 'e4');
  assert.equal(first.result.source, 'book');
  assert.ok(first.result.book.count > 300);
  assert.deepEqual(first.result.context, { ply: 0, phase: 0, playerMove: null, opening: null });

  const najdorf = out[2].result;
  assert.equal(najdorf.uci, 'a7a6');
  assert.equal(najdorf.book.game.key, 'wc1972#7');
  assert.equal(najdorf.context.ply, 9);
  assert.equal(najdorf.context.playerMove.kind, 'follows');
  assert.equal(najdorf.context.playerMove.san, 'Nc3');
  assert.deepEqual(najdorf.context.playerMove.game, book.games.find(game => game.key === 'wc1972#7'));
  assert.deepEqual(najdorf.context.opening, { eco: 'B97', family: 'sicilian_najdorf' });

  const searched = out[3].result;
  assert.equal(out[3].id, 4);
  assert.equal(searched.source, 'search');
  assert.equal(searched.uci, 'a1b1');
  assert.equal(searched.san, 'Rb1');
  assert.equal(searched.evalCp, 30);
  assert.equal(searched.depth, 8);
  assert.deepEqual(searched.pv, ['a1b1']);
  assert.deepEqual(searched.context, { ply: 0, phase: 1, playerMove: null, opening: null });
  // the search ran with the limits of the level that was asked for
  const champion = LEVELS.find(level => level.id === 'champion');
  const limits = engine.calls.find(call => call[0] === 'search')[1];
  assert.equal(limits.maxDepth, champion.maxDepth);
  assert.equal(limits.nodeLimit, champion.nodeLimit);
  assert.ok(limits.timeMs > 0 && limits.timeMs <= champion.timeMs);
});

test('the level of each request decides the book and the search', async () => {
  const { host, out, engine } = start({ random: () => 0.99 });
  await host.receive({ type: 'init', id: 1 });
  await host.receive({ type: 'move', id: 2, fen: START, moves: [], level: 'prodigy' });
  await host.receive({ type: 'move', id: 3, fen: START, moves: [], level: 'world' });
  await host.receive({ type: 'move', id: 4, fen: MIDDLEGAME, moves: [], level: 'prodigy' });
  await host.receive({ type: 'move', id: 5, fen: MIDDLEGAME, moves: [], level: LEVELS[3] });   // a level object is taken by its id
  assert.equal(out[1].result.uci, 'g1f3');
  assert.ok(out[1].result.book.games.every(game => game.year <= 1956));
  assert.equal(out[2].result.uci, 'b2b3');                       // only the World Champion knows 1.b3
  assert.ok(out[2].result.book.games.some(game => game.year > 1963));
  const searches = engine.calls.filter(call => call[0] === 'search').map(call => call[1]);
  assert.deepEqual(searches.map(limits => limits.nodeLimit), [LEVELS[0].nodeLimit, LEVELS[3].nodeLimit]);
  assert.deepEqual(searches.map(limits => limits.maxDepth), [LEVELS[0].maxDepth, LEVELS[3].maxDepth]);
});

test('style choices come through, with the move they replaced', async () => {
  const style = {
    enginePreference: 0,
    styleScores: position => position.legalMoves()
      .map(move => ({ move, score: move.uci() === 'f3e5' ? 2 : move.uci() === 'a1b1' ? 1 : -100 }))
      .sort((a, b) => b.score - a.score),
    allowedLoss: (phase, gain) => (gain > 0 ? 25 : -1),
  };
  const { host, out } = start({ engine: new ScriptedEngine({ scores: { f3e5: 20 } }), style });
  await host.receive({ type: 'init', id: 1 });
  await host.receive({ type: 'move', id: 2, fen: MIDDLEGAME, moves: [], level: 'world' });
  const result = out[1].result;
  assert.equal(result.source, 'search+style');
  assert.equal(result.uci, 'f3e5');
  assert.equal(result.san, 'Ne5');
  assert.equal(result.engineSan, 'Rb1');
  assert.equal(result.context.phase, 1);
});

test('newgame resets the engine and is acknowledged', async () => {
  const { host, out, engine } = start();
  await host.receive({ type: 'init', id: 'a' });
  await host.receive({ type: 'newgame', id: 'b' });
  assert.deepEqual(engine.calls, [['newGame']]);
  assert.equal(out[1].type, 'ready');
  assert.equal(out[1].id, 'b');
  assert.deepEqual(out[1].info, out[0].info);
});

test('requests before init are refused with an error, not lost', async () => {
  const { host, out } = start();
  await host.receive({ type: 'move', id: 7, fen: START, moves: [], level: 'world' });
  await host.receive({ type: 'newgame', id: 8 });
  assert.deepEqual(out.map(answer => [answer.type, answer.id]), [['error', 7], ['error', 8]]);
  assert.match(out[0].message, /init/);
  await host.receive({ type: 'init', id: 9 });
  await host.receive({ type: 'move', id: 10, fen: START, moves: [], level: 'world' });
  assert.deepEqual(out.slice(2).map(answer => [answer.type, answer.id]), [['ready', 9], ['move', 10]]);
});

test('requests that arrive while init is still loading wait for it', async () => {
  let finish;
  const loading = new Promise(resolve => { finish = resolve; });
  const { host, out } = start({ load: () => loading });
  const pending = [
    host.receive({ type: 'init', id: 1 }),
    host.receive({ type: 'move', id: 2, fen: START, moves: [], level: 'world' }),
    host.receive({ type: 'newgame', id: 3 }),
    host.receive({ type: 'move', id: 4, fen: START, moves: ['e2e4'], level: 'grandmaster' }),
  ];
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(out, [], 'nothing is answered before the data is there');
  finish({ engine: new ScriptedEngine(), book, style: null });
  await Promise.all(pending);
  assert.deepEqual(out.map(answer => [answer.type, answer.id]), [['ready', 1], ['move', 2], ['ready', 3], ['move', 4]]);
});

test('a failed init is reported, and so is every request until an init succeeds', async () => {
  let attempts = 0;
  const { host, out } = start({
    load: async () => {
      if (attempts++ === 0) throw new Error('Could not load the opening book (/nowhere.json): HTTP 404');
      return { engine: new ScriptedEngine(), book, style: null };
    },
  });
  await host.receive({ type: 'init', id: 1, urls: { book: '/nowhere.json' } });
  await host.receive({ type: 'move', id: 2, fen: START, moves: [], level: 'world' });
  assert.deepEqual(out.map(answer => [answer.type, answer.id]), [['error', 1], ['error', 2]]);
  assert.match(out[0].message, /HTTP 404/);
  assert.match(out[1].message, /could not be started.*HTTP 404/);
  await host.receive({ type: 'init', id: 3 });
  await host.receive({ type: 'move', id: 4, fen: START, moves: [], level: 'world' });
  assert.deepEqual(out.slice(2).map(answer => [answer.type, answer.id]), [['ready', 3], ['move', 4]]);
});

test('a second init that fails leaves the running bot in place', async () => {
  let attempts = 0;
  const { host, out } = start({
    load: async () => {
      if (attempts++ === 1) throw new Error('offline');
      return { engine: new ScriptedEngine(), book, style: null };
    },
  });
  await host.receive({ type: 'init', id: 1 });
  await host.receive({ type: 'init', id: 2 });
  await host.receive({ type: 'move', id: 3, fen: START, moves: [], level: 'world' });
  assert.deepEqual(out.map(answer => [answer.type, answer.id]), [['ready', 1], ['error', 2], ['move', 3]]);
});

test('every bad request is answered with an error that carries its id', async () => {
  const { host, out } = start();
  await host.receive({ type: 'init', id: 0 });
  const bad = [
    [{ type: 'move', id: 1, fen: START, moves: [], level: 'beginner' }, /Unknown level "beginner"/],
    [{ type: 'move', id: 2, fen: START, moves: [] }, /Unknown level/],
    [{ type: 'move', id: 3, fen: START, moves: 'e2e4', level: 'world' }, /moves must be an array/],
    [{ type: 'move', id: 4, fen: START, moves: ['e2e4', 'e7e5', 'zz'], level: 'world' }, /Malformed move at index 2/],
    [{ type: 'move', id: 5, fen: START, moves: ['e2e4', 'e7e5', 'e4e5'], level: 'world' }, /Illegal move at index 2: 'e4e5'/],
    [{ type: 'move', id: 6, fen: START, moves: [null], level: 'world' }, /Malformed move at index 0/],
    [{ type: 'move', id: 7, fen: 'not a position', moves: [], level: 'world' }, /Invalid FEN/],
    [{ type: 'move', id: 8, fen: 42, moves: [], level: 'world' }, /fen must be a string/],
    [{ type: 'move', id: 9, fen: MATED, moves: [], level: 'world' }, /Game is already over \(checkmate\)/],
    [{ type: 'resign', id: 10 }, /Unknown request type "resign"/],
    [{ id: 11 }, /Unknown request type/],
  ];
  for (const [request, pattern] of bad) {
    await host.receive(request);
    const answer = out.at(-1);
    assert.equal(answer.type, 'error', JSON.stringify(request));
    assert.equal(answer.id, request.id);
    assert.match(answer.message, pattern);
  }
  // things that are not requests at all are answered too (there is no id to carry)
  for (const junk of [null, undefined, 'move', 17, []]) {
    await host.receive(junk);
    assert.equal(out.at(-1).type, 'error');
    assert.equal(out.at(-1).id, undefined);
  }
  assert.equal(out.length, 1 + bad.length + 5, 'one answer per request');
  // and the bot is none the worse for it
  await host.receive({ type: 'move', id: 99, fen: START, moves: [], level: 'world' });
  assert.deepEqual([out.at(-1).type, out.at(-1).id, out.at(-1).result.uci], ['move', 99, 'e2e4']);
});

test('requests sent back to back are answered one at a time, in order', async () => {
  const { host, out, engine } = start();
  const sent = [
    host.receive({ type: 'init', id: 1 }),
    host.receive({ type: 'move', id: 2, fen: MIDDLEGAME, moves: [], level: 'world' }),
    host.receive({ type: 'move', id: 3, fen: MIDDLEGAME, moves: ['a2a3'], level: 'prodigy' }),
    host.receive({ type: 'bogus', id: 4 }),
    host.receive({ type: 'move', id: 5, fen: MIDDLEGAME, moves: ['a2a3', 'a7a6'], level: 'world' }),
  ];
  await Promise.all(sent);
  assert.deepEqual(out.map(answer => [answer.type, answer.id]), [['ready', 1], ['move', 2], ['move', 3], ['error', 4], ['move', 5]]);
  // each search was set up with its own game
  assert.deepEqual(engine.calls.filter(call => call[0] === 'setPosition').map(call => call[2].length), [0, 1, 2]);
});

test('an answer that cannot be delivered becomes an error', async () => {
  const out = [];
  let refuse = 0;
  const host = new BotHost({
    post: message => {
      if (message.type === 'move' && refuse-- > 0) throw new Error('DataCloneError');
      out.push(structuredClone(message));
    },
    load: async () => ({ engine: new ScriptedEngine(), book, style: null }),
    random: () => 0,
  });
  await host.receive({ type: 'init', id: 1 });
  refuse = 1;
  await host.receive({ type: 'move', id: 2, fen: START, moves: [], level: 'world' });
  await host.receive({ type: 'move', id: 3, fen: START, moves: [], level: 'world' });
  assert.deepEqual(out.map(answer => [answer.type, answer.id]), [['ready', 1], ['error', 2], ['move', 3]]);
  assert.match(out[1].message, /could not be sent.*DataCloneError/);
});

test('the host cannot be built without its two functions', () => {
  assert.throws(() => new BotHost({ post: () => {} }), TypeError);
  assert.throws(() => new BotHost({ load: async () => ({}) }), TypeError);
});
