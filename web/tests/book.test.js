// The browser's opening book must answer exactly as fischerbot/book.py does
// (tools/make_fixtures.py writes the reference answers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, staticData } from './helpers.js';
import { Position } from '../static/js/rules.js';
import { Book } from '../static/js/book.js';

const book = new Book(staticData('book.json'));
const data = fixture('book_cases');

function rows(moves) {
  return moves.map(m => [m.uci, m.count, m.points, m.games.slice(0, 4).map(g => g.key)]);
}

function compare(got, want, where) {
  assert.deepEqual(rows(got), want.map(([uci, count, points, , keys]) => [uci, count, points, keys]), where);
  got.forEach((m, i) => {
    assert.ok(Math.abs(m.weight - want[i][3]) < 1e-8, `weight of ${m.uci} ${where}: ${m.weight} vs ${want[i][3]}`);
    assert.equal(m.games.length, m.count);
  });
}

test('the book file', () => {
  assert.equal(book.games.length, 731);
  assert.ok(book.size > 9000);
  assert.equal(book.games[0].key, 'm60mg#1');
});

test('lookups, replies and picks match the Python book in every era', () => {
  let withMoves = 0;
  for (const c of data.cases) {
    const position = Position.fromMoves(c.moves);
    assert.equal(position.epd(), c.epd);
    const options = { year: c.year, later: c.later };
    const where = `after [${c.moves.join(' ')}] year=${c.year} later=${c.later}`;
    const lookup = book.lookup(position, options);
    compare(lookup, c.lookup, `(lookup) ${where}`);
    compare(book.replies(position, options), c.replies, `(replies) ${where}`);
    c.draws.forEach((r, i) => {
      const pick = book.choose(position, r, options);
      assert.equal(pick ? pick.uci : null, c.picks[i], `choose(r=${r}) ${where}`);
    });
    if (lookup.length) withMoves++;
  }
  assert.ok(withMoves > 100);
});

test('eras: a level set in 1956 knows only the games he had played by then', () => {
  const start = new Position();
  assert.deepEqual(book.lookup(start).map(m => m.uci), ['e2e4', 'g1f3', 'c2c4', 'b2b3']);
  const boy = book.lookup(start, { year: 1956 });
  assert.deepEqual(boy.map(m => m.uci), ['e2e4', 'g1f3']);
  assert.ok(boy.every(m => m.games.every(g => g.year <= 1956)));
  const all = book.lookup(start, { year: 1972, later: true });
  assert.equal(Math.max(...all.flatMap(m => m.games.map(g => g.year))), 1992);
});

test('famous games are cited first, and out-of-book positions give nothing', () => {
  const qgd = Position.fromMoves(['c2c4', 'e7e6', 'g1f3', 'd7d5', 'd2d4', 'g8f6', 'b1c3', 'f8e7']);
  const best = book.lookup(qgd)[0];
  assert.equal(best.uci, 'c1g5');
  assert.equal(best.games[0].cite, 'Fischer–Spassky, World Championship 1972, Game 6');
  const nowhere = new Position('8/8/8/4k3/8/8/8/KR6 w - - 0 1');
  assert.deepEqual(book.lookup(nowhere), []);
  assert.deepEqual(book.replies(nowhere), []);
  assert.equal(book.choose(nowhere, 0.5), null);
});
