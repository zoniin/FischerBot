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

/** "Plays at about 2000" - or nothing, if the level does not say how strong it is. */
export function strengthLabel(level) {
  const note = strengthNote(level);
  return note === '' ? '' : `Plays at ${note}`;
}

/** A score inside a title ("11–0") must not break across two lines: word joiners round the dash. */
export function unbreakable(text) {
  return String(text ?? '').replace(/(\d)\s*([–-])\s*(\d)/g, '$1\u2060$2\u2060$3');
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
  #foot;
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
    this.#foot = root.querySelector('#chooser-foot');
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
    // with no game to go back to there is nothing to close to: the way out is to choose
    if (this.#foot !== null) this.#foot.hidden = !canResume;
    let target = null;
    for (const card of this.#list.querySelectorAll('.level')) {
      const last = card.dataset.level === levelId;
      card.dataset.last = String(last);
      if (last) target = card;
    }
    if (!this.isOpen) this.#returnFocus = document.activeElement;
    this.#root.hidden = false;
    this.#root.scrollTop = 0;
    // no card is singled out on arrival - unless it is the Fischer played last
    (target ?? this.#dialog).focus({ preventScroll: true });
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
    img.width = 800;
    img.height = 800;
    img.decoding = 'async';
    art.append(img, element('span', 'level-year', String(level.year)));

    const body = element('span', 'level-body');
    body.append(
      element('span', 'level-title', unbreakable(level.title)),
      element('span', 'level-sub', withoutYear(level.subtitle)),
      element('span', 'level-blurb', level.blurb),
    );
    // how strong he is: four pips (which of the four Fischers) and, if the level says, a number
    const facts = element('span', 'level-facts');
    const strength = element('span', 'level-strength');
    const pips = element('span', 'level-pips');
    pips.setAttribute('aria-hidden', 'true');
    this.#levels.forEach((_, i) => pips.append(element('i', i <= index ? 'on' : '')));
    strength.append(pips);
    const label = strengthLabel(level);
    if (label !== '') strength.append(element('span', 'level-rating', label));
    facts.append(strength);
    const book = bookNote(level);
    if (book !== '') facts.append(element('span', 'level-book', book));
    const cta = element('span', 'level-cta');
    cta.append(element('span', '', 'Play him'), element('span', 'level-arrow', '→'));
    cta.lastChild.setAttribute('aria-hidden', 'true');
    body.append(facts, cta);

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
