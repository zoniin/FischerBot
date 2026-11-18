// opponent.js - Fischer's card: the portrait with its expressions and the
// speech bubble that grows out of it. A view: it is told what he says and
// how he looks, and knows nothing about chess.
//
//   const fischer = new Opponent({ card, portrait, bubble, said, text, source });
//   await fischer.loadPortrait('/static/img/fischer.svg');
//   fischer.say(line);                 // { text, mood, quote } from commentary.js
//   fischer.setThinking(true);         // the look of a man calculating
//   fischer.dots();                    // a quiet "..." in the bubble
//   fischer.settle();                  // thinking is over: put the bubble back as it was
//
// The bubble has a fixed place and a reserved height, so nothing on the page
// moves when he speaks. A line is typed out quickly, stays bright while it is
// news, and then recedes ("rest") but can still be read. A real quotation is
// typeset as one - quotation marks, source, "his own words" - and a line of
// the bot's never is.

const TYPE_MS_PER_CHAR = 20;
const TYPE_MS_MAX = 1500;
const MIN_READ_MS = 1500;          // a line is not replaced by the next before this
const LINGER_MS = 5200;            // how long a line stays bright after it is typed
const LINGER_MS_PER_CHAR = 45;
const LONG_QUOTE = 100;            // characters; longer quotations are set a size smaller

/** "— Bobby Fischer, My 60 Memorable Games, game 45, 1969" as plain text. */
export function attribution(quote) {
  const parts = ['Bobby Fischer'];
  if (quote?.source) parts.push(quote.source);
  if (quote?.year) parts.push(String(quote.year));
  return `— ${parts.join(', ')}`;
}

export class Opponent {
  #card;
  #portrait;
  #bubble;
  #said;
  #text;
  #source;
  #svg = null;
  #reduced;
  #frame = 0;
  #restTimer = 0;
  #queueTimer = 0;
  #moodTimer = 0;
  #dotsTimer = 0;
  #queued = null;
  #holdUntil = 0;
  #current = null;         // the line in the bubble (null: nothing, or the dots)
  #transient = false;      // the bubble shows thinking dots or a thinking mutter
  #lastLine = null;        // the last real line, to return to after thinking
  #thinking = false;
  #lineMood = null;

