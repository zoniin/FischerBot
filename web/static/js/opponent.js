// opponent.js - Fischer above the board: the portrait and the speech bubble
// beside it. A view: it is told what he says and whether he is thinking, and
// knows nothing about chess.
//
//   const fischer = new Opponent({ card, bubble, said, text, source });
//   fischer.say(line);                 // { text, quote } from commentary.js
//   fischer.setThinking(true);         // the photograph leans in, slowly (CSS on data-thinking)
//   fischer.dots();                    // a quiet "..." in the bubble
//   fischer.settle();                  // thinking is over: put the bubble back as it was
//
// The portrait is a photograph with one face: nothing here changes it. The
// bubble has a fixed place and a reserved height, so nothing on the page moves
// when he speaks; a line too long for that place is set a size smaller. A line
// is typed out quickly, stays bright while it is news, and then recedes
// ("rest") but can still be read. A real quotation is typeset as one -
// quotation marks, source, "his own words" - and a line of the bot's never is.

const TYPE_MS_PER_CHAR = 20;
const TYPE_MS_MAX = 1500;
const MIN_READ_MS = 1500;          // a line is not replaced by the next before this
const LINGER_MS = 5200;            // how long a line stays bright after it is typed
const LINGER_MS_PER_CHAR = 45;
const LONG_QUOTE = 100;            // characters; longer quotations are set a size smaller
const TIGHTEST = 4;                // how many sizes smaller a line may be set to fit its place

/** "— Bobby Fischer, My 60 Memorable Games, game 45, 1969" as plain text. */
export function attribution(quote) {
  const parts = ['Bobby Fischer'];
  if (quote?.source) parts.push(quote.source);
  if (quote?.year) parts.push(String(quote.year));
  return `— ${parts.join(', ')}`;
}

/**
 * A source as it is typeset: the title of a book or a journal in italics, the
 * title of an article (already in quotation marks) and "game 24" upright.
 *   'My 60 Memorable Games, game 24'            -> [My 60 Memorable Games]i , game 24
 *   '“A Bust ...”, American Chess Quarterly'    -> “A Bust ...”, [American Chess Quarterly]i
 * @returns {{ text: string, italic: boolean }[]}
 */
export function sourceParts(source) {
  const text = String(source ?? '').trim();
  if (text === '') return [];
  const article = /^([“"].*?[”"],?\s*)(.+)$/.exec(text);
  if (article !== null) return [{ text: article[1], italic: false }, ...sourceParts(article[2])];
  const detail = /^(.*?)(,\s*(?:games?|p\.|pp\.|chapter|vol\.|no\.|introduction)\b.*)$/i.exec(text);
  if (detail !== null && detail[1] !== '') return [{ text: detail[1], italic: true }, { text: detail[2], italic: false }];
  return [{ text, italic: true }];
}

/** A bot line with typographer's apostrophes ("I've", not "I've" from a typewriter). Quotations are left exactly as they are. */
export function typographic(text) {
  return String(text).replace(/(\p{L})'(\p{L})/gu, '$1’$2').replace(/(\p{L})'(?=\s|$|[.,;:!?])/gu, '$1’');
}

/**
 * A line typeset as a quotation: set in double marks, and any double marks of its own become single ones
 * (“The rest is ‘a matter of technique.’”). A line that arrives already wrapped in one pair is not wrapped twice.
 */
