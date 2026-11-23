// opponent.js: the pure parts (how a source is typeset, the apostrophes of a bot line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { attribution, quoted, sourceParts, stampFor, typographic } from '../static/js/opponent.js';
import { LEVELS } from '../static/js/bot.js';
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

// ---------- Regressions from the final re-test ----------

test('a quotation is set in double marks and its own double marks become single ones', () => {
  assert.equal(
    quoted('The rest of the game is, if one may use that hackneyed phrase, “a matter of technique.”'),
    '“The rest of the game is, if one may use that hackneyed phrase, ‘a matter of technique.’”',
  );
  assert.equal(quoted('He said "no" and "never" to me.'), '“He said ‘no’ and ‘never’ to me.”');
  assert.equal(quoted('Best by test.'), '“Best by test.”');
  // apostrophes and single marks are left alone
  assert.equal(quoted('I don’t believe in psychology.'), '“I don’t believe in psychology.”');
});

test('a quotation that arrives already in double marks is not wrapped twice', () => {
  assert.equal(quoted('“Best by test.”'), '“Best by test.”');
  assert.equal(quoted('"Best by test."'), '“Best by test.”');
  // ... but one that only begins and ends with quoted words keeps them, as inner marks
  assert.equal(quoted('“Yes” is not “no”'), '“‘Yes’ is not ‘no’”');
  assert.equal(quoted(''), '“”');
  assert.equal(quoted(null), '“”');
});

test('no quotation in the shipped commentary is typeset with nested double marks', () => {
  const data = staticData('commentary.json');
  let seen = 0;
  for (const lines of Object.values(data.categories)) {
    for (const line of lines) {
      if (!line.quote) continue;
      seen += 1;
      const shown = quoted(line.text);
      assert.equal(shown.at(0), '“');
      assert.equal(shown.at(-1), '”');
      assert.doesNotMatch(shown.slice(1, -1), /[“”"]/, shown);
      // nothing but the marks changes
      assert.equal(shown.slice(1, -1).replace(/[‘’]/g, "'"), line.text.trim().replace(/^[“"]([^“”"]*)[”"]$/, '$1').replace(/[“”"‘’]/g, "'"));
    }
  }
  assert.ok(seen > 10);
});

test('a quotation later than the Fischer who says it is stamped "as he later wrote"', () => {
  const book = { source: 'My 60 Memorable Games, game 45', year: 1969 };
  const article = { source: '“A Bust to the King’s Gambit”, American Chess Quarterly', year: 1961 };
  const own = { later: false, tag: 'His own words', spoken: 'Fischer, in his own words' };
  const later = { later: true, tag: 'As he later wrote', spoken: 'Fischer, as he later wrote' };
  assert.deepEqual(stampFor(book, 1956), later);
  assert.deepEqual(stampFor(book, 1958), later);
  assert.deepEqual(stampFor(book, 1963), later);
  assert.deepEqual(stampFor(book, 1972), own);
  assert.deepEqual(stampFor(article, 1956), later);
  assert.deepEqual(stampFor(article, 1958), later);
  assert.deepEqual(stampFor(article, 1963), own);
  assert.deepEqual(stampFor(article, 1972), own);
  assert.deepEqual(stampFor(book, 1969), own, 'the year itself is not later');
  assert.deepEqual(stampFor(book, 1968), later);
  // nothing known, nothing changed
  assert.deepEqual(stampFor(book, null), own);
  assert.deepEqual(stampFor(book, undefined), own);
  assert.deepEqual(stampFor({ source: 'Chess Life', year: null }, 1956), own);
  assert.deepEqual(stampFor({ source: 'Chess Life' }, 1956), own);
  assert.deepEqual(stampFor(null, 1956), own);
  assert.deepEqual(stampFor({ source: 'x', year: '1969' }, 1956), later, 'a year read back from storage as text still counts');
});

test('every shipped quotation gets one stamp or the other at each of the four levels', () => {
  const data = staticData('commentary.json');
  const years = LEVELS.map(level => level.year);
  assert.deepEqual(years, [1956, 1958, 1963, 1972]);
  const counts = Object.fromEntries(years.map(year => [year, { own: 0, later: 0 }]));
  const seen = new Set();
  for (const lines of Object.values(data.categories)) {
    for (const line of lines) {
      if (!line.quote || seen.has(line.text)) continue;
      seen.add(line.text);
      assert.ok(Number.isFinite(line.quote.year), `"${line.text}" has a year`);
      for (const year of years) {
        const stamp = stampFor(line.quote, year);
        assert.equal(stamp.later, line.quote.year > year);
        counts[year][stamp.later ? 'later' : 'own'] += 1;
      }
    }
  }
  assert.ok(seen.size > 0);
  assert.equal(counts[1972].later, 0, 'the champion of 1972 had written all of it');
  assert.equal(counts[1956].own, 0, 'the boy of 1956 had written none of it');
});
