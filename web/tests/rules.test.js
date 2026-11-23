// The rules library must behave exactly like python-chess on every fixture
// position (tools/make_fixtures.py writes the reference answers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import {
  Position, Move, perft, WHITE, BLACK, STARTING_FEN, SQUARE_NAMES,
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
} from '../static/js/rules.js';

const data = fixture('rules');
const SYMBOLS = { [PAWN]: 'p', [KNIGHT]: 'n', [BISHOP]: 'b', [ROOK]: 'r', [QUEEN]: 'q', [KING]: 'k' };

function build(c) {
  return c.moves ? Position.fromMoves(c.moves, c.start) : new Position(c.fen);
}

test('constants', () => {
  assert.equal(WHITE, true);
  assert.equal(BLACK, false);
  assert.deepEqual([PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING], [1, 2, 3, 4, 5, 6]);
  assert.equal(SQUARE_NAMES.length, 64);
  assert.equal(SQUARE_NAMES[0], 'a1');
  assert.equal(SQUARE_NAMES[7], 'h1');
  assert.equal(SQUARE_NAMES[63], 'h8');
  assert.equal(new Position().fen(), STARTING_FEN);
});

test('position state: FEN, EPD, side to move, check, mate, stalemate, material', () => {
  for (const c of data.cases) {
    const pos = build(c);
    assert.equal(pos.fen(), c.fen, 'fen');
    assert.equal(pos.epd(), c.epd, `epd of ${c.fen}`);
    assert.equal(pos.turn, c.turn === 'w', `turn of ${c.fen}`);
    assert.equal(pos.isCheck(), c.check, `isCheck ${c.fen}`);
    assert.equal(pos.isCheckmate(), c.checkmate, `isCheckmate ${c.fen}`);
    assert.equal(pos.isStalemate(), c.stalemate, `isStalemate ${c.fen}`);
    assert.equal(pos.isInsufficientMaterial(), c.insufficient, `isInsufficientMaterial ${c.fen}`);
  }
});

test('pieces on the board', () => {
  for (const c of data.cases) {
    const pos = build(c);
    const seen = {};
    for (let sq = 0; sq < 64; sq++) {
      const type = pos.pieceTypeAt(sq);
      if (type) {
        const symbol = SYMBOLS[type];
        seen[SQUARE_NAMES[sq]] = pos.colorAt(sq) === WHITE ? symbol.toUpperCase() : symbol;
      } else {
        assert.equal(pos.colorAt(sq), null);
      }
    }
    assert.deepEqual(seen, c.pieces, c.fen);
    for (const color of [WHITE, BLACK]) {
      const king = pos.king(color);
      assert.equal(seen[SQUARE_NAMES[king]], color ? 'K' : 'k', `king(${color}) in ${c.fen}`);
    }
  }
});

test('legal moves and everything known about each of them', () => {
  for (const c of data.cases) {
    const pos = build(c);
    const moves = pos.legalMoves();
    const got = moves.map(m => m.uci()).sort();
    assert.deepEqual(got, c.legal.map(m => m.uci), `legal moves of ${c.fen}`);
    const byUci = new Map(moves.map(m => [m.uci(), m]));
    for (const want of c.legal) {
      const move = byUci.get(want.uci);
      const where = `${want.uci} in ${c.fen}`;
      assert.ok(pos.isLegal(move), `isLegal ${where}`);
      assert.equal(pos.san(move), want.san, `san of ${where}`);
      assert.equal(pos.isCapture(move), want.capture, `isCapture ${where}`);
      assert.equal(pos.isEnPassant(move), want.ep, `isEnPassant ${where}`);
      assert.equal(pos.isKingsideCastling(move), want.castle === 'K', `isKingsideCastling ${where}`);
      assert.equal(pos.isQueensideCastling(move), want.castle === 'Q', `isQueensideCastling ${where}`);
      assert.equal(pos.isCastling(move), want.castle !== null, `isCastling ${where}`);
      assert.equal(pos.givesCheck(move), want.check, `givesCheck ${where}`);
      if (want.see !== null) assert.equal(pos.see(move), want.see, `see of ${where}`);
      // Notation round trips
      assert.equal(pos.parseSan(want.san).uci(), want.uci, `parseSan ${want.san} in ${c.fen}`);
      assert.equal(pos.parseUci(want.uci).uci(), want.uci);
      assert.ok(Move.fromUci(want.uci).equals(move));
      // Making the move gives the reference position, and unmaking restores everything.
      pos.push(move);
      assert.equal(pos.fen(), want.fen, `position after ${where}`);
      assert.equal(pos.moveStack[pos.moveStack.length - 1].uci(), want.uci);
      assert.equal(pos.pop().uci(), want.uci);
      assert.equal(pos.fen(), c.fen, `pop() after ${where}`);
    }
    assert.equal(pos.epd(), c.epd, 'queries must not disturb the position');
  }
});

