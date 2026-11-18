// commentary.js: choosing a line, filling templates, the no-repeat rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Commentator, fillTemplate, eventPhrase, gameVariables, MOODS, QUOTE_GAP_PLIES } from '../static/js/commentary.js';
import { staticData } from './helpers.js';

/** A deterministic stand-in for Math.random that walks through `values` for ever. */
function sequence(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

const DATA = {
  categories: {
    greeting: [{ text: 'Hello.' }, { text: 'Sit down.', mood: 'annoyed' }],
    book_move: [{ text: 'I played this against {opponent} in {year}.' }, { text: '{event}, {year}. Same move.' }],
    capture: [{ text: 'Mine.' }, { text: 'Thank you.' }, { text: 'That one too.' }],
    player_blunder: [{ text: 'That loses.' }],
    quotes: [
      { text: 'Real words one.', quote: { source: 'A Book', year: 1969 } },
      { text: 'Real words two.', quote: { source: 'A Broadcast', year: 1972 }, mood: 'pleased' },
    ],
    mixed: [{ text: 'Plain.' }, { text: 'Quoted.', quote: { source: 'A Book', year: 1969 } }],
    later: [{ text: 'About Reykjavik.', since: 1972 }, { text: 'Any year.' }],
    thinking: [{ text: '...' }, { text: 'Hm.' }, { text: 'Let me see.' }],
    empty: [],
  },
};

test('fillTemplate fills every variable or refuses the line', () => {
  assert.equal(fillTemplate('I played {san} against {opponent} in {year}.', { san: 'Nf3', opponent: 'Tal', year: 1959 }),
    'I played Nf3 against Tal in 1959.');
  assert.equal(fillTemplate('Mate in {n}.', { n: 3 }), 'Mate in 3.');
  assert.equal(fillTemplate('No variables at all.', {}), 'No variables at all.');
  assert.equal(fillTemplate('Game {game}.', {}), null);
  assert.equal(fillTemplate('Game {game}.', { game: null }), null);
  assert.equal(fillTemplate('{opponent} again.', { opponent: '' }), null);
  assert.equal(fillTemplate('Game {game}.', { game: 0 }), 'Game 0.');
});

test('eventPhrase reads as a noun phrase', () => {
  assert.equal(eventPhrase('U.S. Championship'), 'the U.S. Championship');
  assert.equal(eventPhrase('Candidates final'), 'the Candidates final');
  assert.equal(eventPhrase('Portoroz Interzonal'), 'the Portoroz Interzonal');
  assert.equal(eventPhrase('World Championship'), 'the World Championship');
  assert.equal(eventPhrase('Piatigorsky Cup'), 'the Piatigorsky Cup');
  assert.equal(eventPhrase('Bled'), 'Bled');
  assert.equal(eventPhrase('Mar del Plata'), 'Mar del Plata');
  assert.equal(eventPhrase('the Olympiad'), 'the Olympiad');
  assert.equal(eventPhrase(''), '');
  assert.equal(eventPhrase(undefined), '');
});

test('gameVariables takes opponent, year, event and game number from a book game', () => {
  assert.deepEqual(
    gameVariables({ opponent: 'Spassky', year: 1972, event: 'World Championship', number: 6, source: 'wc1972' }),
    { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6 });
  assert.deepEqual(gameVariables({ opponent: 'Tal', year: 1961, event: 'Bled', number: 0 }),
    { opponent: 'Tal', year: 1961, event: 'Bled' });
  assert.deepEqual(gameVariables(null), {});
});

test('an "always" event is always spoken, and never the same line twice in a game', () => {
  const fischer = new Commentator(DATA, { random: sequence(0.99, 0.5, 0.01) });
  fischer.newGame();
  const said = new Set();
  for (let ply = 0; ply < 3; ply += 1) {
    const line = fischer.pick([{ category: 'capture', frequency: 'always' }], { ply });
    assert.ok(line, 'three lines, three remarks');
    assert.equal(line.category, 'capture');
    assert.equal(line.quote, null);
    assert.ok(!said.has(line.text), `"${line.text}" was said twice`);
    said.add(line.text);
  }
  assert.equal(fischer.pick([{ category: 'capture', frequency: 'always' }], { ply: 3 }), null, 'he has run out');
  fischer.newGame();
  assert.ok(fischer.pick([{ category: 'capture', frequency: 'always' }], { ply: 0 }), 'a new game, a clean slate');
});

test('the first event with a line wins; events without one are passed over', () => {
  const fischer = new Commentator(DATA, { random: () => 0 });
  fischer.newGame();
  const line = fischer.pick([
    { category: 'no_such_category', frequency: 'always' },
    { category: 'empty', frequency: 'always' },
    { category: 'book_move', frequency: 'always', vars: {} },        // no variables: no line can be said
    { category: 'player_blunder', frequency: 'always' },
    { category: 'capture', frequency: 'always' },
  ], { ply: 4 });
  assert.equal(line.text, 'That loses.');
  assert.equal(line.category, 'player_blunder');
  assert.equal(line.mood, 'pleased', 'the category default');
});

test('a line whose variables are missing is skipped in favour of one that can be said', () => {
  const fischer = new Commentator(DATA, { random: () => 0 });
  fischer.newGame();
  const line = fischer.pick([{ category: 'book_move', frequency: 'always', vars: { event: 'the U.S. Championship', year: 1963 } }]);
  assert.equal(line.text, 'The U.S. Championship, 1963. Same move.');
});

test('"often" is two times in three and "sometimes" one in four', () => {
  const many = { categories: { chatter: Array.from({ length: 1300 }, (_, i) => ({ text: `Line ${i}.` })) } };
  const count = frequency => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const fischer = new Commentator(many, { random });
    fischer.newGame();
    let spoken = 0;
    // every fourth ply, so that "never twice running from the same category" does not interfere
    for (let i = 0; i < 1200; i += 1) if (fischer.pick([{ category: 'chatter', frequency }], { ply: i * 4 })) spoken += 1;
    return spoken / 1200;
  };
  const often = count('often'), sometimes = count('sometimes');
  assert.ok(Math.abs(often - 2 / 3) < 0.05, `often: ${often}`);
  assert.ok(Math.abs(sometimes - 1 / 4) < 0.05, `sometimes: ${sometimes}`);
  assert.equal(count('always'), 1);
});

