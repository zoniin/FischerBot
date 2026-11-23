// What the commentary is told about a move: which of his games the player is
// following or leaving, and which opening has been reached (bot.js,
// describeContext). Checked against the real book.
import test from 'node:test';
import assert from 'node:assert/strict';
import { staticData } from './helpers.js';
import { Position } from '../static/js/rules.js';
import { Book } from '../static/js/book.js';
import { FischerBot, LEVELS, describeContext, openingFamily } from '../static/js/bot.js';

const book = new Book(staticData('book.json'));
const WORLD = LEVELS.find(level => level.id === 'world');
const PRODIGY = LEVELS.find(level => level.id === 'prodigy');
const START = new Position().fen();
const NAJDORF = ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3'];

/** Out of book this engine simply plays the first legal move. */
class FirstMoveEngine {
  newGame() {}
  setPosition(fen, moves = []) { this.position = Position.fromMoves(moves, fen); }
  search() {
    const move = this.position.legalMoves().map(m => m.uci()).sort()[0];
    return { move, scoreCp: 0, depth: 1, nodes: 1, timeMs: 0, pv: [move] };
  }
  scoreMove() { return null; }
}

/** The bot's heaviest book move (random() = 0) and the context that goes with it. */
function play(moves, level = WORLD) {
  const bot = new FischerBot({ engine: new FirstMoveEngine(), book, style: null, level, random: () => 0 });
  const choice = bot.choose({ fen: START, moves });
  return { choice, context: describeContext({ book, level, fen: START, moves, choice }) };
}

test('opening families by ECO code', () => {
  const cases = {
    B90: 'sicilian_najdorf', B99: 'sicilian_najdorf', B20: 'sicilian', B89: 'sicilian',
    C60: 'ruy_lopez', C95: 'ruy_lopez', E60: 'kings_indian', E97: 'kings_indian',
    D70: 'grunfeld', D98: 'grunfeld', C00: 'french', C19: 'french', B10: 'caro_kann', B18: 'caro_kann',
    C30: 'kings_gambit', C39: 'kings_gambit', D06: 'queens_gambit', D59: 'queens_gambit',
    E20: 'nimzo_indian', E59: 'nimzo_indian', A10: 'english', A39: 'english',
    B02: 'alekhine', B05: 'alekhine', B06: 'pirc_modern', B09: 'pirc_modern',
    C50: 'italian', C59: 'italian', B01: 'scandinavian',
    B00: 'other_e4', C20: 'other_e4', C42: 'other_e4',
    A00: 'flank', A09: 'flank',
    A40: 'other_d4', A77: 'other_d4', D00: 'other_d4', D05: 'other_d4', E00: 'other_d4', E19: 'other_d4',
  };
  for (const [eco, family] of Object.entries(cases)) assert.equal(openingFamily(eco), family, eco);
});

test('the first move: nothing to follow yet, no opening yet', () => {
  const { choice, context } = play([]);
  assert.equal(choice.uci, 'e2e4');
  assert.deepEqual(context, { ply: 0, phase: 0, playerMove: null, opening: null });
});

test('a first move his opponents played is "following"; one nobody played is nothing', () => {
  const e4 = play(['e2e4']).context;
  assert.equal(e4.ply, 1);
  assert.equal(e4.playerMove.kind, 'follows');
  assert.equal(e4.playerMove.san, 'e4');
  assert.equal(e4.playerMove.game.key, 'wc1972#13');          // the cited-first game with 1.e4 against him
  assert.equal(e4.playerMove.game.white, false);
  assert.ok(!book.replies(new Position()).some(entry => entry.uci === 'h2h4'));
  assert.equal(play(['h2h4']).context.playerMove, null);
});

test('following the game his previous move was cited from', () => {
  const { choice, context } = play(NAJDORF);
  assert.equal(choice.uci, 'a7a6');
  assert.equal(choice.book.game.key, 'wc1972#7');
  assert.deepEqual(context.playerMove, {
    kind: 'follows', san: 'Nc3',
    game: book.games.find(game => game.key === 'wc1972#7'),
  });
  assert.equal(context.playerMove.game.cite, 'Spassky–Fischer, World Championship 1972, Game 7');
});

test('leaving that game names the move that was played in it', () => {
  const moves = [...NAJDORF.slice(0, 8), 'f1d3'];             // 5.Bd3 instead of 5.Nc3
  const { choice, context } = play(moves);
  assert.equal(choice.source, 'search');
  assert.equal(context.playerMove.kind, 'leaves');
  assert.equal(context.playerMove.san, 'Nc3');
  assert.equal(context.playerMove.game.key, 'wc1972#7');
  assert.equal(context.opening, null);
  // one move later the position is no longer from his games at all
  const later = play([...moves, choice.uci, 'a2a3']);
  assert.equal(later.context.playerMove, null);
});

test('a sideline another of his games took is still "following"', () => {
  // 5.f3 was Lombardy's move in game 25 of the book, not Spassky's in the game cited so far
  const { context } = play([...NAJDORF.slice(0, 8), 'f2f3']);
  assert.equal(context.playerMove.kind, 'follows');
  assert.equal(context.playerMove.game.key, 'm60mg#25');
  assert.equal(context.playerMove.san, 'f3');
});

test('openings are named once they are on the board', () => {
  // 4...Nf6: nearly all of these games became Najdorfs, but ...a6 has not been played yet
  const open = play(NAJDORF.slice(0, 7));
  assert.equal(open.choice.uci, 'g8f6');
  assert.deepEqual(open.context.opening, { eco: 'B97', family: 'sicilian' });
  assert.deepEqual(play(NAJDORF).context.opening, { eco: 'B97', family: 'sicilian_najdorf' });
  // too early to call: 2...g6 could still become a Gruenfeld
  const kid = ['d2d4', 'g8f6', 'c2c4'];
  assert.equal(play(kid).choice.uci, 'g7g6');
  assert.equal(play(kid).context.opening, null);
  const bg7 = play([...kid, 'g7g6', 'b1c3']);
  assert.equal(bg7.choice.uci, 'f8g7');
  assert.deepEqual(bg7.context.opening, { eco: 'E97', family: 'kings_indian' });
  assert.equal(bg7.context.ply, 5);
  // as White: 1.e4 e5 2.Nf3 Nc6 3.Bb5
  const ruy = play(['e2e4', 'e7e5', 'g1f3', 'b8c6']);
  assert.equal(ruy.choice.uci, 'f1b5');
  assert.equal(ruy.context.opening.family, 'ruy_lopez');
});

test('the level\'s era decides which games count', () => {
  const { context } = play(['e2e4'], PRODIGY);
  assert.equal(context.playerMove.kind, 'follows');
  assert.equal(context.playerMove.game.key, 'career#11');     // Walz-Fischer, Canadian Open 1956
  assert.ok(context.playerMove.game.year <= 1956);
});

test('without a book, or out of it, there is no history to report', () => {
  const position = 'r2q1rk1/pp1bbppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R1BQ1RK1 w - - 0 14';
  const bot = new FischerBot({ engine: new FirstMoveEngine(), book: null, style: null, level: WORLD });
  const choice = bot.choose({ fen: position, moves: [] });
  assert.deepEqual(describeContext({ book: null, level: WORLD, fen: position, moves: [], choice }),
    { ply: 0, phase: 1, playerMove: null, opening: null });
  const out = describeContext({ book, level: WORLD, fen: position, moves: ['a2a3', 'a7a6'], choice });
  assert.deepEqual(out, { ply: 2, phase: 1, playerMove: null, opening: null });
});
