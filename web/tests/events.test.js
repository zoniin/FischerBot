// events.js: the move classifier, the event list of one exchange, the end of the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Position, Move, WHITE, BLACK, QUEEN, ROOK, PAWN, KNIGHT } from '../static/js/rules.js';
import {
  classifyPlayerMove, mateMoves, isMateFor, isMateAgainst, moveFacts, newMemory, eventsForBotMove,
  outcomeOf, gameOverCategory, capturedMaterial, bookCategory, cleanMemory,
} from '../static/js/events.js';
import { gameVariables } from '../static/js/commentary.js';

const categories = events => events.map(event => event.category);
const quiet = { capture: false, check: false, castle: false, promotion: false, queenTrade: false, see: 0 };

test('classifyPlayerMove: 200 is a blunder, 90 a mistake, 40 an inaccuracy', () => {
  assert.equal(classifyPlayerMove({ before: 10, after: 215 }), 'blunder');
  assert.equal(classifyPlayerMove({ before: 10, after: 210 }), 'blunder');
  assert.equal(classifyPlayerMove({ before: 10, after: 209 }), 'mistake');
  assert.equal(classifyPlayerMove({ before: -50, after: 40 }), 'mistake');
  assert.equal(classifyPlayerMove({ before: -50, after: 39 }), 'inaccuracy');
  assert.equal(classifyPlayerMove({ before: 0, after: 40 }), 'inaccuracy');
  assert.equal(classifyPlayerMove({ before: 0, after: 39 }), null);
  assert.equal(classifyPlayerMove({ before: 100, after: -300 }), null);
});

test('classifyPlayerMove: the expected reply that gives nothing away is a good move', () => {
  assert.equal(classifyPlayerMove({ before: 30, after: 30, expected: 'g8f6', played: 'g8f6' }), 'good');
  assert.equal(classifyPlayerMove({ before: 30, after: 10, expected: 'g8f6', played: 'g8f6' }), 'good');
  assert.equal(classifyPlayerMove({ before: 30, after: 35, expected: 'g8f6', played: 'g8f6' }), null, 'his evaluation rose');
  assert.equal(classifyPlayerMove({ before: 30, after: 30, expected: 'g8f6', played: 'b8c6' }), null);
  assert.equal(classifyPlayerMove({ before: 30, after: 30, expected: null, played: null }), null);
});

test('classifyPlayerMove: nothing to judge by while he is in book, or once it is mate anyway', () => {
  assert.equal(classifyPlayerMove({ before: null, after: 500 }), null);
  assert.equal(classifyPlayerMove({ before: 20, after: null }), null);
  assert.equal(classifyPlayerMove({ before: 99991, after: 99995 }), null);
  assert.equal(classifyPlayerMove({ before: 300, after: 99995 }), 'blunder');
  assert.equal(classifyPlayerMove(), null);
});

test('mate scores: 100000 minus plies; moves to mate round up', () => {
  assert.equal(mateMoves(99999), 1);
  assert.equal(mateMoves(99997), 2);
  assert.equal(mateMoves(99996), 2);
  assert.equal(mateMoves(99995), 3);
  assert.equal(mateMoves(-99994), 3);
  assert.ok(isMateFor(99000) && !isMateFor(98999) && !isMateFor(null));
  assert.ok(isMateAgainst(-99990) && !isMateAgainst(-500) && !isMateAgainst(undefined));
});

