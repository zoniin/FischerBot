// commentary.js: choosing a line, filling templates, the no-repeat rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Commentator, fillTemplate, capitalise, eventPhrase, gameVariables, FALLBACKS, QUOTE_GAP_PLIES,
} from '../static/js/commentary.js';
import { staticData } from './helpers.js';

/** A deterministic stand-in for Math.random that walks through `values` for ever. */
function sequence(...values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/**
 * A seeded generator, uniform in [0, 1) (mulberry32): the tests that let him
 * choose freely among the shipped lines run under these seeds and no others,
 * so that a failure can be repeated. Never Math.random in a test.
 */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 7, 59 and 326 are seeds under which "a whole game ..." below used to fail
const SEEDS = [1, 2, 3, 7, 59, 326, 1972];

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
  const data = staticData('commentary.json');
  const vars = { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6, san: 'Nf3', n: 3 };
  for (const seed of SEEDS) {
    // one game for the whole file: a text filed under two categories is said
    // once, and a category that has run out may answer with its plainer relative
    const fischer = new Commentator(data, { random: seeded(seed) });
    fischer.newGame({ year: 1972 });
    let ply = 0, quotations = 0, botLines = 0;
    for (const [category, lines] of Object.entries(data.categories)) {
      for (let i = 0; i <= lines.length; i += 1) {
        const line = fischer.say(category, vars, { ply: ply += 100 });
        if (line === null) continue;
        const where = `seed ${seed}, ${category}`;
        assert.ok(line.category === category || line.category === FALLBACKS[category],
          `${where}: a line from ${line.category}`);
        assert.ok(!/[{}]/.test(line.text), `${where}: unfilled variable in "${line.text}"`);
        // looked up in the category the line came from, which is not always the one asked for
        const home = data.categories[line.category];
        if (line.quote !== null) {
          const original = home.find(candidate => candidate.text === line.text);
          assert.ok(original?.quote, `${where}: "${line.text}" came back as a quotation but is not one`);
          assert.deepEqual(line.quote, { source: original.quote.source, year: original.quote.year });
          assert.ok(line.quote.source, 'a quotation names its source');
          quotations += 1;
        } else {
          const original = home.find(candidate => {
            const filled = fillTemplate(candidate.text, vars);
            return filled !== null && capitalise(filled) === line.text;
          });
          assert.ok(original, `${where}: "${line.text}" is not a line of ${line.category}`);
          assert.ok(!original.quote, `${where}: "${line.text}" is a quotation and came back as a line of the bot's`);
          botLines += 1;
        }
      }
    }
    const all = Object.values(data.categories).flat();
    const distinctQuotations = new Set(all.filter(line => line.quote).map(line => line.text)).size;
    assert.equal(quotations, distinctQuotations, `seed ${seed}: every quotation once, wherever it is filed`);
    assert.equal(quotations + botLines, new Set(all.map(line => line.text)).size, `seed ${seed}: and every other line once`);
  }
});

