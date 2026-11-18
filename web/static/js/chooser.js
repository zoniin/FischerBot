// chooser.js - "four Fischers": the dialog in which you pick your opponent
// and your colour. A view: it is given the levels and reports a choice.
//
//   const chooser = new Chooser(root, { levels, posterUrl, onChoose, onClose });
//   chooser.open({ levelId, colour, canResume });
//   chooser.close();
//
// One click on a card starts the game: onChoose({ levelId, colour }) with
// colour 'white' | 'black' | 'random'. Escape or "Close" calls onClose().

const COLOURS = ['white', 'black', 'random'];

/** "1956 · the year of the Game of the Century" -> "the year of the Game of the Century". */
export function withoutYear(subtitle) {
  return String(subtitle ?? '').replace(/^\s*\d{4}(?:[–-]\d{2,4})?\s*·\s*/, '');
}

/** What the level's opening book covers, in a few words. */
export function bookNote(level) {
  if (level?.book?.later) return 'All his games';
  return Number.isFinite(level?.book?.year) ? `His games to ${level.book.year}` : '';
}

/** The level's strength note - only if calibration has supplied one. Never invented here. */
export function strengthNote(level) {
  return typeof level?.strength === 'string' && level.strength.trim() !== '' ? level.strength.trim() : '';
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Chooser {
  #root;
  #dialog;
  #list;
  #radios;
  #close;
  #levels;
  #onChoose;
  #onClose;
  #colour = 'white';
  #returnFocus = null;

  constructor(root, { levels, posterUrl, onChoose, onClose }) {
    this.#root = root;
    this.#dialog = root.querySelector('[role="dialog"]');
    this.#list = root.querySelector('#levels');
    this.#radios = [...root.querySelectorAll('[role="radio"]')];
    this.#close = root.querySelector('#chooser-close');
    this.#levels = levels;
    this.#onChoose = onChoose;
    this.#onClose = onClose;

    levels.forEach((level, index) => this.#list.append(this.#card(level, index, posterUrl)));

    this.#list.addEventListener('click', event => {
      const card = event.target.closest('.level');
      if (card !== null) this.#onChoose({ levelId: card.dataset.level, colour: this.#colour });
    });
    for (const radio of this.#radios) {
      radio.addEventListener('click', () => this.#setColour(radio.dataset.colour, false));
      radio.addEventListener('keydown', event => this.#radioKey(event));
    }
    this.#close.addEventListener('click', () => this.#onClose());
    // a click on the veil itself (not on the dialog) closes too
    root.addEventListener('pointerdown', event => {
      if (event.target === root) this.#onClose();
    });
  }

  get isOpen() {
    return !this.#root.hidden;
  }

  get colour() {
    return this.#colour;
  }

  open({ levelId = null, colour = 'white', canResume = false } = {}) {
    this.#setColour(COLOURS.includes(colour) ? colour : 'white', false);
    this.#close.textContent = canResume ? 'Back to the game' : 'Close';
    let target = null;
    for (const card of this.#list.querySelectorAll('.level')) {
      const last = card.dataset.level === levelId;
      card.dataset.last = String(last);
      if (last) target = card;
    }
    if (!this.isOpen) this.#returnFocus = document.activeElement;
    this.#root.hidden = false;
    this.#root.scrollTop = 0;
    (target ?? this.#list.querySelector('.level') ?? this.#dialog).focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.#root.hidden = true;
    const back = this.#returnFocus;
    this.#returnFocus = null;
    if (back !== null && typeof back.focus === 'function' && document.contains(back)) back.focus({ preventScroll: true });
  }

  #card(level, index, posterUrl) {
    const item = element('li');
    const card = element('button', 'level');
    card.type = 'button';
    card.dataset.level = level.id;
    card.dataset.rank = String(index + 1);

    const art = element('span', 'level-art');
    const img = element('img');
    img.src = posterUrl;
    img.alt = '';
    img.width = 400;
    img.height = 400;
    img.decoding = 'async';
    const pips = element('span', 'level-pips');
    pips.setAttribute('aria-hidden', 'true');
    this.#levels.forEach((_, i) => pips.append(element('i', i <= index ? 'on' : '')));
    art.append(img, element('span', 'level-year', String(level.year)), pips);

    const body = element('span', 'level-body');
    body.append(
      element('span', 'level-title', level.title),
      element('span', 'level-sub', withoutYear(level.subtitle)),
      element('span', 'level-blurb', level.blurb),
    );
    const facts = element('span', 'level-facts');
    const book = bookNote(level);
    if (book !== '') facts.append(element('span', 'level-book', book));
    const strength = strengthNote(level);
    if (strength !== '') facts.append(element('span', 'level-strength', strength));
    body.append(facts, element('span', 'level-cta', 'Play him'));

    card.append(art, body);
    item.append(card);
    return item;
  }

  #setColour(colour, focus) {
    this.#colour = colour;
    for (const radio of this.#radios) {
      const on = radio.dataset.colour === colour;
      radio.setAttribute('aria-checked', String(on));
      radio.tabIndex = on ? 0 : -1;
      if (on && focus) radio.focus();
    }
  }

  #radioKey(event) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const index = COLOURS.indexOf(this.#colour);
    this.#setColour(COLOURS[(index + step + COLOURS.length) % COLOURS.length], true);
  }
}
