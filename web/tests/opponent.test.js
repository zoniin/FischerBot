// opponent.js: the pure parts (how a source is typeset, the apostrophes of a bot line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { attribution, sourceParts, typographic } from '../static/js/opponent.js';
import { staticData } from './helpers.js';

test('attribution names him, the source and the year', () => {
  assert.equal(attribution({ source: 'My 60 Memorable Games, game 45', year: 1969 }), '— Bobby Fischer, My 60 Memorable Games, game 45, 1969');
  assert.equal(attribution({ source: '', year: null }), '— Bobby Fischer');
  assert.equal(attribution(null), '— Bobby Fischer');
});

test('a source is typeset with the book or journal in italics, the article and the game number upright', () => {
  assert.deepEqual(sourceParts('My 60 Memorable Games, game 24'), [
    { text: 'My 60 Memorable Games', italic: true }, { text: ', game 24', italic: false },
  ]);
  assert.deepEqual(sourceParts('“A Bust to the King’s Gambit”, American Chess Quarterly'), [
    { text: '“A Bust to the King’s Gambit”, ', italic: false }, { text: 'American Chess Quarterly', italic: true },
  ]);
  assert.deepEqual(sourceParts('Chess Life'), [{ text: 'Chess Life', italic: true }]);
  assert.deepEqual(sourceParts(''), []);
  assert.deepEqual(sourceParts(null), []);
});

test('every source in the shipped commentary comes back whole', () => {
  const data = staticData('commentary.json');
  let seen = 0;
  for (const lines of Object.values(data.categories)) {
    for (const line of lines) {
      if (!line.quote) continue;
      seen += 1;
      assert.equal(sourceParts(line.quote.source).map(part => part.text).join(''), String(line.quote.source).trim());
    }
  }
  assert.ok(seen > 10);
});

test('bot lines get typographer\'s apostrophes and nothing else changes', () => {
  assert.equal(typographic("I've seen this. Don't."), 'I’ve seen this. Don’t.');
  assert.equal(typographic("Spassky's move, the players' room."), 'Spassky’s move, the players’ room.');
  assert.equal(typographic('1. e4 - best by test.'), '1. e4 - best by test.');
  assert.equal(typographic('Nothing to change'), 'Nothing to change');
});
