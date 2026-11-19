// commentary.js - what he says, and when he keeps quiet.
//
// Pure logic: no DOM, no timers, no network. The controller describes what
// just happened as a list of events, most important first; the Commentator
// answers with one line or with nothing.
//
//   const fischer = new Commentator(commentaryJson, { random });
//   fischer.newGame({ year: level.year });
//   const line = fischer.pick(events, { ply });       // inside the move loop
//   const line = fischer.say('takeback', {}, { ply }); // outside it
//
// An event is { category, frequency, vars }:
//   frequency  'always' | 'often' (two times in three) | 'sometimes' (one in four)
//   vars       values for the line's {placeholders}; a line that needs one
//              that is missing (or empty) is skipped
//
// A line comes back as { text, quote, category }: `quote` is { source, year }
// for a real quotation and null for a line of the bot's. (The data also gives
// lines a `mood`; the portrait is a photograph with one face, so it is ignored.)
//
// The rules: no text twice in a game, whatever category it is filed under (a
// quotation is never said twice); an 'always' event is always spoken; the
// others are thinned out and never come from the same category two moves
// running; real quotations are spaced at least six moves apart; a line marked
// `since` is not said by a Fischer younger than that year; a category with
// nothing left to say falls back to its plainer relative (FALLBACKS).

export const FREQUENCY = Object.freeze({ always: 1, often: 2 / 3, sometimes: 1 / 4 });

/** Plies that must pass between two real quotations (six moves). */
export const QUOTE_GAP_PLIES = 12;

/**
 * Where a category turns when none of its lines can be said (all of them are
 * marked `since` a later year than the level's, or have been said already):
 * the boy of 1956 cannot cite "My 60 Memorable Games", but he can still say
 * that he has played the move before.
 */
export const FALLBACKS = Object.freeze({
  book_move_memorable: 'book_move',
  book_move_1972: 'book_move',
});

const EVENT_WORDS = /Championship|Tournament|Interzonal|Olympiad|Open|Memorial|Cup|Trophy|match|Candidates/;

/**
 * An event's name as a noun phrase: "the U.S. Championship", "the Candidates
 * final", but "Bled" and "Mar del Plata" as they are.
 */
export function eventPhrase(name) {
  if (typeof name !== 'string') return '';
  const event = name.trim();
  if (event === '') return '';
  if (/^the\s/i.test(event)) return event;
  return EVENT_WORDS.test(event) ? `the ${event}` : event;
}

/** The template variables a book game provides: {opponent}, {year}, {event}, {game}. */
export function gameVariables(game) {
  if (game === null || typeof game !== 'object') return {};
  const vars = {};
  if (typeof game.opponent === 'string' && game.opponent !== '') vars.opponent = game.opponent;
  if (Number.isFinite(game.year)) vars.year = game.year;
  const event = eventPhrase(game.event);
  if (event !== '') vars.event = event;
  if (Number.isFinite(game.number) && game.number > 0) vars.game = game.number;
  return vars;
}

/**
 * Fills {placeholders} from `vars`. Returns null if the text needs a variable
 * that is missing, null or empty - such a line must not be said.
 */
export function fillTemplate(text, vars = {}) {
  let complete = true;
  const filled = String(text).replace(/\{(\w+)\}/g, (_, name) => {
    const value = vars === null ? undefined : vars[name];
    if (value === undefined || value === null || value === '') {
      complete = false;
      return '';
    }
    return String(value);
  });
  return complete ? filled : null;
}

/** A sentence must start with a capital even when it starts with a variable ("the U.S. ..."). */
function capitalise(text) {
  return text.replace(/^([a-z])/, letter => letter.toUpperCase());
}

export class Commentator {
  #categories;
  #random;
  #used = new Set();          // the text (as written in the data) of every line said this game
  #lastCategory = null;       // of the last line said in the move loop
  #lastSpokenPly = -Infinity;
  #lastQuotePly = -Infinity;
  #year = null;

  /**
   * @param {object} data            the parsed commentary.json ({ categories })
   * @param {object} [options]
   * @param {function(): number} [options.random]  uniform in [0, 1)
   */
  constructor(data, { random = Math.random } = {}) {
    const categories = data !== null && typeof data === 'object' && data.categories !== null
      && typeof data.categories === 'object' ? data.categories : {};
    this.#categories = new Map();
    for (const [name, lines] of Object.entries(categories)) {
      if (!Array.isArray(lines)) continue;
      const good = lines.filter(line => line !== null && typeof line === 'object'
        && typeof line.text === 'string' && line.text.trim() !== '');
      this.#categories.set(name, good);
    }
    this.#random = random;
  }

