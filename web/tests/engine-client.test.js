// engine-client.js: the worker path, the silent fallback to the server, and the reshaped reply.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineClient, SERVER_TIMEOUT_MS, fromServerReply, isPlayable } from '../static/js/engine-client.js';
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

/** A server that answers when the test says so: every call waits in `fetch.calls`. */
function slowFetch() {
  const calls = [];
  const fetch = (url, options) => new Promise((resolve, reject) => {
    calls.push({
      url, body: JSON.parse(options.body), signal: options.signal, reject,
      answer: (reply, status = 200) => resolve({ ok: status >= 200 && status < 300, status, json: async () => reply }),
      respond: response => resolve(response),
    });
  });
  fetch.calls = calls;
  return fetch;
}

/** A clock that only moves when the test fires a timer. Everything it is asked goes into `log`, if there is one. */
function fakeClock(log = null) {
  const timers = [];
  return {
    timers,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      if (log !== null) log.push(`timer ${ms}`);
      return timers.length;
    },
    clearTimeout: handle => {
      if (Number.isInteger(handle) && handle > 0) timers[handle - 1].cleared = true;
    },
    /** The timers that are still running. */
    get running() { return timers.filter(timer => !timer.cleared); },
  };
}

/** How a promise ended, without leaving a rejection unhandled meanwhile: { value } or { error }; null while it is open. */
function watch(promise) {
  const outcome = { ended: null };
  promise.then(value => { outcome.ended = { value }; }, error => { outcome.ended = { error }; });
  return outcome;
}

/** Lets every promise that can settle do so. */
const settled = () => new Promise(resolve => setImmediate(resolve));

/** A client with a fake worker that is ready, a fake clock, and a log of everything posted and timed. */
function readyClient({ fetch = fakeFetch(SERVER_MOVE) } = {}) {
  const log = [];
  const worker = new FakeWorker();
  const post = worker.postMessage.bind(worker);
  worker.postMessage = message => {
    post(message);
    log.push(message.type === 'move' ? `post move ${message.moves.join(' ')}` : `post ${message.type}`);
  };
  const clock = fakeClock(log);
  const client = new EngineClient({ createWorker: () => worker, fetch, timers: clock });
  client.start();
  worker.answer({ type: 'ready', id: worker.sent[0].id, info: {} });
  log.length = 0;
  return { client, worker, clock, log, fetch };
}
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
  const [a] = worker.sent.filter(message => message.type === 'move');
  assert.deepEqual({ ...a, id: 0 }, { type: 'move', id: 0, fen: STARTING_FEN, moves: ['e2e4'], level: 'world' });
  worker.answer({ type: 'move', id: 9999, result: { uci: 'a7a6' } });       // nobody asked
  worker.answer({ type: 'move', id: a.id, result: { uci: 'c7c5', san: 'c5' } });
  assert.deepEqual(await first, { uci: 'c7c5', san: 'c5', via: 'worker' });
  const second = client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'prodigy' });
  const [, b] = worker.sent.filter(message => message.type === 'move');
  assert.notEqual(a.id, b.id);
  worker.answer({ type: 'move', id: a.id, result: { uci: 'c7c5', san: 'c5' } });   // the old answer again: not for this question
  worker.answer({ type: 'move', id: b.id, result: { uci: 'g8f6', san: 'Nf6' } });
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

// ---------------------------------------------------------------------------
// Regressions from the last review before the site went live
// ---------------------------------------------------------------------------

const superseded = outcome => outcome.ended?.error?.kind === 'superseded';

