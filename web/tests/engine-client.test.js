// engine-client.js: the worker path, the silent fallback to the server, and the reshaped reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineClient, fromServerReply, isPlayable } from '../static/js/engine-client.js';
import { STARTING_FEN } from '../static/js/rules.js';

/** A stand-in for a Worker that records what it is sent and answers when told to. */
class FakeWorker {
  sent = [];
  terminated = false;
  onmessage = null;
  onerror = null;
  postMessage(message) {
    if (this.terminated) throw new Error('terminated');
    this.sent.push(message);
  }
  terminate() { this.terminated = true; }
  answer(data) { this.onmessage({ data }); }
  last(type) { return this.sent.filter(message => message.type === type).at(-1); }
}

function fakeFetch(reply, { status = 200, calls = [] } = {}) {
  const fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), method: options.method });
    if (reply instanceof Error) throw reply;
    return { ok: status >= 200 && status < 300, status, json: async () => reply };
  };
  fetch.calls = calls;
  return fetch;
}

const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };
const SERVER_MOVE = { bot_move: 'e7e5', bot_move_san: 'e5', source: 'search', eval_cp: -20, depth: 8, nodes: 1234, time_ms: 300, pv: ['e7e5', 'g1f3'] };

test('fromServerReply reshapes the server\'s answer into the worker\'s', () => {
  assert.deepEqual(fromServerReply({ ...SERVER_MOVE, engine_move_san: 'c5', fen: 'x', status: 'in_progress', legal_moves: [] }), {
    uci: 'e7e5', san: 'e5', source: 'search', evalCp: -20, depth: 8, nodes: 1234, timeMs: 300, pv: ['e7e5', 'g1f3'],
    context: null, via: 'server', engineSan: 'c5',
  });
  const game = { key: 'wc1972#6', cite: 'Fischer–Spassky, World Championship 1972, Game 6', source: 'wc1972', number: 6 };
  const book = fromServerReply({ bot_move: 'c2c4', bot_move_san: 'c4', source: 'book', book: { game, count: 3 } });
  assert.equal(book.evalCp, null);
  assert.deepEqual(book.pv, []);
  assert.deepEqual(book.book, { game, games: [game], count: 3 });
  assert.throws(() => fromServerReply({ error: 'Unknown level' }), /Unknown level/);
  assert.throws(() => fromServerReply({ bot_move: null, status: 'checkmate' }), /no move/);
  assert.throws(() => fromServerReply(null), /no answer/);
});

test('the worker is initialised once and answers moves by id', async () => {
  const worker = new FakeWorker();
  const modes = [];
  const fetch = fakeFetch(SERVER_MOVE);
  const client = new EngineClient({ createWorker: () => worker, fetch, timers: noTimers, onMode: mode => modes.push(mode) });
  client.start();
  client.start();
  assert.equal(worker.sent.length, 1);
  assert.deepEqual(worker.sent[0], { type: 'init', id: worker.sent[0].id, urls: { book: '/static/data/book.json', style: '/static/data/style.json' } });
  worker.answer({ type: 'ready', id: worker.sent[0].id, info: { engine: 'test' } });
  assert.deepEqual(client.info, { engine: 'test' });

  const first = client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' });
  const second = client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'prodigy' });
  const [a, b] = worker.sent.filter(message => message.type === 'move');
  assert.deepEqual({ ...a, id: 0 }, { type: 'move', id: 0, fen: STARTING_FEN, moves: ['e2e4'], level: 'world' });
  assert.notEqual(a.id, b.id);
  // answers may come in any order; each goes to its own question
  worker.answer({ type: 'move', id: b.id, result: { uci: 'g8f6', san: 'Nf6' } });
  worker.answer({ type: 'move', id: a.id, result: { uci: 'c7c5', san: 'c5' } });
  worker.answer({ type: 'move', id: 9999, result: { uci: 'a7a6' } });       // nobody asked
  assert.deepEqual(await first, { uci: 'c7c5', san: 'c5', via: 'worker' });
  assert.deepEqual(await second, { uci: 'g8f6', san: 'Nf6', via: 'worker' });
  assert.equal(client.mode, 'worker');
  assert.deepEqual(modes, ['worker']);
  assert.equal(fetch.calls.length, 0);
  client.newGame();
  assert.equal(worker.last('newgame').type, 'newgame');
});

