// Tests for the DOM-free parts of the board component (web/static/js/board.js):
// square <-> cell mapping in both orientations, hit testing, pixel snapping,
// accessible names, and diffing two positions into piece movements.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Position, Move, WHITE, BLACK, KNIGHT, BISHOP, ROOK, QUEEN, SQUARE_NAMES, parseSquare,
} from '../static/js/rules.js';
import {
  PROMOTION_ORDER, pieceCode, squareToCell, cellToSquare, pointToSquare, isDarkSquare,
  snapSquareSize, positionCodes, squareLabel, describeMove, promotionCells, diffPositions,
} from '../static/js/board.js';

const sq = parseSquare;
const codesOf = (fen) => positionCodes(new Position(fen));

/** Apply a diff to a list of piece codes, the way the board applies it to its pieces. */
function applyDiff(before, diff) {
  const board = before.slice();
  for (const r of diff.removes) {
    assert.equal(board[r.sq], r.code, `remove ${r.code} from ${SQUARE_NAMES[r.sq]}`);
    board[r.sq] = '';
  }
  const lifted = diff.moves.map((m) => {
    assert.equal(board[m.from], m.code, `move ${m.code} from ${SQUARE_NAMES[m.from]}`);
    return m;
  });
  for (const m of lifted) board[m.from] = '';
  for (const m of lifted) {
    assert.equal(board[m.to], '', `${SQUARE_NAMES[m.to]} is free for ${m.code}`);
    board[m.to] = m.becomes || m.code;
  }
  for (const a of diff.adds) {
    assert.equal(board[a.sq], '', `${SQUARE_NAMES[a.sq]} is free for a new ${a.code}`);
    board[a.sq] = a.code;
  }
  return board;
}

/** Diff across one legal move and check the result is exact. */
function diffAcross(fen, uci) {
  const position = new Position(fen);
  const before = positionCodes(position);
  const move = position.parseUci(uci);
  position.push(move);
  const after = positionCodes(position);
  const diff = diffPositions(before, after, move);
  assert.deepEqual(applyDiff(before, diff), after);
  return { diff, before, after, move };
}

const names = (list, key = 'sq') => list.map((x) => SQUARE_NAMES[x[key]]).sort();
const moveNames = (diff) => diff.moves.map((m) => `${m.code}:${SQUARE_NAMES[m.from]}${SQUARE_NAMES[m.to]}`).sort();

// ---------- geometry ----------

test('squareToCell: white at the bottom', () => {
  assert.deepEqual(squareToCell(sq('a1'), WHITE), { col: 0, row: 7 });
  assert.deepEqual(squareToCell(sq('h1'), WHITE), { col: 7, row: 7 });
  assert.deepEqual(squareToCell(sq('a8'), WHITE), { col: 0, row: 0 });
  assert.deepEqual(squareToCell(sq('e4'), WHITE), { col: 4, row: 4 });
  assert.deepEqual(squareToCell(sq('e4')), { col: 4, row: 4 }, 'white is the default');
});

test('squareToCell: black at the bottom', () => {
  assert.deepEqual(squareToCell(sq('a1'), BLACK), { col: 7, row: 0 });
  assert.deepEqual(squareToCell(sq('h8'), BLACK), { col: 0, row: 7 });
  assert.deepEqual(squareToCell(sq('h1'), BLACK), { col: 0, row: 0 });
  assert.deepEqual(squareToCell(sq('e4'), BLACK), { col: 3, row: 3 });
});

test('cellToSquare inverts squareToCell for every square, both ways up', () => {
  for (const orientation of [WHITE, BLACK]) {
    const seen = new Set();
    for (let s = 0; s < 64; s++) {
      const { col, row } = squareToCell(s, orientation);
      assert.ok(col >= 0 && col < 8 && row >= 0 && row < 8);
      assert.equal(cellToSquare(col, row, orientation), s);
      seen.add(col * 8 + row);
    }
    assert.equal(seen.size, 64);
  }
});

test('flipping the board is a half turn', () => {
  for (let s = 0; s < 64; s++) {
    const w = squareToCell(s, WHITE);
    const b = squareToCell(s, BLACK);
    assert.deepEqual(b, { col: 7 - w.col, row: 7 - w.row });
  }
});

test('cellToSquare: off the board is null', () => {
  for (const [col, row] of [[-1, 0], [0, -1], [8, 0], [0, 8], [0.5, 1], [NaN, 0]]) {
    assert.equal(cellToSquare(col, row, WHITE), null);
    assert.equal(cellToSquare(col, row, BLACK), null);
  }
});