  constructor({ card, portrait, bubble, said, text, source }) {
    this.#card = card;
    this.#portrait = portrait;
    this.#bubble = bubble;
    this.#said = said;
    this.#text = text;
    this.#source = source;
    this.#reduced = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  }

  /**
   * Shows the portrait. A photograph is simply an <img>; an SVG drawing is
   * fetched and inlined, so that a data-mood attribute on it can change.
   */
  async loadPortrait(url) {
    try {
      if (!/\.svg(\?|#|$)/i.test(url)) throw new Error('a raster image');
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const markup = await response.text();
      const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
      const svg = parsed.documentElement;
      if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('not an svg');
      this.#svg = document.importNode(svg, true);
      this.#svg.setAttribute('role', 'img');
      this.#svg.setAttribute('aria-label', 'Bobby Fischer');
      this.#svg.removeAttribute('width');
      this.#svg.removeAttribute('height');
      this.#portrait.replaceChildren(this.#svg);
    } catch {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Bobby Fischer';
      this.#portrait.replaceChildren(img);
    }
    this.#showMood();
  }

  /** The last line he said (for the game-over card and for saving), or null. */
  get lastLine() {
    return this.#lastLine;
  }

  /** While he calculates he looks it - unless a line he has just said has its own expression. */
  setThinking(on) {
    this.#thinking = Boolean(on);
    this.#showMood();
  }

  /**
   * He says a line.
   * @param {{text: string, mood?: string, quote?: ?{source: string, year: ?number}}} line
   * @param {object} [options]
   * @param {boolean} [options.instant]    no typewriter, no bright phase: it was said before a reload
   * @param {boolean} [options.urgent]     do not wait for the line before it to be read
   * @param {boolean} [options.sticky]     stays bright (the last word of a game)
   * @param {boolean} [options.transient]  a mutter while thinking: not remembered as his last line
   */
  say(line, options = {}) {
    if (line === null || typeof line !== 'object' || typeof line.text !== 'string') return;
    const now = performance.now();
    const waiting = this.#holdUntil - now;
    if (!options.urgent && !options.instant && waiting > 0 && this.#current !== null) {
      if (options.transient) return;                 // a mutter is not worth queueing
      this.#queued = { line, options };
      window.clearTimeout(this.#queueTimer);
      this.#queueTimer = window.setTimeout(() => {
        const next = this.#queued;
        this.#queued = null;
        if (next !== null) this.#show(next.line, next.options);
      }, waiting);
      return;
    }
    this.#queued = null;
    window.clearTimeout(this.#queueTimer);
    window.clearTimeout(this.#dotsTimer);
    this.#show(line, options);
  }

  /** Three quiet dots while he thinks - unless he has just said something that is still being read. */
  dots() {
    window.clearTimeout(this.#dotsTimer);
    if (this.#queued !== null) return;
    const wait = this.#holdUntil - performance.now();
    if (this.#current !== null && !this.#transient && this.#bubble.dataset.state === 'open' && wait > 0) {
      this.#dotsTimer = window.setTimeout(() => this.dots(), wait);   // let the line be read first
      return;
    }
    this.#stopTyping();
    window.clearTimeout(this.#restTimer);
    this.#transient = true;
    this.#current = null;
    this.#holdUntil = 0;
    this.#bubble.dataset.kind = 'dots';
    this.#bubble.dataset.long = 'false';
    this.#bubble.dataset.tight = 'false';
    const dots = [0, 1, 2].map(() => {
      const dot = document.createElement('span');
      dot.className = 'dot';
      return dot;
    });
    this.#text.replaceChildren(...dots);
    this.#source.replaceChildren();
    this.#open();
  }

  /** Thinking is over and he has nothing new to say: the bubble goes back to his last line, at rest. */
  settle() {
    window.clearTimeout(this.#dotsTimer);
    if (!this.#transient) return;
    const wait = Math.max(0, this.#holdUntil - performance.now());
    window.clearTimeout(this.#restTimer);
    this.#restTimer = window.setTimeout(() => {
      if (!this.#transient) return;
      this.#transient = false;
      if (this.#lastLine !== null) this.#show(this.#lastLine, { instant: true });
      else this.silence();
    }, wait);
  }

  /** Empties the bubble (a new game is being chosen). */
  silence() {
    this.#stopTyping();
    window.clearTimeout(this.#restTimer);
    window.clearTimeout(this.#queueTimer);
    window.clearTimeout(this.#moodTimer);
    window.clearTimeout(this.#dotsTimer);
    this.#queued = null;
    this.#current = null;
    this.#lastLine = null;
    this.#transient = false;
    this.#holdUntil = 0;
    this.#lineMood = null;
    this.#bubble.dataset.state = 'empty';
    this.#card.dataset.speaking = 'false';
    this.#said.textContent = '';
    this.#showMood();
  }

  #show(line, { instant = false, sticky = false, transient = false } = {}) {
    this.#stopTyping();
    window.clearTimeout(this.#restTimer);
    window.clearTimeout(this.#moodTimer);
    const isQuote = line.quote !== null && typeof line.quote === 'object';
    const shown = isQuote ? `“${line.text}”` : line.text;

    this.#current = line;
    this.#transient = transient;
    if (!transient) this.#lastLine = line;
    this.#bubble.dataset.kind = isQuote ? 'quote' : 'line';
    this.#bubble.dataset.long = String(isQuote && line.text.length > LONG_QUOTE);

    // for screen readers the whole line at once, and plainly which kind it is
    if (!instant) {
      this.#said.textContent = isQuote
        ? `Fischer, in his own words: ${shown} ${attribution(line.quote)}`
        : `Fischer says: ${line.text}`;
    }

    if (isQuote) {
      const source = document.createElement('cite');
      source.textContent = line.quote.source ?? '';
      const tail = line.quote.year ? `, ${line.quote.year}` : '';
      this.#source.replaceChildren('— Bobby Fischer, ', source, tail);
    } else {
      this.#source.replaceChildren();
    }

    const typed = document.createElement('span');
    const untyped = document.createElement('span');
    untyped.className = 'untyped';
    untyped.textContent = shown;
    this.#text.replaceChildren(typed, untyped);
    // the bubble has a reserved place; a line that would not fit it is set a size smaller
    this.#bubble.dataset.tight = 'false';
    const room = this.#bubble.parentElement?.clientHeight ?? 0;
    if (room > 0 && this.#text.parentElement.offsetHeight > room) this.#bubble.dataset.tight = 'true';
    untyped.textContent = '';

    if (instant) {
      typed.textContent = shown;
      this.#bubble.dataset.state = 'rest';
      this.#card.dataset.speaking = 'false';
      this.#holdUntil = 0;
      this.#lineMood = null;
      this.#showMood();
      return;
    }

    this.#lineMood = typeof line.mood === 'string' ? line.mood : 'neutral';
    this.#showMood();
    this.#open();

    const typingMs = this.#reduced.matches ? 0 : Math.min(TYPE_MS_MAX, shown.length * TYPE_MS_PER_CHAR);
    const started = performance.now();
    this.#holdUntil = started + typingMs + (transient ? 900 : MIN_READ_MS);

    const finish = () => {
      typed.textContent = shown;
      untyped.textContent = '';
      if (sticky) return;
      const linger = transient ? 1600 : Math.max(LINGER_MS, 2400 + shown.length * LINGER_MS_PER_CHAR);
      this.#restTimer = window.setTimeout(() => this.#rest(), linger);
      // the expression of the remark passes sooner than the remark itself
      this.#moodTimer = window.setTimeout(() => {
        this.#lineMood = null;
        this.#showMood();
      }, Math.min(linger, 3800));
    };

    if (typingMs === 0) {
      finish();
      return;
    }
    untyped.textContent = shown;
    let count = 0;
    const step = now => {
      const due = Math.min(shown.length, Math.ceil(((now - started) / typingMs) * shown.length));
      if (due !== count) {
        count = due;
        typed.textContent = shown.slice(0, count);
        untyped.textContent = shown.slice(count);
      }
      if (count >= shown.length) {
        this.#frame = 0;
        finish();
      } else {
        this.#frame = window.requestAnimationFrame(step);
      }
    };
    this.#frame = window.requestAnimationFrame(step);
  }

  #open() {
    // restart the pop animation even if the bubble was already open
    this.#bubble.dataset.state = 'rest';
    void this.#bubble.offsetWidth;
    this.#bubble.dataset.state = 'open';
    this.#card.dataset.speaking = 'true';
  }

  #rest() {
    if (this.#transient) {
      this.settle();
      return;
    }
    this.#bubble.dataset.state = this.#current === null ? 'empty' : 'rest';
    this.#card.dataset.speaking = 'false';
    this.#lineMood = null;
    this.#showMood();
  }

  #stopTyping() {
    if (this.#frame !== 0) window.cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #showMood() {
    const mood = this.#lineMood ?? (this.#thinking ? 'thinking' : 'neutral');
    this.#card.dataset.mood = mood;
    if (this.#svg !== null) this.#svg.setAttribute('data-mood', mood);
  }
}
