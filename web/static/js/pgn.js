// pgn.js - the game as a PGN document. Pure: strings in, a string out.

import { STARTING_FEN } from './rules.js';

/** "1-0", "0-1", "1/2-1/2" or "*" for an outcome ({ winner: true | false | null }) or no outcome. */
export function resultCode(outcome) {
  if (outcome === null || outcome === undefined) return '*';
  if (outcome.winner === true) return '1-0';
  if (outcome.winner === false) return '0-1';
  return '1/2-1/2';
}

/** The same with typographic dashes, for people: "1–0", "½–½". */
export function resultText(outcome) {
  const code = resultCode(outcome);
  if (code === '1/2-1/2') return '½–½';
  if (code === '*') return '';
  return code.replace('-', '–');
}

/** The bot's name in the scoresheet and the PGN: "Bobby Fischer (FischerBot, 1972)". */
export function botName(year) {
  return Number.isFinite(year) ? `Bobby Fischer (FischerBot, ${year})` : 'Bobby Fischer (FischerBot)';
}

function escapeTag(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function pgnDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '????.??.??';
  const two = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${two(date.getMonth() + 1)}.${two(date.getDate())}`;
}

/**
 * @param {object} game
 * @param {string[]} game.sans         the moves in SAN, in order
 * @param {boolean} game.humanIsWhite
 * @param {?number} game.year          the level's year, for the bot's name
 * @param {?object} game.outcome       { winner } or null while the game is in progress
 * @param {string} [game.startFen]     where the game started, if not the usual position
 * @param {Date} [game.date]
 * @param {string} [game.event]
 * @param {string} [game.termination]  a word on how it ended ("checkmate", "stalemate" ...)
 * @returns {string} seven-tag roster, optional SetUp/FEN, move text wrapped at 80 columns
 */
export function buildPgn({
  sans = [], humanIsWhite = true, year = null, outcome = null, startFen = STARTING_FEN,
  date = null, event = 'Casual game', termination = null,
} = {}) {
  const result = resultCode(outcome);
  const bot = botName(year);
  const tags = [
    ['Event', event],
    ['Site', 'FischerBot'],
    ['Date', pgnDate(date)],
    ['Round', '-'],
    ['White', humanIsWhite ? 'You' : bot],
    ['Black', humanIsWhite ? bot : 'You'],
    ['Result', result],
  ];
  const fields = String(startFen).trim().split(/\s+/);
  const custom = fields.slice(0, 4).join(' ') !== STARTING_FEN.split(' ').slice(0, 4).join(' ');
  if (custom) tags.push(['SetUp', '1'], ['FEN', startFen]);
  if (termination) tags.push(['Termination', termination]);

  let blackToMove = fields[1] === 'b';
  let number = Number.parseInt(fields[5], 10);
  if (!Number.isFinite(number) || number < 1) number = 1;

  const tokens = [];
  sans.forEach((san, index) => {
    if (!blackToMove) tokens.push(`${number}.`);
    else if (index === 0) tokens.push(`${number}...`);
    tokens.push(san);
    if (blackToMove) number += 1;
    blackToMove = !blackToMove;
  });
  tokens.push(result);

  const lines = [];
  let line = '';
  for (const token of tokens) {
    if (line !== '' && line.length + 1 + token.length > 80) {
      lines.push(line);
      line = token;
    } else {
      line = line === '' ? token : `${line} ${token}`;
    }
  }
  if (line !== '') lines.push(line);

  const header = tags.map(([name, value]) => `[${name} "${escapeTag(value)}"]`).join('\n');
  return `${header}\n\n${lines.join('\n')}\n`;
}