test('pointToSquare: corners, edges and outside', () => {
  const size = 480;
  assert.equal(pointToSquare(0, 0, size, WHITE), sq('a8'));
  assert.equal(pointToSquare(479.9, 479.9, size, WHITE), sq('h1'));
  assert.equal(pointToSquare(60, 0, size, WHITE), sq('b8'), 'a border belongs to the square it starts');
  assert.equal(pointToSquare(59.99, 0, size, WHITE), sq('a8'));
  assert.equal(pointToSquare(270, 270, size, WHITE), sq('e4'));
  assert.equal(pointToSquare(270, 270, size, BLACK), sq('d5'));
  assert.equal(pointToSquare(0, 0, size, BLACK), sq('h1'));
  for (const [x, y] of [[-0.1, 10], [10, -0.1], [480, 10], [10, 480], [NaN, 1]]) {
    assert.equal(pointToSquare(x, y, size, WHITE), null);
  }
  assert.equal(pointToSquare(10, 10, 0, WHITE), null);
});

test('pointToSquare agrees with squareToCell at every size', () => {
  for (const size of [280, 320, 333.5, 480, 760, 900]) {
    for (const orientation of [WHITE, BLACK]) {
      for (let s = 0; s < 64; s++) {
        const { col, row } = squareToCell(s, orientation);
        const edge = size / 8;
        assert.equal(pointToSquare((col + 0.5) * edge, (row + 0.5) * edge, size, orientation), s);
      }
    }
  }
});

test('isDarkSquare', () => {
  assert.equal(isDarkSquare(sq('a1')), true);
  assert.equal(isDarkSquare(sq('h1')), false);
  assert.equal(isDarkSquare(sq('a8')), false);
  assert.equal(isDarkSquare(sq('h8')), true);
  assert.equal(isDarkSquare(sq('d1')), false, 'the white queen starts on a light square');
  let dark = 0;
  for (let s = 0; s < 64; s++) if (isDarkSquare(s)) dark++;
  assert.equal(dark, 32);
});

test('snapSquareSize: whole device pixels, never larger than the space', () => {
  assert.equal(snapSquareSize(480), 60);
  assert.equal(snapSquareSize(487), 60);
  assert.equal(snapSquareSize(488), 61);
  assert.equal(snapSquareSize(280), 35);
  assert.equal(snapSquareSize(900), 112);
  assert.equal(snapSquareSize(0), 0);
  assert.equal(snapSquareSize(-5), 0);
  assert.equal(snapSquareSize(NaN), 0);
  assert.equal(snapSquareSize(574, 2), 71.5);
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    for (let space = 280; space <= 900; space += 13.7) {
      const edge = snapSquareSize(space, dpr);
      assert.ok(edge * 8 <= space + 1e-9, `${edge} * 8 fits ${space}`);
      assert.ok(space - edge * 8 < 8 / dpr + 1e-9, 'and wastes less than one device pixel per square');
      assert.ok(Math.abs(edge * dpr - Math.round(edge * dpr)) < 1e-9, 'whole device pixels');
    }
  }
});

// ---------- names ----------

test('pieceCode and positionCodes', () => {
  assert.equal(pieceCode(WHITE, QUEEN), 'wQ');
  assert.equal(pieceCode(BLACK, KNIGHT), 'bN');
  const codes = positionCodes(new Position());
  assert.equal(codes.length, 64);
  assert.equal(codes[sq('e1')], 'wK');
  assert.equal(codes[sq('d8')], 'bQ');
  assert.equal(codes[sq('a2')], 'wP');
  assert.equal(codes[sq('h7')], 'bP');
  assert.equal(codes[sq('e4')], '');
  assert.equal(codes.filter(Boolean).length, 32);
});

test('positionCodes does not disturb the position', () => {
  const position = new Position();
  const fen = position.fen();
  positionCodes(position);
  assert.equal(position.fen(), fen);
});

test('squareLabel: the accessible name of a square', () => {
  assert.equal(squareLabel(sq('e4'), 'wP'), 'e4, white pawn');
  assert.equal(squareLabel(sq('g8'), 'bN'), 'g8, black knight');
  assert.equal(squareLabel(sq('d1'), 'wQ'), 'd1, white queen');
  assert.equal(squareLabel(sq('e5'), ''), 'e5, empty');
});