test('illegal and malformed moves are rejected', () => {
  const pos = new Position();
  assert.equal(pos.isLegal(Move.fromUci('e2e5')), false);
  assert.equal(pos.isLegal(Move.fromUci('e1g1')), false);
  assert.throws(() => pos.parseUci('e2e5'));
  assert.throws(() => pos.parseUci('zz'));
  assert.throws(() => pos.parseSan('Ke2'));
  assert.throws(() => pos.parseSan('Nxe5'));
  assert.throws(() => pos.parseSan('hello'));
  const knights = new Position('8/8/2k5/8/8/3N1N2/8/3K4 w - - 0 1');
  assert.throws(() => knights.parseSan('Ne5'), 'ambiguous SAN must be rejected');
  assert.equal(knights.parseSan('Nde5').uci(), 'd3e5');
});

test('attackers of a square', () => {
  for (const c of data.cases) {
    const pos = build(c);
    for (const [name, want] of Object.entries(c.attackers)) {
      const sq = SQUARE_NAMES.indexOf(name);
      for (const [key, color] of [['w', WHITE], ['b', BLACK]]) {
        const got = pos.attackers(color, sq).map(a => SQUARE_NAMES[a]).sort();
        assert.deepEqual(got, want[key], `attackers(${key}, ${name}) in ${c.fen}`);
        assert.equal(pos.isAttackedBy(color, sq), want[key].length > 0);
      }
    }
  }
});

test('history: move counters, repetition and the fifty-move rule', () => {
  let checked = 0;
  for (const c of data.cases) {
    if (!c.moves) continue;
    const pos = build(c);
    assert.equal(pos.halfmoveClock, c.halfmove, `halfmoveClock ${c.fen}`);
    assert.equal(pos.fullmoveNumber, c.fullmove, `fullmoveNumber ${c.fen}`);
    assert.equal(pos.moveStack.length, c.moves.length);
    assert.equal(pos.isRepetition(3), c.repetition3, `isRepetition(3) after ${c.moves.join(' ')}`);
    assert.equal(pos.canClaimThreefoldRepetition(), c.claimThreefold, `canClaimThreefoldRepetition after ${c.moves.join(' ')}`);
    assert.equal(pos.canClaimFiftyMoves(), c.claimFifty, `canClaimFiftyMoves ${c.fen}`);
    checked++;
  }
  assert.ok(checked > 100);
});

test('copy() is independent of the original', () => {
  const pos = Position.fromMoves(['e2e4', 'e7e5', 'g1f3']);
  const twin = pos.copy();
  twin.push(twin.parseUci('b8c6'));
  assert.equal(pos.moveStack.length, 3);
  assert.equal(twin.moveStack.length, 4);
  assert.notEqual(pos.fen(), twin.fen());
  assert.equal(twin.pop().uci(), 'b8c6');
  assert.equal(twin.fen(), pos.fen());
});

test('perft matches the reference node counts', () => {
  for (const { fen, counts } of data.perft) {
    for (let depth = 1; depth <= counts.length; depth++) {
      if (counts[depth - 1] > 250_000) break;   // keep the suite quick
      assert.equal(perft(new Position(fen), depth), counts[depth - 1], `perft(${depth}) of ${fen}`);
    }
  }
});