test('one question at a time in the worker, and the latest one replaces whatever was waiting', async () => {
  // the top level: a move, then four times "take back and move" while he is still thinking about the first
  const { client, worker, clock, log, fetch } = readyClient();
  const ask = moves => watch(client.move({ fen: STARTING_FEN, moves, level: 'world', timeMs: 2500 }));
  const first = ask(['e2e4']);
  assert.deepEqual(log, ['timer 7500', 'post move e2e4'], 'posted at once; its clock: the level\'s time and five seconds');
  const stale = [ask(['d2d4']), ask(['c2c4']), ask(['g1f3'])];
  const real = ask(['b2b3']);
  await settled();
  assert.deepEqual(log, ['timer 7500', 'post move e2e4'], 'nothing else is posted while one question is out, and no clock runs for it');
  assert.equal(clock.running.length, 1);
  assert.ok(stale.every(superseded), 'the three that were replaced are settled, as "superseded"');
  assert.equal(first.ended, null);
  assert.equal(real.ended, null);

  // he answers the first (nobody wants it any more, but it is an answer): now the latest goes, and its clock starts
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'c7c5', san: 'c5' } });
  await settled();
  assert.deepEqual(first.ended, { value: { uci: 'c7c5', san: 'c5', via: 'worker' } });
  assert.deepEqual(log, ['timer 7500', 'post move e2e4', 'timer 7500', 'post move b2b3']);
  assert.equal(clock.running.length, 1, 'the first question\'s clock was stopped');
  assert.equal(clock.running[0], clock.timers.at(-1));
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'e7e5', san: 'e5' } });
  await settled();
  assert.deepEqual(real.ended, { value: { uci: 'e7e5', san: 'e5', via: 'worker' } });
  assert.equal(clock.running.length, 0);
  assert.deepEqual(worker.sent.map(message => message.type), ['init', 'move', 'move'], 'two searches, not five');
  assert.equal(fetch.calls.length, 0, 'and the server was never asked');
  assert.equal(client.mode, 'worker');
});

test('a question that was replaced never goes to the server - not even when the worker falls silent', async () => {
  const { client, worker, clock, log, fetch } = readyClient();
  const ask = moves => watch(client.move({ fen: STARTING_FEN, moves, level: 'world', timeMs: 2500 }));
  const first = ask(['e2e4']);
  const second = ask(['d2d4']);
  const third = ask(['c2c4']);
  await settled();
  assert.ok(superseded(second));

  // the worker says nothing about the first: it is given up - and not taken to the server, a newer question is waiting
  clock.running[0].fn();
  await settled();
  assert.ok(superseded(first), 'nobody wants the answer to the first any more');
  assert.equal(fetch.calls.length, 0);
  assert.deepEqual(log, ['timer 7500', 'post move e2e4', 'timer 7500', 'post move c2c4'], 'the latest one gets its turn, and its own full time');
  assert.equal(third.ended, null);

  // silence again: this one is the latest, so the server is asked - for this one alone
  clock.timers.at(-1).fn();
  await settled();
  assert.equal(third.ended.value.via, 'server');
  assert.deepEqual(fetch.calls.map(call => call.body.history), [['c2c4']]);
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'e7e5' } });   // too late: ignored
  assert.equal(client.mode, 'worker');
});

test('the worker\'s errors and bad answers for a question nobody wants are not taken to the server either', async () => {
  for (const fail of [
    (worker, id) => worker.answer({ type: 'error', id, message: 'something broke' }),
    (worker, id) => worker.answer({ type: 'move', id, result: { uci: 'e7e4' } }),
    worker => worker.onerror({ preventDefault() {} }),
  ]) {
    const { client, worker, fetch } = readyClient();
    const first = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' }));
    const second = watch(client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'world' }));
    const latest = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' }));
    fail(worker, worker.last('move').id);
    await settled();
    assert.ok(superseded(first));
    assert.ok(superseded(second));
    if (client.mode === 'server') {
      // the worker is gone: the latest question, and only that one, is the server's
      assert.deepEqual(fetch.calls.map(call => call.body.history), [['e2e4']]);
      assert.equal(latest.ended.value.via, 'server');
    } else {
      assert.equal(fetch.calls.length, 0);
      assert.deepEqual(worker.sent.filter(message => message.type === 'move').map(message => message.moves), [['e2e4'], ['e2e4']]);
      worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'e7e5' } });
      await settled();
      assert.equal(latest.ended.value.via, 'worker');
    }
  }
});

