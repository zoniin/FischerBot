// commentary.js: choosing a line, filling templates, the no-repeat rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Commentator, fillTemplate, eventPhrase, gameVariables, FALLBACKS, QUOTE_GAP_PLIES } from '../static/js/commentary.js';
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
  assert.ok(!('mood' in line), 'the portrait has one face: no mood is handed on');
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
  const vars = { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6, san: 'Nf3', n: 3 };
  let ply = 0;
  for (const [category, lines] of Object.entries(data.categories)) {
    fischer.newGame({ year: 1972 });           // (a text filed under two categories is said once per game)
    const said = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = fischer.say(category, vars, { ply: ply += 100 });
      if (line) said.push(line.text);
    }
    assert.equal(new Set(said).size, said.length, `${category} repeated a line`);
    assert.equal(said.length, lines.length, `${category}: every line can be said once with all variables present`);
    const more = fischer.say(category, vars, { ply: ply += 100 });
    if (category in FALLBACKS) assert.equal(more.category, FALLBACKS[category], `${category}: then its plainer relative`);
    else assert.equal(more, null, `${category}: then nothing`);
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

test('say() ignores the dice and runs dry when the category is used up', () => {
  const fischer = new Commentator(DATA, { random: sequence(0.99) });
  fischer.newGame();
  const line = fischer.say('greeting', {}, { ply: 0 });
  assert.equal(line.text, 'Sit down.');
  assert.deepEqual(Object.keys(line).sort(), ['category', 'quote', 'text']);
  assert.equal(fischer.say('greeting').text, 'Hello.');
  assert.equal(fischer.say('greeting'), null);
});

test('each thinking mutter is said once in a game, and never the bare dots', () => {
  const fischer = new Commentator(DATA, { random: () => 0 });
  fischer.newGame();
  const said = [fischer.thinking(), fischer.thinking()].map(line => line.text);
  assert.deepEqual(said.sort(), ['Hm.', 'Let me see.']);
  assert.equal(fischer.thinking(), null, 'nothing left: the dots will do');
  fischer.newGame();
  assert.ok(fischer.thinking(), 'a new game, and he may mutter again');
  assert.equal(new Commentator({ categories: {} }).thinking(), null);

  const real = new Commentator(staticData('commentary.json'));
  real.newGame({ year: 1972 });
  const mutters = [];
  for (let i = 0; i < 40; i += 1) {
    const line = real.thinking();
    if (line !== null) mutters.push(line.text);
  }
  assert.equal(new Set(mutters).size, mutters.length, 'no mutter twice');
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

// ---------------------------------------------------------------------------
// Regressions from the QA review
// ---------------------------------------------------------------------------

test('a category with nothing to say at this level falls back to its plainer relative', () => {
  assert.deepEqual({ ...FALLBACKS }, { book_move_memorable: 'book_move', book_move_1972: 'book_move' });
  const data = {
    categories: {
      book_move: [{ text: 'I have had this against {opponent}.' }],
      book_move_memorable: [{ text: 'Game {game} in my book.', since: 1969 }],
      book_move_1972: [{ text: 'Game {game} in Reykjavik.', since: 1972 }],
      other: [{ text: 'Too early.', since: 1972 }],
    },
  };
  const vars = { opponent: 'Unzicker', year: 1962, event: 'the Varna Olympiad', game: 42 };
  const boy = new Commentator(data, { random: () => 0 });
  boy.newGame({ year: 1956 });
  const line = boy.pick([{ category: 'book_move_memorable', frequency: 'always', vars }], { ply: 1 });
  assert.equal(line.text, 'I have had this against Unzicker.');
  assert.equal(line.category, 'book_move', 'the line says where it really came from');
  boy.newGame({ year: 1956 });
  assert.equal(boy.say('book_move_1972', vars).text, 'I have had this against Unzicker.');
  assert.equal(boy.say('other', vars), null, 'only the categories named in FALLBACKS fall back');

  const champion = new Commentator(data, { random: () => 0 });
  champion.newGame({ year: 1972 });
  assert.equal(champion.say('book_move_memorable', vars).text, 'Game 42 in my book.', 'no fallback while its own lines can be said');
  assert.equal(champion.say('book_move_memorable', vars).text, 'I have had this against Unzicker.', 'used up: the plainer one');
  assert.equal(champion.say('book_move_memorable', vars), null);
});

test('with the real data every level has something to say on its first book move', () => {
  const data = staticData('commentary.json');
  const vars = { opponent: 'Unzicker', year: 1962, event: 'the Varna Olympiad', game: 42 };
  for (const year of [1956, 1958, 1963, 1972]) {
    for (const category of ['book_move', 'book_move_memorable', 'book_move_1972']) {
      const fischer = new Commentator(data);
      fischer.newGame({ year });
      const line = fischer.pick([{ category, frequency: 'always', vars }], { ply: 1 });
      assert.ok(line !== null, `${category} in ${year}`);
      assert.ok(!/[{}]/.test(line.text));
      if (year < 1969) assert.equal(line.category, category === 'book_move' ? 'book_move' : 'book_move');
    }
  }
});

test('the same words are never said twice in a game, whatever category they are filed under', () => {
  const data = {
    categories: {
      bot_better: [{ text: 'Tactics flow from a superior game.', quote: { source: 'A Book', year: 1969 } }],
      quotes: [{ text: 'Tactics flow from a superior game.', quote: { source: 'A Book', year: 1969 } }],
      a: [{ text: 'Same words.' }],
      b: [{ text: 'Same words.' }],
    },
  };
  const fischer = new Commentator(data, { random: () => 0 });
  fischer.newGame();
  assert.ok(fischer.say('bot_better', {}, { ply: 10 }));
  assert.equal(fischer.say('quotes', {}, { ply: 100 }), null, 'the quotation was said already');
  assert.ok(fischer.say('a'));
  assert.equal(fischer.say('b'), null);

  // the memory survives a reload, also one saved by the older "category + text" keys
  const again = new Commentator(data, { random: () => 0 });
  again.restore(JSON.parse(JSON.stringify(fischer.snapshot())));
  assert.equal(again.say('quotes', {}, { ply: 200 }), null);
  again.restore({ used: ['a\nSame words.'] });
  assert.equal(again.say('b'), null);
});

test('a whole game of the real commentary never repeats a text', () => {
  const data = staticData('commentary.json');
  const vars = { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6, san: 'Nf3', n: 3 };
  const fischer = new Commentator(data);
  fischer.newGame({ year: 1972 });
  const said = [];
  let ply = 0;
  for (let round = 0; round < 6; round += 1) {
    for (const category of Object.keys(data.categories)) {
      const line = category === 'thinking' ? fischer.thinking() : fischer.say(category, vars, { ply: ply += 20 });
      if (line !== null) said.push(line.quote ? line.text : `${line.text}`);
    }
  }
  const quotations = said.filter(text => Object.values(data.categories).flat().some(line => line.quote && line.text === text));
  assert.equal(new Set(quotations).size, quotations.length, 'no quotation twice');
  assert.ok(quotations.length > 10);
});