test('never two moves running from the same category - unless the event is an "always"', () => {
  const fischer = new Commentator(DATA, { random: () => 0 });
  fischer.newGame();
  assert.ok(fischer.pick([{ category: 'capture', frequency: 'sometimes' }], { ply: 10 }));
  assert.equal(fischer.pick([{ category: 'capture', frequency: 'sometimes' }], { ply: 12 }), null);
  assert.ok(fischer.pick([{ category: 'capture', frequency: 'always' }], { ply: 12 }), 'always means always');
  const other = fischer.pick([{ category: 'capture', frequency: 'sometimes' }, { category: 'greeting', frequency: 'sometimes' }], { ply: 14 });
  assert.equal(other.category, 'greeting', 'the next event in line gets its turn');
  assert.ok(fischer.pick([{ category: 'capture', frequency: 'sometimes' }], { ply: 16 }), 'and later it is allowed again');
});

test('real quotations are marked, kept verbatim and spaced six moves apart', () => {
  const fischer = new Commentator(DATA, { random: () => 0 });
  fischer.newGame();
  const first = fischer.pick([{ category: 'quotes', frequency: 'always' }], { ply: 6 });
  assert.deepEqual(first.quote, { source: 'A Book', year: 1969 });
  assert.equal(first.text, 'Real words one.');
  assert.equal(fischer.pick([{ category: 'quotes', frequency: 'always' }], { ply: 6 + QUOTE_GAP_PLIES - 2 }), null, 'too soon');
  const mixed = fischer.pick([{ category: 'mixed', frequency: 'always' }], { ply: 10 });
  assert.equal(mixed.text, 'Plain.', 'a category with both gives a bot line meanwhile');
  assert.equal(mixed.quote, null);
  const second = fischer.pick([{ category: 'quotes', frequency: 'always' }], { ply: 6 + QUOTE_GAP_PLIES });
  assert.equal(second.text, 'Real words two.');
  assert.equal(second.mood, 'pleased');
});