test('describeMove', () => {
  const after = (fen) => codesOf(fen);
  assert.equal(
    describeMove(after('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'), Move.fromUci('e2e4')),
    'White pawn e2 to e4',
  );
  assert.equal(
    describeMove(after('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1'), Move.fromUci('e1g1')),
    'White castles kingside',
  );
  assert.equal(
    describeMove(after('2kr3r/8/8/8/8/8/8/R3K2R w KQ - 1 2'), Move.fromUci('e8c8'), { check: false }),
    'Black castles queenside',
  );
  assert.equal(
    describeMove(after('1N2k3/8/8/8/8/8/8/4K3 b - - 0 1'), Move.fromUci('a7b8n')),
    'White pawn a7 to b8, promotes to knight',
  );
  assert.equal(
    describeMove(after('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'), Move.fromUci('d8h4'), { check: true, mate: true }),
    'Black queen d8 to h4, checkmate',
  );
  assert.equal(
    describeMove(after('rnbqkbnr/ppp2ppp/8/1B1pp3/4P3/8/PPPP1PPP/RNBQK1NR b KQkq - 1 3'), Move.fromUci('f1b5'), { check: true }),
    'White bishop f1 to b5, check',
  );
  assert.equal(describeMove(after('8/8/8/8/8/8/8/K6k w - - 0 1'), null), '');
});

test('promotionCells: four cells from the promotion square toward the centre', () => {
  assert.deepEqual(PROMOTION_ORDER, [QUEEN, ROOK, BISHOP, KNIGHT]);
  // White promotes at the top of an unflipped board: the column runs down.
  assert.deepEqual(promotionCells(sq('b8'), WHITE), {
    col: 1, down: true, cells: [{ col: 1, row: 0 }, { col: 1, row: 1 }, { col: 1, row: 2 }, { col: 1, row: 3 }],
  });
  // Black promotes at the bottom of it: the column runs up.
  assert.deepEqual(promotionCells(sq('g1'), WHITE), {
    col: 6, down: false, cells: [{ col: 6, row: 7 }, { col: 6, row: 6 }, { col: 6, row: 5 }, { col: 6, row: 4 }],
  });
  // Flipped, it is the other way round.
  assert.equal(promotionCells(sq('b8'), BLACK).down, false);
  assert.equal(promotionCells(sq('b8'), BLACK).col, 6);
  assert.equal(promotionCells(sq('g1'), BLACK).down, true);
  assert.equal(promotionCells(sq('g1'), BLACK).col, 1);
  for (const orientation of [WHITE, BLACK]) {
    for (const name of ['a8', 'h8', 'a1', 'h1', 'd8', 'e1']) {
      for (const cell of promotionCells(sq(name), orientation).cells) {
        assert.ok(cell.row >= 0 && cell.row < 8, 'stays on the board');
      }
    }
  }
});

// ---------- diffing ----------

test('diff: nothing changed', () => {
  const codes = codesOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.deepEqual(diffPositions(codes, codes.slice()), { moves: [], removes: [], adds: [] });
  assert.deepEqual(diffPositions(codes, codes.slice(), Move.fromUci('e2e4')), { moves: [], removes: [], adds: [] });
});