export function quoted(text) {
  let words = String(text ?? '').trim();
  const wrapped = /^[“"][^“”"]*[”"]$/.test(words);
  if (wrapped) words = words.slice(1, -1);
  let open = false;
  const inner = words.replace(/[“”"]/g, mark => {
    if (mark === '“') open = true;
    else if (mark === '”') open = false;
    else open = !open;
    return open ? '‘' : '’';
  });
  return `“${inner}”`;
}

export class Opponent {
  #card;
  #bubble;
  #said;
  #text;
  #source;
  #reduced;
  #frame = 0;
  #restTimer = 0;
  #queueTimer = 0;
  #dotsTimer = 0;
  #queued = null;
  #holdUntil = 0;
  #current = null;         // the line in the bubble (null: nothing, or the dots)
  #transient = false;      // the bubble shows thinking dots or a thinking mutter
  #lastLine = null;        // the last real line, to return to after thinking

  constructor({ card, bubble, said, text, source }) {
    this.#card = card;
    this.#bubble = bubble;
    this.#said = said;
    this.#text = text;
    this.#source = source;
    this.#reduced = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    // the bubble's place changes size with the window: a line that fitted may need refitting
    if (typeof ResizeObserver === 'function' && bubble.parentElement) {
      new ResizeObserver(() => this.#fit()).observe(bubble.parentElement);
    }
  }

  /** While he calculates the photograph leans in (CSS on data-thinking). */
  setThinking(on) {
    this.#card.dataset.thinking = String(Boolean(on));
  }

  /**
   * He says a line.
   * @param {{text: string, quote?: ?{source: string, year: ?number}}} line
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
    this.#bubble.dataset.tight = '0';
    this.#bubble.dataset.typed = 'false';
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
    window.clearTimeout(this.#dotsTimer);
    this.#queued = null;
    this.#current = null;
    this.#lastLine = null;
    this.#transient = false;
    this.#holdUntil = 0;
    this.#bubble.dataset.state = 'empty';
    this.#card.dataset.speaking = 'false';
    this.#card.dataset.crowded = 'false';
    this.#said.textContent = '';
  }

  #show(line, { instant = false, sticky = false, transient = false } = {}) {
    this.#stopTyping();
    window.clearTimeout(this.#restTimer);
    const isQuote = line.quote !== null && typeof line.quote === 'object';
    const shown = isQuote ? quoted(line.text) : typographic(line.text);

    this.#current = line;
    this.#transient = transient;
    if (!transient) this.#lastLine = line;
    this.#bubble.dataset.kind = isQuote ? 'quote' : 'line';
    this.#bubble.dataset.long = String(isQuote && line.text.length > LONG_QUOTE);
    this.#bubble.dataset.typed = 'false';

    // for screen readers the whole line at once, and plainly which kind it is
    if (!instant) {
      this.#said.textContent = isQuote
        ? `Fischer, in his own words: ${shown} ${attribution(line.quote)}`
        : `Fischer says: ${shown}`;
    }

    if (isQuote) {
      // "— Bobby Fischer, " then the source; where the bubble has had to be set smaller the name steps aside
      // (style.css: .bubble-by) so that the source keeps to one line - the stamp above already says whose words they are
      const parts = sourceParts(line.quote.source);
      const nodes = ['— '];
      if (parts.length > 0) {
        const by = document.createElement('span');
        by.className = 'bubble-by';
        by.textContent = 'Bobby Fischer, ';
        nodes.push(by);
      } else {
        nodes.push('Bobby Fischer');
      }
      for (const part of parts) {
        if (part.italic) {
          const cite = document.createElement('cite');
          cite.textContent = part.text;
          nodes.push(cite);
        } else {
          nodes.push(part.text);
        }
      }
      if (line.quote.year) nodes.push(`, ${line.quote.year}`);
      this.#source.replaceChildren(...nodes);
    } else {
      this.#source.replaceChildren();
    }

    // the whole line is laid out at once (the part not yet typed is transparent),
    // so the bubble has its final size from the first letter
    const typed = document.createElement('span');
    const untyped = document.createElement('span');
    untyped.className = 'untyped';
    untyped.textContent = shown;
    this.#text.replaceChildren(typed, untyped);
    this.#fit();

    if (instant) {
      typed.textContent = shown;
      untyped.textContent = '';
      this.#bubble.dataset.typed = 'true';
      this.#bubble.dataset.state = 'rest';
      this.#card.dataset.speaking = 'false';
      this.#holdUntil = 0;
      return;
    }

    this.#open();

    const typingMs = this.#reduced.matches ? 0 : Math.min(TYPE_MS_MAX, shown.length * TYPE_MS_PER_CHAR);
    const started = performance.now();
    this.#holdUntil = started + typingMs + (transient ? 900 : MIN_READ_MS);

    const finish = () => {
      typed.textContent = shown;
      untyped.textContent = '';
      this.#bubble.dataset.typed = 'true';          // the source and the "his own words" stamp arrive now
      if (sticky) return;
      const linger = transient ? 1600 : Math.max(LINGER_MS, 2400 + shown.length * LINGER_MS_PER_CHAR);
      this.#restTimer = window.setTimeout(() => this.#rest(), linger);
    };

    if (typingMs === 0) {
      finish();
      return;
    }
    let count = 0;
    typed.textContent = '';
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

  /** The bubble has a reserved place; a line that would not fit it is set smaller, a size at a time. */
  #fit() {
    const place = this.#bubble.parentElement;
    const room = place?.clientHeight ?? 0;
    const box = this.#text.parentElement;
    this.#card.dataset.crowded = 'false';
    if (room <= 0 || box === null || this.#bubble.dataset.kind === 'dots') return;
    // each size is measured the moment it is set: nothing in the bubble may be in transition meanwhile
    // (under reduced motion a blanket rule gives every element one, and the loop used to read stale heights)
    this.#bubble.dataset.fitting = 'true';
    let tight = 0;
    this.#bubble.dataset.tight = '0';
    while (tight < TIGHTEST && box.offsetHeight > room) {
      tight += 1;
      this.#bubble.dataset.tight = String(tight);
    }
    // still too tall at the smallest size: the line that says who he is gives the bubble its room
    // (style.css: data-crowded), and the size is chosen again for the taller place
    const id = place.nextElementSibling;
    if (box.offsetHeight > room && id !== null) {
      const more = Math.max(0, Math.round(id.getBoundingClientRect().bottom - place.getBoundingClientRect().bottom));
      this.#card.style.setProperty('--crowd', `${more}px`);
      this.#card.dataset.crowded = 'true';
      tight = 0;
      this.#bubble.dataset.tight = '0';
      while (tight < TIGHTEST && box.offsetHeight > room + more) {
        tight += 1;
        this.#bubble.dataset.tight = String(tight);
      }
    }
    void box.offsetHeight;
    delete this.#bubble.dataset.fitting;
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
  }

  #stopTyping() {
    if (this.#frame !== 0) window.cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }
}