test('a bot line is never dressed up as a quotation', () => {
  const fischer = new Commentator(staticData('commentary.json'), { random: Math.random });
  fischer.newGame({ year: 1972 });
  const vars = { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6, san: 'Nf3', n: 3 };
  const data = staticData('commentary.json');
  let ply = 0;
  for (const [category, lines] of Object.entries(data.categories)) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = fischer.say(category, vars, { ply: ply += 100 });
      if (line === null) continue;
      const source = lines.find(candidate => candidate.text === line.text || !candidate.quote);
      assert.ok(MOODS.includes(line.mood), `${category}: mood ${line.mood}`);
      assert.ok(!/[{}]/.test(line.text), `${category}: unfilled variable in "${line.text}"`);
      if (line.quote !== null) {
        const original = lines.find(candidate => candidate.text === line.text);
        assert.ok(original?.quote, `${category}: "${line.text}" came back as a quotation but is not one`);
        assert.ok(line.quote.source, 'a quotation names its source');
      } else {
        assert.ok(source, category);
      }
    }
  }
});

test('every category of the shipped file can be exhausted without a repeat', () => {
  const data = staticData('commentary.json');
  const fischer = new Commentator(data);
  fischer.newGame({ year: 1972 });
  const vars = { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6, san: 'Nf3', n: 3 };
  let ply = 0;
  for (const [category, lines] of Object.entries(data.categories)) {
    const said = [];
    for (let i = 0; i <= lines.length; i += 1) {
      const line = fischer.say(category, vars, { ply: ply += 100 });
      if (line) said.push(line.text);
    }
    assert.equal(new Set(said).size, said.length, `${category} repeated a line`);
    assert.equal(said.length, lines.length, `${category}: every line can be said once with all variables present`);
  }
});

test('lines marked "since" wait for a Fischer old enough to say them', () => {
  const young = new Commentator(DATA, { random: () => 0 });
  young.newGame({ year: 1956 });
  assert.equal(young.say('later').text, 'Any year.');
  assert.equal(young.say('later'), null);
  const champion = new Commentator(DATA, { random: () => 0 });
  champion.newGame({ year: 1972 });
  assert.equal(champion.say('later').text, 'About Reykjavik.');
});

test('say() ignores the dice; the mood falls back from line to event to category', () => {
  const fischer = new Commentator(DATA, { random: sequence(0.99) });
  fischer.newGame();
  const line = fischer.say('greeting', {}, { ply: 0 });
  assert.equal(line.text, 'Sit down.');
  assert.equal(line.mood, 'annoyed');
  assert.equal(fischer.say('greeting', {}, { mood: 'surprised' }).mood, 'surprised');
  assert.equal(fischer.say('greeting'), null);
  assert.equal(fischer.say('capture', {}, { mood: 'not-a-mood' }).mood, 'neutral');
});

test('thinking lines may come round again, only not twice in a row, and never the bare dots', () => {
  const fischer = new Commentator(DATA, { random: () => 0 });
  fischer.newGame();
  let last = null;
  for (let i = 0; i < 8; i += 1) {
    const line = fischer.thinking();
    assert.ok(['Hm.', 'Let me see.'].includes(line.text));
    assert.notEqual(line.text, last);
    assert.equal(line.mood, 'thinking');
    last = line.text;
  }
  assert.equal(new Commentator({ categories: {} }).thinking(), null);
});

test('snapshot and restore carry the no-repeat memory across a reload', () => {
  const fischer = new Commentator(DATA, { random: () => 0 });
  fischer.newGame({ year: 1972 });
  const first = fischer.pick([{ category: 'capture', frequency: 'always' }], { ply: 3 });
  const quote = fischer.say('quotes', {}, { ply: 4 });
  const saved = JSON.parse(JSON.stringify(fischer.snapshot()));

  const again = new Commentator(DATA, { random: () => 0 });
  again.restore(saved);
  const next = again.pick([{ category: 'capture', frequency: 'always' }], { ply: 9 });
  assert.notEqual(next.text, first.text);
  assert.equal(again.say('quotes', {}, { ply: 10 }), null, 'the quotation gap is remembered too');
  assert.ok(quote.quote);
  again.restore(null);
  assert.equal(again.pick([{ category: 'capture', frequency: 'always' }], { ply: 0 }).text, first.text);
});

test('broken input does not throw', () => {
  const fischer = new Commentator(null);
  assert.equal(fischer.pick([{ category: 'x', frequency: 'always' }]), null);
  assert.equal(fischer.pick(null), null);
  assert.equal(fischer.say('x'), null);
  const odd = new Commentator({ categories: { x: [null, { text: '' }, { text: 'Fine.' }], y: 'no' } });
  odd.newGame();
  assert.equal(odd.say('x').text, 'Fine.');
  assert.equal(odd.pick([null, { frequency: 'always' }, { category: 'y', frequency: 'always' }]), null);
});
