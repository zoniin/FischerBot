// link.js: which game a link asks for, and which FENs are not chess positions at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gameFromLink, isChessPosition, playableFen } from '../static/js/link.js';
import { Position, STARTING_FEN, WHITE, BLACK } from '../static/js/rules.js';
import { LEVELS } from '../static/js/bot.js';

const ask = (query, levelId = null) => gameFromLink(query, { levels: LEVELS, levelId });

// every one of these parses as a FEN
const NOT_CHESS = {
  'no kings at all': '8/pppppppp/8/8/8/8/PPPPPPPP/8 w - - 0 1',
  'no white king': '4k3/8/8/8/8/8/8/R7 w - - 0 1',
  'no black king': '8/8/8/8/8/8/8/R3K3 w - - 0 1',
  'two white kings': '4k3/8/8/8/8/8/8/K3K3 w - - 0 1',
  'the side that is not to move is in check': '4k3/8/8/8/8/8/4q3/4K3 b - - 0 1',
  'the same with colours reversed': '4k3/4Q3/8/8/8/8/8/4K3 w - - 0 1',
  'sixty-four queens': 'QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/QQQQQQQQ/qqqqqqqq/qqqqqqqq/qqqqqqqq/qqqqqqqq w - - 0 1',
  'a white pawn on the eighth rank': '4k2P/8/8/8/8/8/8/4K3 w - - 0 1',
  'a white pawn on the first rank': '4k3/8/8/8/8/8/8/P3K3 w - - 0 1',
  'a black pawn on the first rank': '4k3/8/8/8/8/8/8/p3K3 w - - 0 1',
  'a black pawn on the eighth rank': 'p3k3/8/8/8/8/8/8/4K3 b - - 0 1',
  'nine pawns a side': '4k3/pppppppp/p7/8/8/P7/PPPPPPPP/4K3 w - - 0 1',
  'seventeen white men': '4k3/8/8/8/8/NNNNNNNN/PPPPPPPP/4K3 w - - 0 1',
};

test('a FEN that parses is not yet a chess position', () => {
  for (const [what, fen] of Object.entries(NOT_CHESS)) {
    assert.doesNotThrow(() => new Position(fen), what);
    assert.equal(isChessPosition(new Position(fen)), false, what);
    assert.equal(playableFen(fen), null, what);
  }
  assert.equal(playableFen('not a fen'), null);
  assert.equal(playableFen(''), null);
  assert.equal(playableFen(null), null);
});

test('real positions are accepted: the start, a check, a mate, bare kings, a promoted army', () => {
  const real = [
    STARTING_FEN,
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
    '4k3/8/8/8/8/8/4q3/4K3 w - - 0 1',                              // the side to move is in check: that is chess
    'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', // fool's mate, on the board
    '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    'QQQQk3/8/8/8/8/8/8/QQQQKQ2 b - - 0 1',                         // odd, but nine queens can be promoted to
    '6k1/5ppp/8/8/8/8/8/R3K3 w Q - 0 1',
  ];
  for (const fen of real) {
    assert.equal(isChessPosition(new Position(fen)), true, fen);
    assert.equal(playableFen(fen), fen);
  }
  // and every position of a game stays one
  const position = new Position();
  for (const uci of ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6']) {
    position.push(position.parseUci(uci));
    assert.equal(isChessPosition(position), true, uci);
  }
});

test('a link with nothing in it asks for no game', () => {
  assert.equal(ask(''), null);
  assert.equal(ask('?debug'), null);
  assert.equal(ask('?color=black'), null);
});

test('a link names a position, moves, a level and a colour', () => {
  const fen = '6k1/5ppp/8/8/8/8/8/R3K3 w Q - 0 1';
  const game = ask(`?fen=${encodeURIComponent(fen)}&level=prodigy&color=black`);
  assert.equal(game.startFen, fen);
  assert.equal(game.level.id, 'prodigy');
  assert.equal(game.human, BLACK);
  assert.deepEqual(game.moves, []);

  const moves = ask('?moves=e2e4,c7c5');
  assert.equal(moves.startFen, STARTING_FEN);
  assert.deepEqual(moves.moves, ['e2e4', 'c7c5']);
  assert.equal(moves.human, WHITE);
  assert.equal(moves.level.id, LEVELS[LEVELS.length - 1].id, 'no level named, none played: the strongest');
  assert.equal(ask('?moves=e2e4', 'champion').level.id, 'champion', 'no level named: the one played last');
  assert.equal(ask('?level=grandmaster').level.id, 'grandmaster');
  assert.equal(ask('?level=nobody&moves=e2e4', 'prodigy').level.id, 'prodigy');
  assert.equal(ask('?colour=Black&moves=e2e4').human, BLACK);
  assert.equal(ask(new URLSearchParams('moves=e2e4 e7e5')).moves.length, 2);
});

test('moves that cannot be played: no game', () => {
  assert.equal(ask('?moves=e2e5'), null);
  assert.equal(ask('?moves=e2e4,e2e4'), null);
  assert.equal(ask('?moves=zz'), null);
  assert.equal(ask(`?fen=${encodeURIComponent('4k3/8/8/8/8/8/8/4K3 w - - 0 1')}&moves=e2e4`), null);
});

test('a FEN that is not a chess position is ignored: the link is read as if it had none', () => {
  for (const [what, fen] of Object.entries({ ...NOT_CHESS, 'nonsense': 'hello', 'empty': '' })) {
    const query = `?fen=${encodeURIComponent(fen)}`;
    assert.equal(ask(query), null, `${what}: nothing else in the link, so no game`);
    assert.deepEqual(ask(`${query}&level=champion&color=black`), ask('?level=champion&color=black'), what);
    assert.equal(ask(`${query}&level=champion`).startFen, STARTING_FEN, what);
    assert.deepEqual(ask(`${query}&moves=e2e4`), ask('?moves=e2e4'), what);
  }
});