test('a worker that cannot be created: the server answers, silently', async () => {
  const fetch = fakeFetch(SERVER_MOVE);
  const client = new EngineClient({ createWorker: () => { throw new Error('no workers here'); }, fetch, timers: noTimers });
  client.start();
  assert.equal(client.mode, 'server');
  const result = await client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'champion' });
  assert.equal(result.uci, 'e7e5');
  assert.equal(result.via, 'server');
  assert.deepEqual(fetch.calls, [{ url: '/api/move', method: 'POST', body: { history: ['e2e4'], level: 'champion' } }]);
});

test('a worker that fails to load takes its open questions to the server', async () => {
  const worker = new FakeWorker();
  const fetch = fakeFetch(SERVER_MOVE);
  const client = new EngineClient({ createWorker: () => worker, fetch, timers: noTimers });
  const pending = client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' });   // starts the worker itself
  assert.equal(client.mode, 'worker');
  let prevented = false;
  worker.onerror({ preventDefault: () => { prevented = true; } });
  assert.equal((await pending).via, 'server');
  assert.ok(prevented, 'the error does not reach the console');
  assert.ok(worker.terminated);
  assert.equal(client.mode, 'server');
  assert.equal((await client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'world' })).via, 'server');
  assert.equal(fetch.calls.length, 2);
});

test('an init error means the worker is not to be trusted; a move error is retried on the server', async () => {
  const worker = new FakeWorker();
  const fetch = fakeFetch(SERVER_MOVE);
  const client = new EngineClient({ createWorker: () => worker, fetch, timers: noTimers });
  client.start();
  worker.answer({ type: 'ready', id: worker.sent[0].id, info: {} });
  const move = client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' });
  worker.answer({ type: 'error', id: worker.last('move').id, message: 'something broke' });
  assert.equal((await move).via, 'server');
  assert.equal(client.mode, 'worker', 'one bad answer does not condemn the worker');

  const other = new FakeWorker();
  const second = new EngineClient({ createWorker: () => other, fetch, timers: noTimers });
  second.start();
  const waiting = second.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' });
  other.answer({ type: 'error', id: other.sent[0].id, message: 'Cannot load the opening book' });
  assert.equal((await waiting).via, 'server');
  assert.equal(second.mode, 'server');
});

test('a silent worker is given up on after the level\'s time and a grace period', async () => {
  const worker = new FakeWorker();
  const timers = [];
  const fetch = fakeFetch(SERVER_MOVE);
  const client = new EngineClient({
    createWorker: () => worker, fetch,
    timers: { setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1, clearTimeout: () => {} },
  });
  client.start();
  worker.answer({ type: 'ready', id: worker.sent[0].id, info: {} });
  const move = client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world', timeMs: 2500 });
  const timer = timers.at(-1);
  assert.ok(timer.ms >= 2500 && timer.ms <= 2500 + 20000, `waits ${timer.ms} ms`);
  timer.fn();
  assert.equal((await move).via, 'server');
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'c7c5' } });   // too late: ignored
});

test('only when both have failed does the caller hear of it', async () => {
  const down = new EngineClient({
    createWorker: () => { throw new Error('no'); }, fetch: fakeFetch(new Error('offline')), timers: noTimers });
  await assert.rejects(down.move({ fen: STARTING_FEN, moves: [], level: 'world' }), /could not be reached/);

  const refused = new EngineClient({
    createWorker: () => { throw new Error('no'); }, fetch: fakeFetch({ error: 'Unknown level \'x\'' }, { status: 400 }), timers: noTimers });
  await assert.rejects(refused.move({ fen: STARTING_FEN, moves: [], level: 'x' }), /Unknown level/);

  const broken = new EngineClient({
    createWorker: () => { throw new Error('no'); }, fetch: fakeFetch(null, { status: 500 }), timers: noTimers });
  await assert.rejects(broken.move({ fen: STARTING_FEN, moves: [], level: 'world' }), /500/);
});