test('moveFacts: captures, checks, castling, promotion, a queen for a queen', () => {
  let position = new Position('r3k2r/pp3ppp/8/3q4/3Q4/8/PP3PPP/R3K2R w KQkq - 0 1');
  let facts = moveFacts(position, position.parseUci('d4d5'));
  assert.deepEqual({ ...facts, see: undefined }, { capture: true, check: false, castle: false, promotion: false, queenTrade: true, see: undefined });
  facts = moveFacts(position, position.parseUci('e1g1'));
  assert.equal(facts.castle, true);
  assert.equal(facts.capture, false);
  assert.equal(facts.see, null, 'no exchange value for castling');

  position = new Position('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  facts = moveFacts(position, position.parseUci('a7a8q'));
  assert.equal(facts.promotion, true);
  assert.equal(facts.check, true);
  assert.equal(facts.see, null);

  // a knight that takes a defended pawn loses material by static exchange
  position = new Position('4k3/8/3p4/4p3/8/5N2/8/4K3 w - - 0 1');
  facts = moveFacts(position, position.parseUci('f3e5'));
  assert.equal(facts.capture, true);
  assert.equal(facts.queenTrade, false);
  assert.ok(facts.see <= -200, `see ${facts.see}`);

  // en passant is a capture of a pawn
  position = Position.fromMoves(['e2e4', 'a7a6', 'e4e5', 'd7d5']);
  facts = moveFacts(position, position.parseUci('e5d6'));
  assert.equal(facts.capture, true);
});

const GAME6 = { key: 'wc1972#6', cite: 'Fischer–Spassky, World Championship 1972, Game 6', opponent: 'Spassky',
  event: 'World Championship', year: 1972, white: true, score: 1, source: 'wc1972', number: 6, eco: 'D59' };
const BLED = { key: 'm60mg#32', opponent: 'Tal', event: 'Bled', year: 1961, source: 'm60mg', number: 32, eco: 'B47' };
const CAREER = { key: 'career#5', opponent: 'Reshevsky', event: 'U.S. Championship', year: 1963, source: 'career', number: 0, eco: 'C92' };

test('bookCategory follows the source of the cited game', () => {
  assert.equal(bookCategory(GAME6), 'book_move_1972');
  assert.equal(bookCategory(BLED), 'book_move_memorable');
  assert.equal(bookCategory(CAREER), 'book_move');
  assert.equal(bookCategory(null), 'book_move');
});

test('the first book move is always announced, later ones only sometimes', () => {
  const book = { uci: 'c2c4', san: 'c4', source: 'book', evalCp: null, pv: [], book: { game: GAME6, count: 3 },
    context: { ply: 0, phase: 0, playerMove: null, opening: null } };
  const first = eventsForBotMove({ result: book, memory: newMemory(), botMove: quiet, gameVariables });
  assert.deepEqual(first.events[0], { category: 'book_move_1972', frequency: 'always',
    vars: { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6 } });
  assert.equal(first.memory.bookMoves, 1);
  assert.equal(first.memory.wasInBook, true);
  assert.equal(first.verdict, null);

  const second = eventsForBotMove({ result: { ...book, book: { game: CAREER, count: 1 } }, memory: first.memory,
    botMove: quiet, playerMove: quiet, playerUci: 'e7e6', gameVariables });
  const again = second.events.find(event => event.category === 'book_move');
  assert.equal(again.frequency, 'sometimes');
  assert.equal(again.vars.event, 'the U.S. Championship');
  assert.equal(second.memory.bookMoves, 2);
});

test('1.e4 gets a word of its own, ahead of the citation, when he opens the game with it', () => {
  const e4 = { uci: 'e2e4', san: 'e4', source: 'book', evalCp: null, pv: [], book: { game: CAREER, count: 300 }, context: null };
  const opening = eventsForBotMove({ result: e4, memory: newMemory(), botMove: quiet, gameVariables, opensGame: true });
  assert.deepEqual(categories(opening.events).slice(0, 2), ['first_move_e4', 'book_move']);
  assert.equal(opening.events[0].frequency, 'always', 'the brief: always, not most of the time');
  assert.equal(opening.events[1].frequency, 'always');
  const later = eventsForBotMove({ result: e4, memory: newMemory(), botMove: quiet, gameVariables });
  assert.ok(!categories(later.events).includes('first_move_e4'));
  const d4 = eventsForBotMove({ result: { ...e4, uci: 'd2d4', san: 'd4' }, memory: newMemory(), botMove: quiet, gameVariables, opensGame: true });
  assert.ok(!categories(d4.events).includes('first_move_e4'));
});

test('leaving his game, then leaving the book: both are said, in that order, once', () => {
  let memory = { ...newMemory(), bookMoves: 4, wasInBook: true };
  const result = { uci: 'g1f3', san: 'Nf3', source: 'search', evalCp: 25, pv: ['g1f3', 'g8f6'],
    context: { ply: 9, phase: 0, playerMove: { kind: 'leaves', game: BLED, san: 'Nc6' }, opening: null } };
  const first = eventsForBotMove({ result, memory, botMove: quiet, playerMove: quiet, playerUci: 'h7h6', gameVariables });
  assert.deepEqual(categories(first.events).slice(0, 2), ['player_leaves_history', 'out_of_book']);
  assert.deepEqual(first.events[0].vars, { opponent: 'Tal', year: 1961, event: 'Bled', game: 32, san: 'Nc6' });
  assert.equal(first.events[1].frequency, 'always');
  assert.equal(first.memory.leftBook, true);
  assert.equal(first.memory.lastEval, 25);
  assert.deepEqual(first.memory.lastPv, ['g1f3', 'g8f6']);

  memory = first.memory;
  const second = eventsForBotMove({ result: { ...result, context: { ply: 11, phase: 1, playerMove: null, opening: null } },
    memory, botMove: quiet, playerMove: quiet, playerUci: 'a7a6', gameVariables });
  assert.ok(!categories(second.events).includes('out_of_book'));
  assert.ok(!categories(second.events).includes('player_leaves_history'));
});

test('a game that never was in his book has no book to leave', () => {
  const result = { uci: 'e2e4', san: 'e4', source: 'search', evalCp: 30, pv: ['e2e4'], context: null };
  const { events } = eventsForBotMove({ result, memory: newMemory(), botMove: quiet, gameVariables });
  assert.ok(!categories(events).includes('out_of_book'));
  assert.deepEqual(categories(events), ['quotes']);
});

test('following his game is a "sometimes"; an opening is named once', () => {
  const result = { uci: 'f1b5', san: 'Bb5', source: 'book', evalCp: null, pv: [], book: { game: CAREER, count: 12 },
    context: { ply: 4, phase: 0, playerMove: { kind: 'follows', game: CAREER, san: 'Nc6' }, opening: { eco: 'C92', family: 'ruy_lopez' } } };
  const memory = { ...newMemory(), bookMoves: 2, wasInBook: true };
  const first = eventsForBotMove({ result, memory, botMove: quiet, playerMove: quiet, playerUci: 'b8c6', gameVariables });
  assert.deepEqual(first.events[0], { category: 'opening_ruy_lopez', frequency: 'always', vars: {} });
  const follows = first.events.find(event => event.category === 'player_follows_history');
  assert.equal(follows.frequency, 'sometimes');
  assert.deepEqual(follows.vars, { opponent: 'Reshevsky', year: 1963, event: 'the U.S. Championship' });
  assert.deepEqual(first.memory.openings, ['ruy_lopez']);
  const second = eventsForBotMove({ result, memory: first.memory, botMove: quiet, playerMove: quiet, playerUci: 'a7a6', gameVariables });
  assert.ok(!categories(second.events).includes('opening_ruy_lopez'));
  assert.deepEqual(memory.openings, [], 'the memory passed in is not modified');
});

test('the tide is called once at each line, the strongest statement first', () => {
  const at = (evalCp, memory) => eventsForBotMove({
    result: { uci: 'a2a3', san: 'a3', source: 'search', evalCp, pv: [], context: null },
    memory, botMove: quiet, playerMove: quiet, playerUci: 'a7a6', gameVariables });
  let step = at(160, { ...newMemory(), lastEval: 150 });
  assert.equal(step.events[0].category, 'bot_better');
  assert.equal(step.events[0].frequency, 'always');
  step = at(170, step.memory);
  assert.ok(!categories(step.events).includes('bot_better'));
  step = at(420, { ...step.memory, lastEval: 400 });
  assert.equal(step.events[0].category, 'bot_winning');
  step = at(-500, { ...newMemory(), lastEval: -480 });
  assert.equal(step.events[0].category, 'bot_losing', 'straight to losing: "worse" is then old news');
  assert.deepEqual(step.memory.tides.sort(), ['bot_losing', 'bot_worse']);
  step = at(-520, step.memory);
  assert.deepEqual(categories(step.events), ['quotes']);
});

test('a blunder outranks the tide; a mate outranks the blunder; each mate is announced once', () => {
  const memory = { ...newMemory(), lastEval: 20, lastPv: ['e2e4', 'e7e5'] };
  let step = eventsForBotMove({ result: { uci: 'd1h5', san: 'Qh5', source: 'search', evalCp: 450, pv: [], context: null },
    memory, botMove: quiet, playerMove: quiet, playerUci: 'g7g5', gameVariables });
  assert.equal(step.verdict, 'blunder');
  assert.deepEqual(categories(step.events).slice(0, 2), ['player_blunder', 'bot_winning']);
  assert.equal(step.events[0].frequency, 'always');

  step = eventsForBotMove({ result: { uci: 'd1h5', san: 'Qh5#', source: 'search', evalCp: 99997, pv: [], context: null },
    memory, botMove: quiet, playerMove: quiet, playerUci: 'g7g5', gameVariables });
  assert.deepEqual(step.events[0], { category: 'mate_in_n', frequency: 'always', vars: { n: 2 } });
  assert.equal(step.events[1].category, 'player_blunder');
  const later = eventsForBotMove({ result: { uci: 'h5f7', san: 'Qf7', source: 'search', evalCp: 99999, pv: [], context: null },
    memory: step.memory, botMove: quiet, playerMove: quiet, playerUci: 'a7a6', gameVariables });
  assert.ok(!categories(later.events).includes('mate_in_n'));

  const mated = eventsForBotMove({ result: { uci: 'g8h8', san: 'Kh8', source: 'search', evalCp: -99996, pv: [], context: null },
    memory: newMemory(), botMove: quiet, playerMove: quiet, playerUci: 'd1h5', gameVariables });
  assert.equal(mated.events[0].category, 'getting_mated');
  assert.equal(mated.memory.sawMated, true);
});

test('mistakes are "often", inaccuracies and good moves "sometimes"', () => {
  const at = (before, after, playerUci = 'a7a6', lastPv = ['e2e4', 'e7e5']) => eventsForBotMove({
    result: { uci: 'a2a3', san: 'a3', source: 'search', evalCp: after, pv: [], context: null },
    memory: { ...newMemory(), lastEval: before, lastPv, tides: ['bot_better', 'bot_winning', 'bot_worse', 'bot_losing'] },
    botMove: quiet, playerMove: quiet, playerUci, gameVariables }).events;
  assert.deepEqual(at(0, 100)[0], { category: 'player_mistake', frequency: 'often', vars: {} });
  assert.deepEqual(at(0, 50)[0], { category: 'player_inaccuracy', frequency: 'sometimes', vars: {} });
  assert.deepEqual(at(0, 0, 'e7e5')[0], { category: 'player_good_move', frequency: 'sometimes', vars: {} });
  assert.deepEqual(categories(at(0, 0)), ['quotes']);
});

test('his sacrifice needs a losing exchange, his own thought and a sound position', () => {
  const sacrifice = { ...quiet, capture: true, see: -230 };
  const at = (source, evalCp, botMove) => categories(eventsForBotMove({
    result: { uci: 'c4f7', san: 'Bxf7+', source, evalCp, pv: [], context: null, book: source === 'book' ? { game: CAREER, count: 1 } : undefined },
    memory: { ...newMemory(), bookMoves: 1, leftBook: true }, botMove, playerMove: quiet, playerUci: 'a7a6', gameVariables }).events);
  assert.ok(at('search', 30, sacrifice).includes('bot_sacrifice'));
  assert.ok(at('search+style', -50, sacrifice).includes('bot_sacrifice'));
  assert.ok(!at('search', -60, sacrifice).includes('bot_sacrifice'), 'that is just losing a piece');
  assert.ok(!at('book', null, sacrifice).includes('bot_sacrifice'));
  assert.ok(!at('search', 30, { ...quiet, capture: true, see: -100 }).includes('bot_sacrifice'));
  assert.ok(!at('search', 30, { ...quiet, see: null }).includes('bot_sacrifice'));
});

test('promotions, queen trades, the endgame, captures, checks and castling all have their events', () => {
  const { events, memory } = eventsForBotMove({
    result: { uci: 'd1d8', san: 'Qxd8+', source: 'search', evalCp: 10, pv: [], context: { ply: 30, phase: 2, playerMove: null, opening: null } },
    memory: newMemory(),
    botMove: { ...quiet, capture: true, check: true, queenTrade: true },
    playerMove: { ...quiet, castle: true, promotion: true, capture: true, check: true, queenTrade: true },
    playerUci: 'e8g8', gameVariables });
  assert.deepEqual(categories(events), ['endgame_reached', 'player_promotes', 'bot_queen_trade', 'player_queen_trade',
    'bot_capture', 'bot_check', 'player_capture', 'player_check', 'player_castles', 'quotes']);
  assert.equal(events.find(event => event.category === 'bot_queen_trade').frequency, 'often');
  assert.equal(memory.endgame, true);
  const next = eventsForBotMove({ result: { uci: 'a2a3', san: 'a3', source: 'search', evalCp: 10, pv: [], context: { ply: 32, phase: 2 } },
    memory, botMove: { ...quiet, promotion: true, castle: true }, playerMove: quiet, playerUci: 'a7a6', gameVariables });
  assert.deepEqual(categories(next.events), ['bot_promotes', 'bot_castles', 'quotes']);
});

test('the server fallback (no context, no book games) still produces sensible events', () => {
  const { events, memory } = eventsForBotMove({
    result: { uci: 'e2e4', san: 'e4', source: 'book', evalCp: null, pv: [], context: null, book: { game: GAME6, count: 2 } },
    memory: newMemory(), botMove: quiet, gameVariables });
  assert.equal(events[0].category, 'book_move_1972');
  assert.equal(memory.lastEval, null);
  assert.ok(JSON.stringify(memory), 'the memory is plain JSON');
});

test('outcomeOf: mate, stalemate, bare kings, repetition, fifty moves, or nothing yet', () => {
  assert.equal(outcomeOf(new Position()), null);
  const fool = Position.fromMoves(['f2f3', 'e7e5', 'g2g4', 'd8h4']);
  assert.deepEqual(outcomeOf(fool), { kind: 'checkmate', winner: BLACK });
  assert.deepEqual(outcomeOf(new Position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), { kind: 'stalemate', winner: null });
  assert.deepEqual(outcomeOf(new Position('7k/8/6K1/8/8/8/8/8 w - - 0 1')), { kind: 'insufficient', winner: null });
  assert.deepEqual(outcomeOf(new Position('7k/8/6K1/8/8/8/8/R7 w - - 100 80')), { kind: 'fifty', winner: null });
  const shuffle = Position.fromMoves(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
  assert.deepEqual(outcomeOf(shuffle), { kind: 'repetition', winner: null });
  const mate = new Position('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  mate.push(mate.parseUci('a1a8'));
  assert.deepEqual(outcomeOf(mate), { kind: 'checkmate', winner: WHITE });
});

test('gameOverCategory is told from his side of the board', () => {
  assert.equal(gameOverCategory({ kind: 'checkmate', winner: BLACK }, BLACK), 'win_checkmate');
  assert.equal(gameOverCategory({ kind: 'checkmate', winner: WHITE }, BLACK), 'loss_checkmate');
  assert.equal(gameOverCategory({ kind: 'stalemate', winner: null }, WHITE), 'draw_stalemate');
  assert.equal(gameOverCategory({ kind: 'repetition', winner: null }, WHITE), 'draw_repetition');
  assert.equal(gameOverCategory({ kind: 'fifty', winner: null }, WHITE), 'draw_fifty_moves');
  assert.equal(gameOverCategory({ kind: 'insufficient', winner: null }, WHITE), 'draw_insufficient');
  assert.equal(gameOverCategory(null, WHITE), null);
});

test('capturedMaterial lists what each side has lost and who is ahead', () => {
  const start = new Position();
  assert.deepEqual(capturedMaterial(start, start), { lostByWhite: [], lostByBlack: [], balance: 0 });
  const now = new Position('rnb1kbnr/ppp2ppp/8/8/8/8/PPP2PPP/R1BQKB1R w KQkq - 0 8');
  assert.deepEqual(capturedMaterial(start, now), {
    lostByWhite: [KNIGHT, KNIGHT, PAWN, PAWN], lostByBlack: [QUEEN, PAWN, PAWN], balance: 3 });
  // a promoted pawn is a lost pawn, not a negative queen
  const promoted = new Position('rnbqkbnr/1ppppppp/8/8/8/8/1PPPPPPP/QNBQKBNR w Kkq - 0 12');
  const result = capturedMaterial(start, promoted);
  assert.deepEqual(result.lostByWhite, [ROOK, PAWN]);
  assert.deepEqual(result.lostByBlack, [PAWN]);
  assert.equal(result.balance, 9 - 5);
  assert.ok(new Move(0, 8) instanceof Move);
});

// ---------------------------------------------------------------------------
// Regressions from the QA review
// ---------------------------------------------------------------------------

test('a draw by repetition only when the position is on the board for the third time', () => {
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'];
  for (let n = 0; n <= shuffle.length; n += 1) {
    const position = Position.fromMoves(shuffle.slice(0, n));
    assert.equal(outcomeOf(position), null, `after ${n} half-moves nothing has occurred three times`);
  }
  // here the side to move COULD claim (Ng8 would repeat for the third time): the game still goes on
  const claimable = Position.fromMoves(shuffle);
  assert.equal(claimable.canClaimThreefoldRepetition(), true);
  assert.equal(outcomeOf(claimable), null);
  const third = Position.fromMoves([...shuffle, 'f6g8']);
  assert.equal(third.isRepetition(3), true);
  assert.deepEqual(outcomeOf(third), { kind: 'repetition', winner: null });
  // the same position with different rights is not the same position
  const castled = Position.fromMoves(['e2e4', 'e7e5', 'e1e2', 'e8e7', 'e2e1', 'e7e8', 'e1e2', 'e8e7', 'e2e1', 'e7e8']);
  assert.equal(outcomeOf(castled), null, 'the starting-like position occurred once with castling rights, twice without');
});

test('the fifty-move rule at a hundred half-moves, not at ninety-nine', () => {
  const at98 = new Position('4k3/8/8/8/8/8/8/R3K3 w - - 98 80');
  assert.equal(outcomeOf(at98), null);
  at98.push(at98.parseUci('a1a2'));
  assert.equal(at98.halfmoveClock, 99);
  assert.equal(at98.canClaimFiftyMoves(), true, 'a claim is possible ...');
  assert.equal(outcomeOf(at98), null, '... but nobody has made it');
  at98.push(at98.parseUci('e8e7'));
  assert.equal(at98.halfmoveClock, 100);
  assert.deepEqual(outcomeOf(at98), { kind: 'fifty', winner: null });
  // mate on the hundredth half-move is mate
  const mated = new Position('7k/5K2/8/8/8/8/8/7R b - - 100 90');
  assert.equal(mated.isCheckmate(), true);
  assert.deepEqual(outcomeOf(mated), { kind: 'checkmate', winner: WHITE });
});

test('a memory of the wrong shape (a damaged save) is repaired, not trusted', () => {
  const broken = { tides: 3, openings: 'sicilian', lastPv: null, lastEval: 'x', bookMoves: -2, sawMate: 'yes' };
  assert.deepEqual(cleanMemory(broken), newMemory());
  assert.deepEqual(cleanMemory(null), newMemory());
  const good = { ...newMemory(), tides: ['bot_better'], openings: ['sicilian'], lastEval: 30, lastPv: ['e2e4', 'e7e5'], bookMoves: 2 };
  assert.deepEqual(cleanMemory(good), good);
  const result = { uci: 'e7e5', san: 'e5', source: 'search', evalCp: 500, pv: ['e7e5'], context: null };
  const { events, memory } = eventsForBotMove({ result, memory: broken, botMove: quiet, playerMove: quiet, playerUci: 'e2e4', gameVariables });
  assert.ok(categories(events).includes('bot_winning'));
  assert.deepEqual(memory.tides, ['bot_better', 'bot_winning']);
});

// ---------------------------------------------------------------------------
// Regressions from the last review before the site went live
// ---------------------------------------------------------------------------

test('the page ends a game on the same positions as the server, and on no others', () => {
  // the other half is tests/test_data_book_style.py (test_status_follows_the_page_on_both_sides_of_each_line):
  // the same positions, judged there by fischerbot/api.py with python-chess
  const kind = fen => outcomeOf(new Position(fen))?.kind ?? null;
  assert.equal(kind('8/8/4k3/8/8/3RK3/8/8 w - - 99 80'), null, 'ninety-nine half-moves: a draw could be claimed, none has occurred');
  assert.equal(kind('8/8/4k3/8/8/3RK3/8/8 b - - 100 80'), 'fifty');
  assert.equal(kind('8/8/4k3/8/8/3RK3/8/8 b - - 120 90'), 'fifty');
  assert.equal(kind('7k/6Q1/6K1/8/8/8/8/8 b - - 100 90'), 'checkmate', 'a mate with the hundredth half-move is a mate');
  assert.equal(kind('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'), 'checkmate');
  assert.equal(kind('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1'), null, 'mate in one is not mate');
  assert.equal(kind('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'stalemate');
  assert.equal(kind('7k/8/5K2/6Q1/8/8/8/8 b - - 0 1'), null, 'the king has a square');
  assert.equal(kind('8/8/4k3/8/8/3NK3/8/8 w - - 0 1'), 'insufficient');
  assert.equal(kind('8/8/4k3/8/8/3BK3/8/8 b - - 0 1'), 'insufficient');
  assert.equal(kind('8/8/4k3/8/8/3PK3/8/8 w - - 0 1'), null, 'a pawn is enough to play on');
  // the game from the review: Black could repeat for the third time and has not
  const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'];
  assert.equal(outcomeOf(Position.fromMoves(shuffle)), null);
  assert.equal(outcomeOf(Position.fromMoves([...shuffle, 'f6g8'])).kind, 'repetition');
});

test('"That loses" is said only when it is true: not while he is the one who stands worse', () => {
  const at = (before, after) => eventsForBotMove({
    result: { uci: 'a2a3', san: 'a3', source: 'search', evalCp: after, pv: [], context: null },
    memory: { ...newMemory(), lastEval: before, lastPv: ['e2e4', 'e7e5'], tides: ['bot_better', 'bot_winning', 'bot_worse', 'bot_losing'] },
    botMove: quiet, playerMove: quiet, playerUci: 'a7a6', gameVariables });

  // nine pawns down, then four and a half: a blunder on the scoresheet, and nothing for him to crow about
  let step = at(-900, -450);
  assert.equal(step.verdict, 'blunder', 'the move is still marked ??');
  assert.ok(!categories(step.events).includes('player_blunder'));
  assert.ok(!categories(step.events).includes('player_mistake'));

  // a won game thrown back to level, or to his advantage: now it is true
  step = at(-900, 0);
  assert.equal(step.verdict, 'blunder');
  assert.equal(step.events[0].category, 'player_blunder');
  step = at(-200, 250);
  assert.equal(step.events[0].category, 'player_blunder');

  // the same for a mistake: "Now I'm better" must be true as well
  step = at(-300, -180);
  assert.equal(step.verdict, 'mistake');
  assert.ok(!categories(step.events).includes('player_mistake'));
  step = at(-60, 60);
  assert.equal(step.verdict, 'mistake');
  assert.equal(step.events[0].category, 'player_mistake');
});