test('a held question waits for the worker\'s data like any other: its clock is set when it is posted', async () => {
  const log = [];
  const worker = new FakeWorker();
  const clock = fakeClock(log);
  const client = new EngineClient({ createWorker: () => worker, fetch: fakeFetch(SERVER_MOVE), timers: clock });
  const first = watch(client.move({ fen: STARTING_FEN, moves: [], level: 'prodigy', timeMs: 600 }));   // starts the worker itself
  const second = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'prodigy', timeMs: 600 }));
  assert.deepEqual(log, ['timer 25000', 'timer 30600'], 'the book is still loading: the first question may wait for it');
  worker.answer({ type: 'ready', id: worker.sent[0].id, info: {} });
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'e2e4' } });
  await settled();
  assert.equal(first.ended.value.uci, 'e2e4');
  assert.deepEqual(log, ['timer 25000', 'timer 30600', 'timer 5600'], 'posted now, with the data loaded: the level\'s time and five seconds');
  assert.deepEqual(worker.sent.map(message => message.type), ['init', 'move', 'move']);
  assert.equal(second.ended, null);
});

test('a new game reaches the worker after the question that is out and before the next one', async () => {
  const { client, worker, log, fetch } = readyClient();
  const first = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world', timeMs: 2500 }));
  const second = watch(client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'world', timeMs: 2500 }));
  client.newGame();
  await settled();
  assert.ok(superseded(second), 'a question of the last game that was still waiting is not sent after the new game has begun');
  const third = watch(client.move({ fen: STARTING_FEN, moves: [], level: 'world', timeMs: 2500 }));
  assert.deepEqual(log, ['timer 7500', 'post move e2e4', 'post newgame']);
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'e7e5' } });
  worker.answer({ type: 'ready', id: worker.last('newgame').id, info: {} });
  await settled();
  assert.equal(first.ended.value.uci, 'e7e5');
  assert.deepEqual(log, ['timer 7500', 'post move e2e4', 'post newgame', 'timer 7500', 'post move ']);
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'e2e4' } });
  await settled();
  assert.equal(third.ended.value.via, 'worker');

  // a question of the last game that the worker then fails with is nobody's any more
  const old = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' }));
  client.newGame();
  worker.answer({ type: 'error', id: worker.last('move').id, message: 'something broke' });
  await settled();
  assert.ok(superseded(old));
  assert.equal(fetch.calls.length, 0);
  // with nothing waiting and nothing out, a new game is posted at once and the next question after it
  client.newGame();
  const next = watch(client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'world' }));
  assert.deepEqual(worker.sent.slice(-2).map(message => message.type), ['newgame', 'move']);
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'd7d5' } });
  await settled();
  assert.equal(next.ended.value.uci, 'd7d5');
});

test('forget(): what is waiting is never sent, and what is out is not taken to the server', async () => {
  const { client, worker, clock, fetch } = readyClient();
  const first = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' }));
  const second = watch(client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'world' }));
  client.forget();
  await settled();
  assert.ok(superseded(second));
  assert.equal(first.ended, null, 'the search cannot be stopped: its answer is still taken when it comes');
  clock.running[0].fn();                                   // ... but if none comes, nobody asks the server for it
  await settled();
  assert.ok(superseded(first));
  assert.equal(fetch.calls.length, 0);
  assert.equal(worker.sent.filter(message => message.type === 'move').length, 1);
  client.forget();                                         // nothing open: nothing happens
  const next = watch(client.move({ fen: STARTING_FEN, moves: ['c2c4'], level: 'world' }));
  worker.answer({ type: 'move', id: worker.last('move').id, result: { uci: 'e7e5' } });
  await settled();
  assert.equal(next.ended.value.via, 'worker', 'a question asked afterwards is an ordinary one');
});

test('with the server too: one question out, the latest one next', async () => {
  const fetch = slowFetch();
  const client = new EngineClient({ createWorker: () => { throw new Error('no workers here'); }, fetch, timers: fakeClock() });
  const ask = moves => watch(client.move({ fen: STARTING_FEN, moves, level: 'world' }));
  const first = ask(['e2e4']);
  const second = ask(['d2d4']);
  const third = ask(['c2c4']);
  await settled();
  assert.deepEqual(fetch.calls.map(call => call.body.history), [['e2e4']]);
  assert.ok(superseded(second));
  fetch.calls[0].answer(SERVER_MOVE);
  await settled();
  assert.equal(first.ended.value.uci, 'e7e5');
  assert.deepEqual(fetch.calls.map(call => call.body.history), [['e2e4'], ['c2c4']]);
  fetch.calls[1].answer({ ...SERVER_MOVE, bot_move: 'e7e6', bot_move_san: 'e6' });
  await settled();
  assert.equal(third.ended.value.uci, 'e7e6');
});