test('the server cannot play from a set-up position, and says so without being asked', async () => {
  const fetch = fakeFetch(SERVER_MOVE);
  const client = new EngineClient({ createWorker: () => { throw new Error('no'); }, fetch, timers: noTimers });
  await assert.rejects(client.move({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', moves: [], level: 'world' }), /starting position/);
  assert.equal(fetch.calls.length, 0);
});

test('dispose stops the worker and settles what was open', async () => {
  const worker = new FakeWorker();
  const client = new EngineClient({ createWorker: () => worker, fetch: fakeFetch(SERVER_MOVE), timers: noTimers });
  const move = client.move({ fen: STARTING_FEN, moves: [], level: 'world' });
  client.dispose();
  assert.ok(worker.terminated);
  await assert.rejects(move, /shut down/);
});

// ---------------------------------------------------------------------------
// Regressions from the QA review
// ---------------------------------------------------------------------------

test('isPlayable: a legal move in the position, and nothing else', () => {
  assert.equal(isPlayable({ fen: STARTING_FEN, moves: ['e2e4'] }, 'e7e5'), true);
  assert.equal(isPlayable({ fen: STARTING_FEN, moves: [] }, 'e7e5'), false, 'not his turn');
  assert.equal(isPlayable({ fen: STARTING_FEN, moves: ['e2e4'] }, 'e7e4'), false);
  for (const junk of [undefined, null, '', 'e5', 'zzzz', 42, {}]) {
    assert.equal(isPlayable({ fen: STARTING_FEN, moves: ['e2e4'] }, junk), false);
  }
  assert.equal(isPlayable({ fen: 'not a fen', moves: [] }, 'e2e4'), false);
  assert.equal(isPlayable({ fen: '8/P6k/8/8/8/8/8/K7 w - - 0 1', moves: [] }, 'a7a8q'), true);
});

test('a worker that answers with something unplayable is treated like one that failed: the server is asked', async () => {
  for (const result of [{ uci: 'e7e4', san: '??' }, {}, null, { uci: '' }]) {
    const worker = new FakeWorker();
    const fetch = fakeFetch(SERVER_MOVE);
    const client = new EngineClient({ createWorker: () => worker, fetch, timers: noTimers });
    client.start();
    worker.answer({ type: 'ready', id: worker.sent[0].id, info: {} });
    const move = client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' });
    worker.answer({ type: 'move', id: worker.last('move').id, result });
    const answer = await move;
    assert.equal(answer.via, 'server');
    assert.equal(answer.uci, 'e7e5');
    assert.equal(fetch.calls.length, 1);
    assert.equal(client.mode, 'worker', 'one bad answer does not condemn the worker');
  }
});

test('when both fail the error says what happened', async () => {
  const ask = async (reply, options) => {
    const client = new EngineClient({ createWorker: () => { throw new Error('no workers'); }, fetch: fakeFetch(reply, options), timers: noTimers });
    client.start();
    try {
      await client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' });
    } catch (error) {
      return error;
    }
    return null;
  };
  const offline = await ask(new TypeError('Failed to fetch'));
  assert.equal(offline.kind, 'unreachable');
  const broken = await ask(null, { status: 500 });
  assert.equal(broken.kind, 'server');
  assert.match(broken.message, /500/);
  const refused = await ask({ error: 'Unknown level' }, { status: 400 });
  assert.equal(refused.kind, 'server');
  const illegal = await ask({ ...SERVER_MOVE, bot_move: 'e7e4' });
  assert.equal(illegal.kind, 'move');
  assert.match(illegal.message, /cannot be played/);
  const client = new EngineClient({ createWorker: () => { throw new Error('no workers'); }, fetch: fakeFetch(SERVER_MOVE), timers: noTimers });
  await assert.rejects(client.move({ fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1', moves: [], level: 'world' }), error => error.kind === 'position');
});

test('a silent worker is not waited for much longer than the level thinks', async () => {
  const worker = new FakeWorker();
  const timers = [];
  const client = new EngineClient({
    createWorker: () => worker, fetch: fakeFetch(SERVER_MOVE),
    timers: { setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1, clearTimeout: () => {} },
  });
  client.start();
  worker.answer({ type: 'ready', id: worker.sent[0].id, info: {} });
  const move = client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'prodigy', timeMs: 600 });
  const timer = timers.at(-1);
  assert.ok(timer.ms <= 600 + 6000, `gives up after ${timer.ms} ms`);
  timer.fn();
  assert.equal((await move).via, 'server');
});