test('every category of the shipped file can be exhausted without a repeat', () => {
  const data = staticData('commentary.json');
  const vars = { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6, san: 'Nf3', n: 3 };
  for (const seed of SEEDS) {
    const fischer = new Commentator(data, { random: seeded(seed) });
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

  for (const seed of SEEDS) {
    const real = new Commentator(staticData('commentary.json'), { random: seeded(seed) });
    real.newGame({ year: 1972 });
    const mutters = [];
    for (let i = 0; i < 40; i += 1) {
      const line = real.thinking();
      if (line !== null) mutters.push(line.text);
    }
    assert.ok(mutters.length > 0);
    assert.equal(new Set(mutters).size, mutters.length, 'no mutter twice');
  }
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
  for (const seed of SEEDS) {
    for (const year of [1956, 1958, 1963, 1972]) {
      for (const category of ['book_move', 'book_move_memorable', 'book_move_1972']) {
        const fischer = new Commentator(data, { random: seeded(seed) });
        fischer.newGame({ year });
        const line = fischer.pick([{ category, frequency: 'always', vars }], { ply: 1 });
        assert.ok(line !== null, `${category} in ${year}`);
        assert.ok(!/[{}]/.test(line.text));
        if (year < 1969) assert.equal(line.category, 'book_move', `${category} in ${year}: nothing of its own yet`);
      }
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
  // This is the test that failed about once in sixteen runs: it drew from
  // Math.random, asked every category six times and expected "more than ten"
  // quotations - but how many of the eighteen turn up in six rounds is a
  // matter of luck (ten or fewer under 245 of 4000 seeds). Now the generator
  // is seeded, and every category is asked until it has nothing left, so that
  // what must be true does not depend on the draw: each text exactly once.
  const data = staticData('commentary.json');
  const vars = { opponent: 'Spassky', year: 1972, event: 'the World Championship', game: 6, san: 'Nf3', n: 3 };
  const all = Object.values(data.categories).flat();
  const quotationTexts = new Set(all.filter(line => line.quote).map(line => line.text));
  const rounds = Math.max(...Object.values(data.categories).map(lines => lines.length)) + 1;
  for (const seed of SEEDS) {
    const fischer = new Commentator(data, { random: seeded(seed) });
    fischer.newGame({ year: 1972 });
    const said = [], quotations = [];
    let ply = 0;
    for (let round = 0; round < rounds; round += 1) {
      for (const category of Object.keys(data.categories)) {
        const line = category === 'thinking' ? fischer.thinking() : fischer.say(category, vars, { ply: ply += 20 });
        if (line === null) continue;
        said.push(line.text);
        assert.equal(line.quote !== null, quotationTexts.has(line.text), `seed ${seed}: "${line.text}"`);
        if (line.quote !== null) quotations.push(line.text);
      }
    }
    assert.equal(new Set(said).size, said.length, `seed ${seed}: no text twice`);
    assert.equal(new Set(quotations).size, quotations.length, `seed ${seed}: no quotation twice`);
    assert.equal(quotations.length, quotationTexts.size, `seed ${seed}: and each of them once, by the end`);
    for (const category of Object.keys(data.categories)) {
      const more = category === 'thinking' ? fischer.thinking() : fischer.say(category, vars, { ply: ply += 20 });
      assert.equal(more, null, `seed ${seed}: ${category} has run dry`);
    }
  }
});

// ---------------------------------------------------------------------------
// Regressions from the last review before the site went live
// ---------------------------------------------------------------------------

test('a line that begins with a move keeps its case: "e4.", never "E4."', () => {
  for (const move of ['e4. Now show me your defense.', 'exd5 was the move.', 'e8=Q and it is over.', 'bxa8=N+!',
    'a3? Why.', 'h1 is the square.', 'e4-e5 next.', 'e4', 'gxh8=Q#']) {
    assert.equal(capitalise(move), move);
  }
  assert.equal(capitalise('the U.S. Championship, 1963.'), 'The U.S. Championship, 1963.');
  assert.equal(capitalise('enough history.'), 'Enough history.');
  assert.equal(capitalise('each move counts.'), 'Each move counts.', 'a word that only begins like a square');
  assert.equal(capitalise('a4x is no move.'), 'A4x is no move.');
  assert.equal(capitalise('Nf3 again.'), 'Nf3 again.');
  assert.equal(capitalise('O-O. Safe.'), 'O-O. Safe.');
  assert.equal(capitalise('1956. A good year.'), '1956. A good year.');

  // through a template: a move stays as the score sheet has it, a name of an event gets its capital
  const data = { categories: { echo: [{ text: '{san}? I expected something else.' }], cite: [{ text: '{event}. Same move.' }] } };
  const fischer = new Commentator(data, { random: () => 0 });
  for (const [san, said] of [['e5', 'e5?'], ['exd5', 'exd5?'], ['e8=Q+', 'e8=Q+?'], ['Nf6', 'Nf6?'], ['O-O', 'O-O?']]) {
    fischer.newGame();
    assert.equal(fischer.say('echo', { san }).text, `${said} I expected something else.`);
  }
  assert.equal(fischer.say('cite', { event: 'the U.S. Championship' }).text, 'The U.S. Championship. Same move.');

  // the shipped lines for 1.e4: all of them, under any draw
  const real = staticData('commentary.json');
  const written = real.categories.first_move_e4.map(line => line.text);
  assert.ok(written.filter(text => text.startsWith('e4. ')).length >= 3, 'three of his lines begin with the move');
  for (const seed of SEEDS) {
    const bobby = new Commentator(real, { random: seeded(seed) });
    bobby.newGame({ year: 1972 });
    const said = [];
    for (let i = 0; i < written.length; i += 1) {
      const line = bobby.pick([{ category: 'first_move_e4', frequency: 'always' }], { ply: i * 100 });
      said.push(line.text);
    }
    assert.deepEqual([...said].sort(), [...written].sort(), 'each exactly as it is written');
    assert.ok(!said.some(text => /^E4/.test(text)));
  }
});

test('the general pool of quotations holds only those that fit any moment of any game', () => {
  const data = staticData('commentary.json');
  const pool = data.categories.quotes;
  assert.ok(pool.length >= 2);
  for (const line of pool) {
    assert.ok(line.quote, `"${line.text}" is in the pool and is not a quotation`);
    assert.ok(!('since' in line), `"${line.text}" is about something that happened: it needs its moment`);
    // a quotation with a moment of its own (the endgame, an advantage, a gambit, a lost game)
    // is filed under that moment, and what is filed there is not offered on any move as well
    for (const [category, lines] of Object.entries(data.categories)) {
      if (category === 'quotes') continue;
      assert.ok(!lines.some(other => other.text === line.text), `"${line.text}" is also filed under ${category}`);
    }
  }
  const texts = pool.map(line => line.text);
  for (const moment of ['endgame', 'tactics flow', 'advantage', 'gambit', 'blundered']) {
    assert.ok(!texts.some(text => text.includes(moment)), `a quotation about "${moment}" in the general pool`);
  }
  const home = text => Object.entries(data.categories)
    .filter(([, lines]) => lines.some(line => line.quote && line.text.includes(text))).map(([category]) => category);
  assert.deepEqual(home('medals for endgame technique'), ['endgame_reached']);
  assert.deepEqual(home('tactics flow from a positionally superior game'), ['bot_better']);
  assert.deepEqual(home('drive your advantage home'), ['bot_winning']);
  assert.deepEqual(home('refutation of any gambit'), ['opening_kings_gambit']);
  assert.deepEqual(home('I blundered and lost the game'), ['bot_losing']);
  const anecdote = data.categories.bot_losing.find(line => line.text.includes('I blundered and lost the game'));
  assert.equal(anecdote.since, 1960, 'the game with Spassky at Mar del Plata: not before 1960');
});

test('a line marked "as" is said only when he has those pieces', () => {
  // "Of course White can always play differently, in which case he merely loses differently."
  // is his case against the King's Gambit: not something to say in the game in which he plays it.
  const data = staticData('commentary.json');
  const lines = data.categories.opening_kings_gambit;
  const bust = lines.filter(line => line.quote);
  assert.equal(bust.length, 3);
  for (const line of bust) assert.equal(line.as, 'black', line.text);

  const drain = fischer => {
    const said = [];
    for (let i = 0, ply = 0; i < lines.length + 2; i += 1) {
      const line = fischer.say('opening_kings_gambit', {}, { ply: ply += 100 });
      if (line !== null) said.push(line);
    }
    return said;
  };
  const playing = side => {
    const fischer = new Commentator(data, { random: () => 0 });
    fischer.newGame({ year: 1972, side });
    return fischer;
  };
  const quotations = said => said.filter(line => line.quote !== null).length;

  const asWhite = drain(playing('white'));
  assert.equal(quotations(asWhite), 0, 'not when he is White');
  assert.ok(asWhite.length >= 5, 'he still has plenty to say about it');
  assert.equal(quotations(drain(playing('black'))), 3);
  assert.equal(quotations(drain(playing(null))), 3, 'colour unknown: nothing is held back');

  // the colour survives a reload with the rest of what he remembers
  const reloaded = new Commentator(data, { random: () => 0 });
  reloaded.restore(playing('white').snapshot());
  assert.equal(quotations(drain(reloaded)), 0);
});
