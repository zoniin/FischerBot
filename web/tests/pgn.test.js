// pgn.js: the game as a PGN document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPgn, resultCode, resultText, botName } from '../static/js/pgn.js';
import { Position, WHITE, BLACK } from '../static/js/rules.js';

test('result codes', () => {
  assert.equal(resultCode(null), '*');
  assert.equal(resultCode({ winner: WHITE }), '1-0');
  assert.equal(resultCode({ winner: BLACK }), '0-1');
  assert.equal(resultCode({ winner: null }), '1/2-1/2');
  assert.equal(resultText({ winner: WHITE }), '1–0');
  assert.equal(resultText({ winner: null }), '½–½');
  assert.equal(resultText(null), '');
});

test('the bot is named with the level\'s year', () => {
  assert.equal(botName(1972), 'Bobby Fischer (FischerBot, 1972)');
  assert.equal(botName(null), 'Bobby Fischer (FischerBot)');
});

test('a finished game as White: seven tags, numbered moves, the result at the end', () => {
  const pgn = buildPgn({
    sans: ['f3', 'e5', 'g4', 'Qh4#'], humanIsWhite: true, year: 1956, outcome: { winner: BLACK },
    date: new Date(2026, 10, 18), termination: 'checkmate',
  });
  assert.equal(pgn, [
    '[Event "Casual game"]',
    '[Site "FischerBot"]',
    '[Date "2026.11.18"]',
    '[Round "-"]',
    '[White "You"]',
    '[Black "Bobby Fischer (FischerBot, 1956)"]',
    '[Result "0-1"]',
    '[Termination "checkmate"]',
    '',
    '1. f3 e5 2. g4 Qh4# 0-1',
    '',
  ].join('\n'));
});

test('a game in progress as Black ends with an asterisk', () => {
  const pgn = buildPgn({ sans: ['e4', 'c5', 'Nf3'], humanIsWhite: false, year: 1972 });
  assert.match(pgn, /\[White "Bobby Fischer \(FischerBot, 1972\)"\]\n\[Black "You"\]\n\[Result "\*"\]/);
  assert.match(pgn, /\n\n1\. e4 c5 2\. Nf3 \*\n$/);
  assert.match(pgn, /\[Date "\?\?\?\?\.\?\?\.\?\?"\]/);
  assert.ok(!pgn.includes('[FEN'));
});

test('a game from a set-up position carries SetUp and FEN and starts with the right number', () => {
  const fen = '6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 31';
  const pgn = buildPgn({ sans: ['h6', 'Ra8+', 'Kh7'], humanIsWhite: true, year: 1963, startFen: fen });
  assert.match(pgn, /\[SetUp "1"\]\n\[FEN "6k1\/5ppp\/8\/8\/8\/8\/8\/R5K1 b - - 0 31"\]/);
  assert.match(pgn, /\n\n31\.\.\. h6 32\. Ra8\+ Kh7 \*\n$/);
});

test('move text is wrapped at 80 columns and parses back to the same game', () => {
  const moves = [];
  const position = new Position();
  const sans = [];
  // a long, legal shuffle
  const cycle = ['g1f3', 'g8f6', 'b1c3', 'b8c6', 'f3g1', 'f6g8', 'c3b1', 'c6b8'];
  for (let i = 0; i < 48; i += 1) {
    const move = position.parseUci(cycle[i % cycle.length]);
    sans.push(position.san(move));
    position.push(move);
    moves.push(move);
  }
  const pgn = buildPgn({ sans, humanIsWhite: true, year: 1958, outcome: { winner: null } });
  const [, body] = pgn.split('\n\n');
  for (const line of body.trimEnd().split('\n')) assert.ok(line.length <= 80, `"${line}" is ${line.length} long`);
  assert.ok(body.trimEnd().split('\n').length > 1);
  const replay = new Position();
  const tokens = body.split(/\s+/).filter(token => token !== '' && !/^\d+\.+$/.test(token));
  assert.equal(tokens.pop(), '1/2-1/2');
  for (const san of tokens) replay.push(replay.parseSan(san));
  assert.equal(replay.fen(), position.fen());
});

test('quotes and backslashes in tag values are escaped', () => {
  const pgn = buildPgn({ sans: [], event: 'The "Match" \\ of the century' });
  assert.match(pgn, /\[Event "The \\"Match\\" \\\\ of the century"\]/);
  assert.match(pgn, /\n\n\*\n$/);
});