test('diff: a quiet move slides one piece', () => {
  const { diff } = diffAcross('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'g1f3');
  assert.deepEqual(diff, {
    moves: [{ from: sq('g1'), to: sq('f3'), code: 'wN', becomes: null }], removes: [], adds: [],
  });
});

test('diff: a capture removes the piece that was taken', () => {
  const { diff } = diffAcross('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'e4d5');
  assert.deepEqual(diff.moves, [{ from: sq('e4'), to: sq('d5'), code: 'wP', becomes: null }]);
  assert.deepEqual(diff.removes, [{ sq: sq('d5'), code: 'bP' }]);
  assert.deepEqual(diff.adds, []);
});

test('diff: a piece takes a piece of its own kind', () => {
  const { diff } = diffAcross('4k3/8/8/3n4/8/4N3/8/4K3 w - - 0 1', 'e3d5');
  assert.deepEqual(moveNames(diff), ['wN:e3d5']);
  assert.deepEqual(diff.removes, [{ sq: sq('d5'), code: 'bN' }]);
});

test('diff: castling moves the king and the rook, both sides, both colours', () => {
  const fen = 'r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 0 1';
  const black = fen.replace(' w ', ' b ');
  assert.deepEqual(moveNames(diffAcross(fen, 'e1g1').diff), ['wK:e1g1', 'wR:h1f1']);
  assert.deepEqual(moveNames(diffAcross(fen, 'e1c1').diff), ['wK:e1c1', 'wR:a1d1']);
  assert.deepEqual(moveNames(diffAcross(black, 'e8g8').diff), ['bK:e8g8', 'bR:h8f8']);
  assert.deepEqual(moveNames(diffAcross(black, 'e8c8').diff), ['bK:e8c8', 'bR:a8d8']);
  for (const uci of ['e1g1', 'e1c1']) {
    const { diff } = diffAcross(fen, uci);
    assert.deepEqual(diff.removes, []);
    assert.deepEqual(diff.adds, []);
  }
});

test('diff: castling without the hint is still two slides', () => {
  const position = new Position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const before = positionCodes(position);
  position.push(position.parseUci('e1c1'));
  const diff = diffPositions(before, positionCodes(position));
  assert.deepEqual(moveNames(diff), ['wK:e1c1', 'wR:a1d1']);
});

test('diff: en passant removes the pawn that is not on the target square', () => {
  const { diff } = diffAcross('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 2', 'd4e3');
  assert.deepEqual(moveNames(diff), ['bP:d4e3']);
  assert.deepEqual(diff.removes, [{ sq: sq('e4'), code: 'wP' }]);
  assert.deepEqual(diff.adds, []);
});

test('diff: promotion - the pawn travels, then becomes the piece', () => {
  const fen = '1n2k3/P6P/8/8/8/8/p6p/4K1N1 w - - 0 1';
  for (const [letter, piece] of [['q', 'wQ'], ['r', 'wR'], ['b', 'wB'], ['n', 'wN']]) {
    const { diff } = diffAcross(fen, `h7h8${letter}`);
    assert.deepEqual(diff, {
      moves: [{ from: sq('h7'), to: sq('h8'), code: 'wP', becomes: piece }], removes: [], adds: [],
    });
  }
});

test('diff: promotion with a capture', () => {
  const { diff } = diffAcross('1n2k3/P6P/8/8/8/8/p6p/4K1N1 w - - 0 1', 'a7b8n');
  assert.deepEqual(diff.moves, [{ from: sq('a7'), to: sq('b8'), code: 'wP', becomes: 'wN' }]);
  assert.deepEqual(diff.removes, [{ sq: sq('b8'), code: 'bN' }]);
  const black = diffAcross('1n2k3/P6P/8/8/8/8/p6p/4K1N1 b - - 0 1', 'h2g1q').diff;
  assert.deepEqual(black.moves, [{ from: sq('h2'), to: sq('g1'), code: 'bP', becomes: 'bQ' }]);
  assert.deepEqual(black.removes, [{ sq: sq('g1'), code: 'wN' }]);
});

test('diff: a piece already dropped on its square does not move again', () => {
  // What the board shows after a drag: the mover stands on the target and
  // what it took is gone. Only the rest of the move remains to be drawn.
  const settle = (fen, uci) => {
    const position = new Position(fen);
    const shown = positionCodes(position);
    const move = position.parseUci(uci);
    shown[move.to] = shown[move.from];
    shown[move.from] = '';
    position.push(move);
    const after = positionCodes(position);
    const diff = diffPositions(shown, after, move);
    assert.deepEqual(applyDiff(shown, diff), after);
    return diff;
  };
  // a plain move and a capture: nothing left to do
  assert.deepEqual(settle('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'e2e4'), { moves: [], removes: [], adds: [] });
  assert.deepEqual(settle('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', 'e4d5'), { moves: [], removes: [], adds: [] });
  // castling: the rook still has to come round
  const castle = settle('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1g1');
  assert.deepEqual(moveNames(castle), ['wR:h1f1']);
  assert.deepEqual(castle.removes, []);
  // en passant: the captured pawn still has to go
  const ep = settle('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 2', 'd4e3');
  assert.deepEqual(ep.moves, []);
  assert.deepEqual(ep.removes, [{ sq: sq('e4'), code: 'wP' }]);
  // promotion: the pawn changes where it stands
  const promo = settle('1n2k3/P6P/8/8/8/8/p6p/4K1N1 w - - 0 1', 'a7b8r');
  assert.deepEqual(promo, {
    moves: [{ from: sq('b8'), to: sq('b8'), code: 'wP', becomes: 'wR' }], removes: [], adds: [],
  });
});

test('diff: taking a move back restores the captured piece', () => {
  const position = new Position('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const earlier = positionCodes(position);
  position.push(position.parseUci('e4d5'));
  const later = positionCodes(position);
  const diff = diffPositions(later, earlier);
  assert.deepEqual(moveNames(diff), ['wP:d5e4']);
  assert.deepEqual(diff.adds, [{ sq: sq('d5'), code: 'bP' }]);
  assert.deepEqual(diff.removes, []);
  assert.deepEqual(applyDiff(later, diff), earlier);
});

test('diff: taking back two moves, one of them castling', () => {
  const position = new Position('r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 0 1');
  const earlier = positionCodes(position);
  position.push(position.parseUci('e1g1'));
  position.push(position.parseUci('e8c8'));
  const later = positionCodes(position);
  const diff = diffPositions(later, earlier);
  assert.deepEqual(moveNames(diff), ['bK:c8e8', 'bR:d8a8', 'wK:g1e1', 'wR:f1h1']);
  assert.deepEqual(applyDiff(later, diff), earlier);
});

test('diff: a moved piece of two alike takes the nearer route', () => {
  // Both white knights could explain a knight appearing on d2; b1 is the one.
  const before = codesOf('4k3/8/8/8/8/8/8/1N2K1N1 w - - 0 1');
  const after = codesOf('4k3/8/8/8/8/8/3N4/4K1N1 b - - 0 1');
  assert.deepEqual(moveNames(diffPositions(before, after)), ['wN:b1d2']);
});

test('diff: the hint is ignored when it does not describe the change', () => {
  const before = codesOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const after = codesOf('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1');
  const diff = diffPositions(before, after, Move.fromUci('e2e4'));
  assert.deepEqual(moveNames(diff), ['wP:d2d4']);
  assert.deepEqual(applyDiff(before, diff), after);
});

test('diff: from an empty board everything is added, to an empty board everything is removed', () => {
  const empty = new Array(64).fill('');
  const start = codesOf('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const up = diffPositions(empty, start);
  assert.equal(up.adds.length, 32);
  assert.equal(up.moves.length + up.removes.length, 0);
  const down = diffPositions(start, empty);
  assert.equal(down.removes.length, 32);
  assert.equal(down.moves.length + down.adds.length, 0);
});

test('diff: any two positions of a game - applying the diff gives the target exactly', () => {
  // A deterministic walk through a long game with captures, castling and promotions.
  let seed = 20260118;
  const random = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
  const position = new Position();
  const history = [{ codes: positionCodes(position), move: null }];
  for (let ply = 0; ply < 220; ply++) {
    const legal = position.legalMoves().slice().sort((a, b) => (a.uci() < b.uci() ? -1 : 1));
    if (legal.length === 0) break;
    const captures = legal.filter((m) => position.isCapture(m) || m.promotion);
    const pool = captures.length && random() < 0.6 ? captures : legal;
    const move = pool[Math.floor(random() * pool.length)];
    const before = positionCodes(position);
    position.push(move);
    const after = positionCodes(position);
    // one move forward, with the hint
    const step = diffPositions(before, after, move);
    assert.deepEqual(applyDiff(before, step), after, `forward ${move.uci()}`);
    assert.ok(step.moves.length >= 1 && step.moves.length <= 2, 'a move slides one piece, or two when castling');
    assert.ok(step.removes.length <= 1);
    assert.equal(step.adds.length, 0, 'nothing appears from nowhere in a single move');
    assert.deepEqual(names(step.moves, 'from').includes(SQUARE_NAMES[move.from]), true);
    // and back again, without a hint
    assert.deepEqual(applyDiff(after, diffPositions(after, before)), before, `back ${move.uci()}`);
    history.push({ codes: after, move });
  }
  assert.ok(history.length > 40, 'the walk went somewhere');
  // jumps between arbitrary points of the game (review mode, take back, new game)
  for (let i = 0; i < 300; i++) {
    const a = history[Math.floor(random() * history.length)];
    const b = history[Math.floor(random() * history.length)];
    const diff = diffPositions(a.codes, b.codes, b.move);
    assert.deepEqual(applyDiff(a.codes, diff), b.codes);
  }
});

test('diff: inputs are not modified', () => {
  const before = codesOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const after = codesOf('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
  const b = before.slice();
  const a = after.slice();
  diffPositions(before, after, Move.fromUci('e1g1'));
  assert.deepEqual(before, b);
  assert.deepEqual(after, a);
  assert.ok([ROOK, BISHOP].every((t) => PROMOTION_ORDER.includes(t)));
});
