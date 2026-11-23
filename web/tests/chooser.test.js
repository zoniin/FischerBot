// chooser.js: the pure parts (what a level's card says about it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { strengthNote, strengthLabel, unbreakable, bookNote, withoutYear } from '../static/js/chooser.js';
import { LEVELS } from '../static/js/bot.js';

test('the strength on a card is the level\'s own note, never a number made up here', () => {
  assert.equal(LEVELS.length, 4);
  for (const level of LEVELS) {
    assert.ok(typeof level.strength === 'string' && level.strength !== '', `${level.id} says how strong it is`);
    assert.equal(strengthNote(level), level.strength.trim());
    assert.equal(strengthLabel(level), `Plays at ${level.strength.trim()}`);
  }
  assert.equal(strengthLabel({ id: 'x' }), '', 'a level that does not say gets no label');
  assert.equal(strengthLabel({ strength: '   ' }), '');
  assert.equal(strengthLabel({ strength: 2800 }), '', 'only a note written for people is shown');
  assert.equal(strengthLabel(null), '');
  assert.equal(strengthLabel({ strength: 'about 2000' }), 'Plays at about 2000');
});

test('a score inside a title cannot break across lines, and reads the same', () => {
  const title = unbreakable('U.S. Champion, 11–0');
  assert.equal(title.replace(/⁠/g, ''), 'U.S. Champion, 11–0');
  assert.match(title, /11⁠–⁠0/);
  assert.equal(unbreakable('World Champion'), 'World Champion');
  assert.equal(unbreakable('12½–8½'), '12½–8½', 'only digit-dash-digit is joined');
  assert.equal(unbreakable(null), '');
  for (const level of LEVELS) assert.equal(unbreakable(level.title).replace(/⁠/g, ''), level.title);
});

test('the book note and the subtitle without its year', () => {
  assert.equal(bookNote({ book: { year: 1956, later: false } }), 'His games to 1956');
  assert.equal(bookNote({ book: { year: 1972, later: true } }), 'All his games');
  assert.equal(bookNote({}), '');
  assert.equal(withoutYear('1956 · the year of the Game of the Century'), 'the year of the Game of the Century');
  assert.equal(withoutYear('1963–64 · the only perfect score'), 'the only perfect score');
  assert.equal(withoutYear('Reykjavik'), 'Reykjavik');
});