test('the server has twenty seconds for the whole exchange, then it counts as unreachable', async () => {
  assert.equal(SERVER_TIMEOUT_MS, 20000);
  const start = () => {
    const fetch = slowFetch();
    const clock = fakeClock();
    const client = new EngineClient({ createWorker: () => { throw new Error('no workers here'); }, fetch, timers: clock });
    const move = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' }));
    return { fetch, clock, client, move };
  };

  // the request is never answered
  const stalled = start();
  await settled();
  assert.deepEqual(stalled.clock.running.map(timer => timer.ms), [20000]);
  assert.equal(stalled.move.ended, null, 'still waiting: no real time passes in this test');
  assert.equal(stalled.fetch.calls[0].signal.aborted, false);
  stalled.clock.running[0].fn();
  await settled();
  assert.equal(stalled.move.ended.error.kind, 'unreachable');
  assert.match(stalled.move.ended.error.message, /^The server did not answer within 20 seconds$/);
  assert.equal(stalled.fetch.calls[0].signal.aborted, true, 'the request is given up, not left open');
  stalled.fetch.calls[0].answer(SERVER_MOVE);              // an answer after all: nobody is listening
  await settled();
  assert.equal(stalled.move.ended.error.kind, 'unreachable');

  // the headers come, the body never does: the same limit, the same clock
  const half = start();
  await settled();
  half.fetch.calls[0].respond({ ok: true, status: 200, json: () => new Promise(() => {}) });
  await settled();
  assert.equal(half.move.ended, null);
  assert.deepEqual(half.clock.running.map(timer => timer.ms), [20000], 'one clock for request and body together');
  half.clock.running[0].fn();
  await settled();
  assert.equal(half.move.ended.error.kind, 'unreachable');
  assert.equal(half.fetch.calls[0].signal.aborted, true);

  // a fetch that fails because it was given up reports the limit, not the abort
  const aborted = start();
  await settled();
  aborted.fetch.calls[0].signal.addEventListener('abort', () => {
    aborted.fetch.calls[0].reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
  });
  aborted.clock.running[0].fn();
  await settled();
  assert.match(aborted.move.ended.error.message, /did not answer within 20 seconds/);

  // an answer in time stops the clock, and the next question is not held up
  const fine = start();
  await settled();
  fine.fetch.calls[0].answer(SERVER_MOVE);
  await settled();
  assert.equal(fine.move.ended.value.via, 'server');
  assert.equal(fine.clock.running.length, 0, 'no clock left running');
  assert.equal(fine.fetch.calls[0].signal.aborted, false);

  // after a stalled exchange the question that was waiting gets its turn
  const queue = start();
  const later = watch(queue.client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'world' }));
  await settled();
  assert.equal(queue.fetch.calls.length, 1);
  queue.clock.running[0].fn();
  await settled();
  assert.equal(queue.move.ended.error.kind, 'unreachable');
  assert.deepEqual(queue.fetch.calls.map(call => call.body.history), [['e2e4'], ['d2d4']]);
  queue.fetch.calls[1].answer({ ...SERVER_MOVE, bot_move: 'd7d5', bot_move_san: 'd5' });
  await settled();
  assert.equal(later.ended.value.uci, 'd7d5');
});

test('the worker gone and the line stalled: "unreachable" after the limit, not "thinking" for ever', async () => {
  const { client, worker, clock } = readyClient({ fetch: slowFetch() });
  const move = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world', timeMs: 2500 }));
  worker.onerror({ preventDefault() {} });
  await settled();
  assert.equal(client.mode, 'server');
  assert.deepEqual(clock.running.map(timer => timer.ms), [20000]);
  clock.running[0].fn();
  await settled();
  assert.equal(move.ended.error.kind, 'unreachable');
});

test('dispose settles the question that is out and the one that is waiting', async () => {
  const { client, worker, clock } = readyClient();
  const first = watch(client.move({ fen: STARTING_FEN, moves: ['e2e4'], level: 'world' }));
  const second = watch(client.move({ fen: STARTING_FEN, moves: ['d2d4'], level: 'world' }));
  client.dispose();
  await settled();
  assert.match(first.ended.error.message, /shut down/);
  assert.match(second.ended.error.message, /shut down/);
  assert.equal(clock.running.length, 0);
  assert.ok(worker.terminated);
});
