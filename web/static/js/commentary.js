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
// An event is { category, frequency, vars, mood }:
//   frequency  'always' | 'often' (two times in three) | 'sometimes' (one in four)
//   vars       values for the line's {placeholders}; a line that needs one
//              that is missing (or empty) is skipped
//   mood       the avatar's expression if the line does not name its own
//
// A line comes back as { text, mood, quote, category }: `quote` is
// { source, year } for a real quotation and null for a line of the bot's.
//
// The rules: no line twice in a game; an 'always' event is always spoken;
// the others are thinned out and never come from the same category two
// moves running; real quotations are spaced at least six moves apart; a line
// marked `since` is not said by a Fischer younger than that year.

export const MOODS = Object.freeze(['neutral', 'pleased', 'annoyed', 'thinking', 'surprised']);

export const FREQUENCY = Object.freeze({ always: 1, often: 2 / 3, sometimes: 1 / 4 });

/** Plies that must pass between two real quotations (six moves). */
export const QUOTE_GAP_PLIES = 12;

/** The expression that goes with a category when the line does not say. */
const CATEGORY_MOODS = Object.freeze({
  win_checkmate: 'pleased',
  loss_checkmate: 'annoyed',
  draw_stalemate: 'annoyed',
  draw_repetition: 'neutral',
  draw_fifty_moves: 'neutral',
  draw_insufficient: 'neutral',
  mate_in_n: 'pleased',
  getting_mated: 'surprised',
  player_blunder: 'pleased',
  player_mistake: 'pleased',
  player_inaccuracy: 'neutral',
  player_good_move: 'surprised',
  player_leaves_history: 'surprised',
  player_follows_history: 'neutral',
  player_promotes: 'annoyed',
  player_check: 'annoyed',
  player_capture: 'neutral',
  out_of_book: 'thinking',
  bot_better: 'pleased',
  bot_winning: 'pleased',
  bot_worse: 'annoyed',
  bot_losing: 'annoyed',
  bot_promotes: 'pleased',
  bot_sacrifice: 'pleased',
  bot_check: 'pleased',
  endgame_reached: 'pleased',
  thinking: 'thinking',
  idle_nudge: 'annoyed',
  takeback: 'annoyed',
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

function cleanMood(mood) {
  return MOODS.includes(mood) ? mood : null;
}

export class Commentator {
  #categories;
  #random;
  #used = new Set();          // "category\ntext" of every line said this game
  #lastCategory = null;       // of the last line said in the move loop
  #lastSpokenPly = -Infinity;
  #lastQuotePly = -Infinity;
  #lastThinking = null;
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
    this.#lastThinking = null;
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
    if (Array.isArray(saved.used)) for (const key of saved.used) if (typeof key === 'string') this.#used.add(key);
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
  say(category, vars = {}, { ply = 0, mood = null } = {}) {
    return this.#choose({ category, vars, mood }, ply);
  }

  /**
   * Something to mutter while he thinks. These few lines may come round again
   * in one game - only not twice in a row. Null if there are none.
   */
  thinking() {
    const lines = (this.#categories.get('thinking') ?? []).filter(line => !/^[.…\s]+$/.test(line.text));
    if (lines.length === 0) return null;
    const fresh = lines.length > 1 ? lines.filter(line => line.text !== this.#lastThinking) : lines;
    const line = fresh[Math.min(fresh.length - 1, Math.floor(this.#random() * fresh.length))];
    this.#lastThinking = line.text;
    return { text: line.text, mood: 'thinking', quote: null, category: 'thinking' };
  }

  #choose(event, ply) {
    const lines = this.#categories.get(event.category);
    if (lines === undefined || lines.length === 0) return null;
    const quotesAllowed = ply - this.#lastQuotePly >= QUOTE_GAP_PLIES;
    const candidates = [];
    for (const line of lines) {
      const isQuote = line.quote !== null && typeof line.quote === 'object';
      if (isQuote && !quotesAllowed) continue;
      if (Number.isFinite(line.since) && this.#year !== null && this.#year < line.since) continue;
      if (this.#used.has(`${event.category}\n${line.text}`)) continue;
      // a real quotation is his words exactly: it is never filled in or altered
      const text = isQuote ? (/\{\w+\}/.test(line.text) ? null : line.text)
        : fillTemplate(line.text, event.vars ?? {});
      if (text === null) continue;
      candidates.push({ line, text: isQuote ? text : capitalise(text), isQuote });
    }
    if (candidates.length === 0) return null;
    const chosen = candidates[Math.min(candidates.length - 1, Math.floor(this.#random() * candidates.length))];
    this.#used.add(`${event.category}\n${chosen.line.text}`);
    if (chosen.isQuote) this.#lastQuotePly = ply;
    return {
      text: chosen.text,
      mood: cleanMood(chosen.line.mood) ?? cleanMood(event.mood) ?? CATEGORY_MOODS[event.category] ?? 'neutral',
      quote: chosen.isQuote
        ? { source: String(chosen.line.quote.source ?? ''), year: chosen.line.quote.year ?? null }
        : null,
      category: event.category,
    };
  }
}