  /** Does this category have any line at all? */
  has(category) {
    return (this.#categories.get(category) ?? []).length > 0;
  }

  /** A new game: everything may be said again. `year` is the level's (for lines marked `since`). */
  newGame({ year = null } = {}) {
    this.#used.clear();
    this.#lastCategory = null;
    this.#lastSpokenPly = -Infinity;
    this.#lastQuotePly = -Infinity;
    this.#year = Number.isFinite(year) ? year : null;
  }

  /** What must survive a page reload, as plain JSON. */
  snapshot() {
    return {
      used: [...this.#used],
      lastCategory: this.#lastCategory,
      lastSpokenPly: Number.isFinite(this.#lastSpokenPly) ? this.#lastSpokenPly : null,
      lastQuotePly: Number.isFinite(this.#lastQuotePly) ? this.#lastQuotePly : null,
      year: this.#year,
    };
  }

  restore(saved) {
    this.newGame({ year: saved?.year ?? null });
    if (saved === null || typeof saved !== 'object') return;
    // (older saves keyed a line as "category\ntext": the text is what counts)
    if (Array.isArray(saved.used)) {
      for (const key of saved.used) if (typeof key === 'string') this.#used.add(key.slice(key.lastIndexOf('\n') + 1));
    }
    if (typeof saved.lastCategory === 'string') this.#lastCategory = saved.lastCategory;
    if (Number.isFinite(saved.lastSpokenPly)) this.#lastSpokenPly = saved.lastSpokenPly;
    if (Number.isFinite(saved.lastQuotePly)) this.#lastQuotePly = saved.lastQuotePly;
  }

  /**
   * One line for this move, or null. `events` are in priority order; the
   * first one that is due and has a line that can be said wins.
   */
  pick(events, { ply = 0 } = {}) {
    if (!Array.isArray(events)) return null;
    for (const event of events) {
      if (event === null || typeof event !== 'object' || typeof event.category !== 'string') continue;
      const chance = FREQUENCY[event.frequency] ?? FREQUENCY.sometimes;
      const always = chance >= 1;
      if (!always) {
        // never two moves running from the same category
        if (event.category === this.#lastCategory && ply - this.#lastSpokenPly <= 2) continue;
        if (this.#random() >= chance) continue;
      }
      const line = this.#choose(event, ply);
      if (line === null) continue;
      this.#lastCategory = event.category;
      this.#lastSpokenPly = ply;
      return line;
    }
    return null;
  }

  /** A line from one category, said unconditionally (take-back, new game, the end ...), or null. */
  say(category, vars = {}, { ply = 0 } = {}) {
    return this.#choose({ category, vars }, ply);
  }

  /**
   * Something to mutter while he thinks: each of these few lines once in a
   * game, like every other line, and never the bare dots (the bubble has its
   * own). Null when he has none left.
   */
  thinking() {
    const lines = (this.#categories.get('thinking') ?? [])
      .filter(line => !/^[.…\s]+$/.test(line.text) && !this.#used.has(line.text));
    if (lines.length === 0) return null;
    const line = lines[Math.min(lines.length - 1, Math.floor(this.#random() * lines.length))];
    this.#used.add(line.text);
    return { text: line.text, quote: null, category: 'thinking' };
  }

  #choose(event, ply) {
    const line = this.#chooseFrom(event.category, event, ply);
    if (line !== null) return line;
    const plainer = FALLBACKS[event.category];
    return plainer === undefined ? null : this.#chooseFrom(plainer, event, ply);
  }

  #chooseFrom(category, event, ply) {
    const lines = this.#categories.get(category);
    if (lines === undefined || lines.length === 0) return null;
    const quotesAllowed = ply - this.#lastQuotePly >= QUOTE_GAP_PLIES;
    const candidates = [];
    for (const line of lines) {
      const isQuote = line.quote !== null && typeof line.quote === 'object';
      if (isQuote && !quotesAllowed) continue;
      if (Number.isFinite(line.since) && this.#year !== null && this.#year < line.since) continue;
      if (this.#used.has(line.text)) continue;
      // a real quotation is his words exactly: it is never filled in or altered
      const text = isQuote ? (/\{\w+\}/.test(line.text) ? null : line.text)
        : fillTemplate(line.text, event.vars ?? {});
      if (text === null) continue;
      candidates.push({ line, text: isQuote ? text : capitalise(text), isQuote });
    }
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.min(candidates.length - 1, Math.floor(this.#random() * candidates.length))];
    this.#used.add(chosen.line.text);
    if (chosen.isQuote) this.#lastQuotePly = ply;
    return {
      text: chosen.text,
      quote: chosen.isQuote
        ? { source: String(chosen.line.quote.source ?? ''), year: chosen.line.quote.year ?? null }
        : null,
      category,
    };
  }
}
