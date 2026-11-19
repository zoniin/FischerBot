// app.js - the game controller. All state lives here, in `game`.
//
// The other modules know nothing about each other:
//   board.js          draws a position and reports the move the user made
//   engine-client.js  asks Fischer (the worker, or silently the server) for his move
//   events.js         turns what happened into events; commentary.js picks his line
//   opponent.js       the speech bubble beside his portrait
//   chooser.js        the "four Fischers" dialog
//   sound.js, pgn.js  what they say
//
// Debug hooks, harmless in production: ?fen=<FEN> and/or ?moves=e2e4,e7e5 start
// a game from that position (with ?level=<id> and ?color=white|black), and
// <body> carries data-phase / data-ply / data-engine for tests to wait on.

import { Position, Move, STARTING_FEN, WHITE, BLACK } from './rules.js';
import { LEVELS } from './bot.js';
import { Board } from './board.js';
import { Commentator, gameVariables } from './commentary.js';
import {
  eventsForBotMove, moveFacts, newMemory, cleanMemory, outcomeOf, gameOverCategory, capturedMaterial,
  isMateFor, isMateAgainst, mateMoves,
} from './events.js';
import { buildPgn, resultText } from './pgn.js';
import { EngineClient } from './engine-client.js';
import { Sound } from './sound.js';
import { Opponent, attribution, typographic } from './opponent.js';
import { Chooser, bookNote, strengthLabel, unbreakable, withoutYear } from './chooser.js';

const STORE_GAME = 'fischerbot.game.v3';
const SAVE_VERSION = 1;
const STORE_PREFS = 'fischerbot.prefs.v3';
const PIECE_LETTERS = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
const PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const NBSP = String.fromCharCode(160);   // a space that does not break (kept visible in the source)
const VERDICT_MARKS = { blunder: '??', mistake: '?', inaccuracy: '?!', good: '!' };
const VERDICT_WORDS = { blunder: 'blunder', mistake: 'mistake', inaccuracy: 'inaccuracy', good: 'good move' };
// what to tell the player when neither the engine in the browser nor the server produced a move
const FAILURES = {
  unreachable: 'The engine in your browser gave no answer, and the server could not be reached. Check your connection, then try again.',
  server: 'The engine in your browser gave no answer, and the server answered with an error.',
  move: 'Neither the engine in your browser nor the server came back with a move that can be played.',
  position: 'The engine in your browser gave no answer, and the server only plays games from the usual starting position.',
  internal: 'Something went wrong on this page while his move was being played.',
};
const REASONS = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  repetition: 'Threefold repetition',
  fifty: 'Fifty-move rule',
  insufficient: 'Insufficient material',
};
const IDLE_MS = 90000;
const DOTS_AFTER_MS = 900;
const MUTTER_AFTER_MS = 2100;
const REPLY_MIN_MS = 450;          // he never answers before your piece has landed
const OPENING_MIN_MS = 1500;       // ... and lets his greeting be read before 1.e4

const $ = id => document.getElementById(id);
const pieceUrl = code => `/static/img/pieces/${code}.svg`;
const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));
const levelById = id => LEVELS.find(level => level.id === id) ?? null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const game = {
  active: false,
  level: null,
  human: WHITE,
  colourPref: 'white',
  startFen: STARTING_FEN,
  start: new Position(),
  position: new Position(),
  moves: [],            // UCI
  sans: [],
  records: [],          // per ply: { by: 'you' | 'fischer', ... }
  memory: newMemory(),  // what the commentary remembers (events.js)
  outcome: null,
  lastLine: null,       // the last thing he said (shown again after a reload)
  lastWord: null,       // his line at the end of the game
  thinking: false,
  thinkingShown: false,
  failed: false,
  token: 0,             // answers to older questions are ignored
  view: null,           // ply being looked at in review; null = the game itself
  flipped: false,
  nudged: false,
};

let prefs = { sound: true, colour: 'white', levelId: null, seen: [] };
let commentator = new Commentator(null);
let shownPly = -1;
let boardKey = '';
let thinkTimers = [];
let idleTimer = 0;
let endTimer = 0;
let noteTimer = 0;

const els = {};
let board, opponent, chooser, client, sound;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function readStore(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode, quota: the game simply is not remembered
  }
}

function loadPrefs() {
  const saved = readStore(STORE_PREFS);
  if (saved === null || typeof saved !== 'object') return;
  prefs = {
    sound: saved.sound !== false,
    colour: ['white', 'black', 'random'].includes(saved.colour) ? saved.colour : 'white',
    levelId: levelById(saved.levelId) ? saved.levelId : null,
    seen: Array.isArray(saved.seen) ? saved.seen.filter(id => levelById(id) !== null) : [],
  };
}

function save() {
  writeStore(STORE_PREFS, prefs);
  if (!game.active) {
    writeStore(STORE_GAME, null);
    return;
  }
  writeStore(STORE_GAME, {
    v: SAVE_VERSION,
    levelId: game.level.id,
    human: game.human === WHITE ? 'w' : 'b',
    colourPref: game.colourPref,
    startFen: game.startFen,
    moves: game.moves,
    records: game.records,
    memory: game.memory,
    commentator: commentator.snapshot(),
    lastLine: game.lastLine,
    lastWord: game.lastWord,
    flipped: game.flipped,
    nudged: game.nudged,
  });
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

function pushMove(move, record = {}) {
  const by = game.position.turn === game.human ? 'you' : 'fischer';
  const san = game.position.san(move);
  game.position.push(move);
  game.moves.push(move.uci());
  game.sans.push(san);
  game.records.push({ by, ...record });
  return san;
}

function standardStart() {
  return game.startFen.split(' ').slice(0, 4).join(' ') === STARTING_FEN.split(' ').slice(0, 4).join(' ');
}

/** He says a line, and the game remembers it as the last thing he said. */
function speak(line, options) {
  game.lastLine = line;
  opponent.say(line, options);
}

/** Sets up a game. `moves` (UCI) are replayed without comment (a debug hook or a restored game). */
function setUp({ level, human, colourPref = human === WHITE ? 'white' : 'black', startFen = STARTING_FEN, moves = [] }) {
  stopThinking();
  window.clearTimeout(endTimer);
  window.clearTimeout(idleTimer);
  game.token += 1;
  game.active = true;
  game.level = level;
  game.human = human;
  game.colourPref = colourPref;
  game.startFen = startFen;
  game.start = new Position(startFen);
  game.position = new Position(startFen);
  game.moves = [];
  game.sans = [];
  game.records = [];
  for (const uci of moves) pushMove(game.position.parseUci(uci));
  game.memory = newMemory();
  game.outcome = outcomeOf(game.position);
  game.lastLine = null;
  game.lastWord = null;
  game.thinking = false;
  game.failed = false;
  game.view = null;
  game.flipped = false;
  game.nudged = false;
  shownPly = -1;
  hideError();
  hideEndCard();
}

function beginGame(options, { abandoned = false } = {}) {
  setUp(options);
  const { level, human } = game;
  client.newGame();
  commentator.newGame({ year: level.year });
  opponent.silence();

  const firstTime = !prefs.seen.includes(level.id);
  let line = null;
  if (abandoned && !firstTime) line = commentator.say('new_game');
  if (line === null && firstTime) line = commentator.say(`level_${level.year}`);
  if (line === null) line = commentator.say(human === WHITE ? 'start_as_black' : 'start_as_white');
  if (firstTime) prefs.seen.push(level.id);
  prefs.levelId = level.id;

  render({ animate: false });
  if (line !== null) speak(line, { urgent: true });
  save();
  if (game.outcome !== null) conclude();
  else if (game.position.turn !== human) askFischer({ opening: game.moves.length === 0 });
  else armIdle();
}

function restoreGame() {
  const saved = readStore(STORE_GAME);
  if (saved === null || typeof saved !== 'object') return false;
  const level = levelById(saved.levelId);
  if (saved.v !== SAVE_VERSION || level === null || !Array.isArray(saved.moves) || typeof saved.startFen !== 'string') {
    writeStore(STORE_GAME, null);                  // not a game this page wrote: forget it
    return false;
  }
  try {
    setUp({
      level,
      human: saved.human === 'b' ? BLACK : WHITE,
      colourPref: saved.colourPref,
      startFen: saved.startFen,
      moves: saved.moves.filter(uci => typeof uci === 'string'),
    });
  } catch {
    game.active = false;
    writeStore(STORE_GAME, null);
    return false;
  }
  // what is read back may be anything: keep only what has the right shape
  const isLine = line => line !== null && typeof line === 'object' && typeof line.text === 'string';
  if (Array.isArray(saved.records) && saved.records.length === game.records.length) {
    game.records = saved.records.map((record, index) => {
      const kept = record !== null && typeof record === 'object' ? { ...record } : {};
      if ('memory' in kept) kept.memory = cleanMemory(kept.memory);
      return { ...kept, by: game.records[index].by };
    });
  }
  game.memory = cleanMemory(saved.memory);
  game.flipped = saved.flipped === true;
  game.nudged = saved.nudged === true;
  game.lastWord = isLine(saved.lastWord) ? saved.lastWord : null;
  commentator.restore({ ...(saved.commentator !== null && typeof saved.commentator === 'object' ? saved.commentator : {}), year: level.year });
  opponent.silence();
  if (isLine(saved.lastLine)) {
    game.lastLine = saved.lastLine;
    opponent.say(saved.lastLine, { instant: true });
  }
  render({ animate: false });
  if (game.outcome !== null) endTimer = window.setTimeout(showEndCard, 500);
  else if (game.position.turn !== game.human) askFischer();
  else armIdle();
  return true;
}

/** ?fen= / ?moves= / ?level= / ?color= : a game from a given position, for tests and for the curious. */
function gameFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('fen') && !params.has('moves') && !params.has('level')) return null;
  const level = levelById(params.get('level')) ?? levelById(prefs.levelId) ?? LEVELS[LEVELS.length - 1];
  const colour = (params.get('color') ?? params.get('colour') ?? 'white').toLowerCase();
  const startFen = params.get('fen') ?? STARTING_FEN;
  const moves = (params.get('moves') ?? '').split(/[\s,]+/).filter(Boolean);
  try {
    Position.fromMoves(moves, startFen);
  } catch {
    return null;
  }
  return { level, human: colour.startsWith('b') ? BLACK : WHITE, startFen, moves };
}

function canMove() {
  return game.active && game.outcome === null && !game.thinking && !game.failed && game.view === null
    && game.position.turn === game.human;
}

/** The board reports a legal move of the user's. */
function humanMoved(move) {
  if (!canMove() || !game.position.isLegal(move)) {
    renderBoard({ force: true });
    return;
  }
  const facts = moveFacts(game.position, move);
  pushMove(move, { facts });
  window.clearTimeout(idleTimer);
  playMoveSound(facts);
  game.outcome = outcomeOf(game.position);
  if (game.outcome !== null) {
    render();
    conclude();
    return;
  }
  askFischer();
}

function askFischer({ opening = false } = {}) {
  const token = ++game.token;
  game.thinking = true;
  game.thinkingShown = false;
  game.failed = false;
  hideError();
  stopThinkingTimers();
  thinkTimers.push(window.setTimeout(() => {
    game.thinkingShown = true;
    opponent.setThinking(true);
    opponent.dots();
    renderStatus();
  }, DOTS_AFTER_MS + (opening ? OPENING_MIN_MS : 0)));
  // more than about two seconds: he mutters instead of the bare dots (each mutter once in a game)
  thinkTimers.push(window.setTimeout(() => {
    const line = commentator.thinking();
    if (line !== null) opponent.say(line, { transient: true });
  }, MUTTER_AFTER_MS + (opening ? OPENING_MIN_MS : 0)));
  render();
  save();
  const question = { fen: game.startFen, moves: [...game.moves], level: game.level.id, timeMs: game.level.timeMs };
  Promise.all([client.move(question), sleep(opening ? OPENING_MIN_MS : REPLY_MIN_MS)]).then(
    ([result]) => {
      if (token !== game.token) return;                   // a new game or a take-back came first
      try {
        fischerMoved(result);
      } catch (error) {
        // nothing may leave the game hanging on "his move": say so, and offer another try
        console.error(error);
        fischerFailed(Object.assign(new Error(String(error?.message ?? error)), { kind: 'internal' }));
      }
    },
    error => {
      if (token === game.token) fischerFailed(error);
    },
  );
}

function stopThinkingTimers() {
  for (const timer of thinkTimers) window.clearTimeout(timer);
  thinkTimers = [];
}

function stopThinking() {
  stopThinkingTimers();
  game.thinking = false;
  game.thinkingShown = false;
  if (opponent) opponent.setThinking(false);
}

function fischerFailed(error) {
  stopThinking();
  opponent.settle();
  game.failed = true;
  const detail = String(error?.message ?? error ?? '').trim();
  const kind = Object.hasOwn(FAILURES, error?.kind) ? error.kind : 'internal';
  // the plain account, and (when it adds something) what was actually reported
  let text = FAILURES[kind];
  if (kind === 'server' && detail !== '') {
    const status = /^The server answered (\d{3})$/.exec(detail);
    text = status !== null ? `${text.slice(0, -1)} (${status[1]}).` : `${text.slice(0, -1)}: ${detail.replace(/\.$/, '')}.`;
  }
  els.errorText.textContent = text;
  els.error.dataset.kind = kind;
  els.error.title = detail;
  els.error.hidden = false;
  render();
  // the message sits on the board, where the eye is; the way out gets the focus
  if (!chooser.isOpen) els.btnRetry.focus({ preventScroll: true });
}

function hideError() {
  if (els.error) els.error.hidden = true;
}

/** The moves of a principal variation in SAN, with move numbers: "14… Nf6 15. Bg5 h6". */
function describeLine(position, pv, limit = 6) {
  const copy = position.copy();
  const parts = [];
  for (const [index, uci] of (pv ?? []).slice(0, limit).entries()) {
    try {
      const move = copy.parseUci(uci);
      const san = copy.san(move);
      if (copy.turn === WHITE) parts.push(`${copy.fullmoveNumber}.${NBSP}${san}`);
      else parts.push(index === 0 ? `${copy.fullmoveNumber}…${NBSP}${san}` : san);
      copy.push(move);
    } catch {
      break;
    }
  }
  return parts.join(' ');
}

function fischerMoved(result) {
  let move;
  try {
    move = game.position.parseUci(result.uci);
  } catch {
    fischerFailed(Object.assign(new Error(`He answered with a move that cannot be played (${result?.uci})`), { kind: 'move' }));
    return;
  }
  stopThinking();
  const ply = game.moves.length;
  const last = ply > 0 ? game.records[ply - 1] : null;
  const playerFacts = last !== null && last.by === 'you' ? last.facts ?? null : null;
  const botFacts = moveFacts(game.position, move);
  const { events, memory, verdict } = eventsForBotMove({
    result,
    memory: game.memory,
    botMove: botFacts,
    playerMove: playerFacts,
    playerUci: playerFacts !== null ? game.moves[ply - 1] : null,
    gameVariables,
    opensGame: ply === 0 && standardStart(),
  });
  const line = describeLine(game.position, result.pv);
  if (verdict !== null && last !== null) last.verdict = verdict;
  game.memory = memory;
  pushMove(move, {
    source: result.source ?? 'search',
    evalCp: Number.isFinite(result.evalCp) ? result.evalCp : null,
    depth: result.depth ?? null,
    nodes: result.nodes ?? null,
    timeMs: result.timeMs ?? null,
    line,
    engineSan: result.engineSan ?? null,
    cite: result.book?.game?.cite ?? null,
    count: result.book?.count ?? null,
    via: result.via ?? 'worker',
    memory,
  });
  playMoveSound(botFacts);
  game.outcome = outcomeOf(game.position);
  if (game.outcome !== null) {
    render();
    conclude();
    return;
  }
  const remark = commentator.pick(events, { ply });
  if (remark !== null) speak(remark);
  else opponent.settle();
  render();
  save();
  armIdle();
}

/** The game is over: his last word, the sound, and after a moment the card. */
function conclude() {
  stopThinking();
  window.clearTimeout(idleTimer);
  const category = gameOverCategory(game.outcome, game.human === WHITE ? BLACK : WHITE);
  const word = category === null ? null : commentator.say(category, {}, { ply: game.moves.length });
  game.lastWord = word;
  if (word !== null) speak(word, { urgent: true, sticky: true });
  else opponent.settle();
  window.setTimeout(() => sound.play('end'), 320);
  render();
  save();
  window.clearTimeout(endTimer);
  endTimer = window.setTimeout(showEndCard, 1500);
}

function takeBackCount() {
  if (!game.active || game.moves.length === 0) return 0;
  let index = game.moves.length - 1;
  let count = 0;
  if (game.records[index].by === 'fischer') {
    count += 1;
    index -= 1;
  }
  if (index < 0 || game.records[index].by !== 'you') return 0;
  return count + 1;
}

/** Undoes your last move, and his reply if he has made one. He has something to say about it. */
function takeBack() {
  const count = takeBackCount();
  if (count === 0) return;
  game.token += 1;                         // whatever he was thinking about no longer matters
  stopThinking();
  window.clearTimeout(endTimer);
  hideEndCard();
  hideError();
  for (let i = 0; i < count; i += 1) {
    game.position.pop();
    game.moves.pop();
    game.sans.pop();
    game.records.pop();
  }
  game.outcome = null;
  game.lastWord = null;
  game.failed = false;
  game.view = null;
  const before = [...game.records].reverse().find(record => record.by === 'fischer' && record.memory);
  game.memory = before ? cleanMemory(before.memory) : newMemory();
  const line = commentator.say('takeback', {}, { ply: game.moves.length });
  if (line !== null) speak(line, { urgent: true });
  else opponent.settle();
  render();
  save();
  if (game.position.turn !== game.human) askFischer();
  else armIdle();
}

function armIdle() {
  window.clearTimeout(idleTimer);
  if (!canMove() || game.nudged) return;
  idleTimer = window.setTimeout(() => {
    if (!canMove() || game.nudged) return;
    if (document.hidden || chooser.isOpen) {
      armIdle();                              // nobody is looking at the board: the wait starts again
      return;
    }
    const line = commentator.say('idle_nudge', {}, { ply: game.moves.length });
    game.nudged = true;
    if (line !== null) speak(line);
    save();
  }, IDLE_MS);
}

function playMoveSound(facts) {
  sound.play(facts.check ? 'check' : facts.capture ? 'capture' : 'move');
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

const viewedPly = () => game.view ?? game.moves.length;

function review(ply) {
  if (!game.active) return;
  const target = Math.max(0, Math.min(game.moves.length, ply));
  game.view = target === game.moves.length ? null : target;
  render();
}

function positionAt(ply) {
  return ply >= game.moves.length ? game.position : Position.fromMoves(game.moves.slice(0, ply), game.startFen);
}

/** "12. Nf3" / "12… Nf6" for the move at a 0-based ply index. */
function moveLabel(index) {
  const blackFirst = game.start.turn === BLACK ? 1 : 0;
  const number = game.start.fullmoveNumber + Math.floor((index + blackFirst) / 2);
  const white = (index + blackFirst) % 2 === 0;
  return `${number}${white ? '.' : '…'}${NBSP}${game.sans[index]}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function phase() {
  if (!game.active) return chooser.isOpen ? 'choosing' : 'idle';
  if (game.outcome !== null) return 'over';
  return game.position.turn === game.human ? 'yours' : 'his';
}

function render({ animate = true } = {}) {
  document.body.dataset.phase = phase();
  document.body.dataset.ply = String(game.moves.length);
  document.body.dataset.review = String(game.view !== null);
  document.body.dataset.engine = client.mode;
  renderBoard({ animate });
  renderOpponent();
  renderStatus();
  renderStrips();
  renderSheet();
  renderCite();
  renderEngine();
  renderTools();
}

function renderBoard({ animate = true, force = false } = {}) {
  const ply = viewedPly();
  const orientation = game.flipped ? !game.human : game.human;
  const interactive = canMove() ? game.human : null;
  const key = `${game.token}|${game.startFen}|${ply}|${game.moves.length}`;
  if (force || key !== boardKey) {
    const jump = Math.abs(ply - shownPly);
    const last = ply > 0 ? Move.fromUci(game.moves[ply - 1]) : null;
    board.setPosition(positionAt(ply), { lastMove: last, animate: animate && shownPly >= 0 && jump >= 1 && jump <= 2 });
    boardKey = key;
    shownPly = ply;
  }
  board.setOrientation(orientation);
  board.setInteractive(interactive);
  const [square, badge] = badgeAt(ply);
  board.setBadge(square, badge);
}

/**
 * His verdict on your move, as a badge on the square it landed on: shown on
 * that move and while his reply to it is on the board (even if the reply took
 * the piece - that is usually why it was a blunder). [square, badge] or [null, null].
 */
function badgeAt(ply) {
  for (const index of [ply - 1, ply - 2]) {
    const record = index >= 0 ? game.records[index] : undefined;
    if (!record) break;
    if (record.by !== 'you') continue;
    const glyph = VERDICT_MARKS[record.verdict];
    if (!glyph) break;
    const to = Move.fromUci(game.moves[index]).to;
    return [to, { glyph, kind: record.verdict, label: VERDICT_WORDS[record.verdict] }];
  }
  return [null, null];
}

function renderOpponent() {
  const level = game.level ?? levelById(prefs.levelId);
  if (level === null) {
    els.oppTitle.textContent = 'Four Fischers, 1956–1972';
    els.oppMeta.textContent = 'Choose the one you will face';
    els.oppYear.textContent = '';
    return;
  }
  els.opp.dataset.level = level.id;
  els.oppTitle.textContent = unbreakable(level.title);
  els.oppYear.textContent = String(level.year);
  // the year and how strong he is - the last only if the level says (never invented here);
  // where he was that year is on his card in the chooser, and in the tooltip
  els.oppMeta.textContent = [String(level.year), strengthLabel(level)].filter(Boolean).join(' · ');
  els.oppMeta.title = withoutYear(level.subtitle);
  renderMate();
}

/** "M9" on his card while he has a forced mate (in nine) - or "−M3" when he is the one being mated. */
function renderMate() {
  const ply = viewedPly();
  let cp = null;
  for (let index = ply - 1; index >= Math.max(0, ply - 2); index--) {
    const record = game.records[index];
    if (record && record.by !== 'you') { cp = Number.isFinite(record.evalCp) ? record.evalCp : null; break; }
  }
  let text = '';
  let label = '';
  // once the game is over there is nothing left to announce (the result is in the status beside it)
  const finished = game.outcome !== null && game.view === null;
  if (finished || !game.active) cp = null;
  if (cp !== null && isMateFor(cp)) { text = `M${mateMoves(cp)}`; label = `He has mate in ${mateMoves(cp)}`; }
  else if (cp !== null && isMateAgainst(cp)) { text = `\u2212M${mateMoves(cp)}`; label = `He is mated in ${mateMoves(cp)}`; }
  els.oppMate.textContent = text;
  els.oppMate.hidden = text === '';
  if (label !== '') els.oppMate.setAttribute('aria-label', label);
  els.oppMate.dataset.side = cp !== null && isMateAgainst(cp) ? 'against' : 'for';
}

function renderStatus() {
  let text;
  if (!game.active) text = 'Awaiting a challenger';
  else if (game.view !== null) text = game.view === 0 ? 'Review · the start' : `Review · ${moveLabel(game.view - 1)}`;
  else if (game.outcome !== null) text = `${REASONS[game.outcome.kind]} · ${resultText(game.outcome)}`;
  else if (game.failed) text = 'No answer';
  else if (game.position.turn === game.human) text = game.position.isCheck() ? 'Check · your move' : 'Your move';
  else text = game.thinkingShown ? 'Thinking' : 'His move';
  if (els.statusText.textContent !== text) els.statusText.textContent = text;
}

/** The pieces `color` has taken (as small images) and by how much it is ahead: nodes for a strip. */
function takenNodes(color, position) {
  const material = game.active ? capturedMaterial(game.start, position) : { lostByWhite: [], lostByBlack: [], balance: 0 };
  const taken = color === WHITE ? material.lostByBlack : material.lostByWhite;
  const lead = color === WHITE ? material.balance : -material.balance;
  const nodes = [];
  if (taken.length > 0) {
    const caps = document.createElement('span');
    caps.className = 'strip-caps';
    caps.dataset.pieces = color === WHITE ? 'black' : 'white';
    caps.setAttribute('role', 'img');
    caps.setAttribute('aria-label', `has taken: ${taken.map(type => PIECE_NAMES[type]).join(', ')}`);
    let previous = 0;
    for (const type of taken) {
      const img = document.createElement('img');
      img.src = pieceUrl(`${color === WHITE ? 'b' : 'w'}${PIECE_LETTERS[type]}`);
      img.alt = '';
      if (previous !== 0 && previous !== type) img.className = 'gap';
      previous = type;
      caps.append(img);
    }
    nodes.push(caps);
  }
  if (lead > 0) {
    const plus = document.createElement('span');
    plus.className = 'strip-plus';
    plus.textContent = `+${lead}`;
    plus.setAttribute('aria-label', `ahead by ${lead}`);
    nodes.push(plus);
  }
  return nodes;
}

/**
 * Your strip under the board, and what Fischer has taken beside his status
 * above it. The two do not change places when the board is flipped: his is
 * the one by his portrait.
 */
function renderStrips() {
  const position = positionAt(viewedPly());
  const live = game.active && game.outcome === null && game.view === null;
  const you = game.human;
  els.oppTaken.replaceChildren(...takenNodes(!you, position));

  const el = els.stripBottom;
  el.dataset.turn = String(live && position.turn === you);
  const lamp = document.createElement('span');
  lamp.className = 'lamp';
  lamp.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'strip-name';
  name.textContent = game.active ? 'You' : 'Your side';
  const nodes = [lamp, name];
  if (game.active) {
    const side = document.createElement('span');
    side.className = 'strip-side';
    side.textContent = you === WHITE ? 'White' : 'Black';
    nodes.push(side);
  }
  el.replaceChildren(...nodes, ...takenNodes(you, position));
}

function renderSheet() {
  const fischer = 'Bobby Fischer';
  els.sheetWhite.textContent = !game.active ? NBSP : game.human === WHITE ? 'You' : fischer;
  els.sheetBlack.textContent = !game.active ? NBSP : game.human === WHITE ? fischer : 'You';

  const rows = [];
  const current = viewedPly();
  const hadFocus = els.sheet.contains(document.activeElement);
  let row = null;
  let currentButton = null;
  const blackFirst = game.start.turn === BLACK;
  const startRow = number => {
    row = document.createElement('li');
    const no = document.createElement('span');
    no.className = 'move-no';
    no.textContent = `${number}.`;
    row.append(no);
    rows.push(row);
  };
  game.sans.forEach((san, index) => {
    const offset = index + (blackFirst ? 1 : 0);
    const number = game.start.fullmoveNumber + Math.floor(offset / 2);
    if (offset % 2 === 0 || row === null) {
      startRow(number);
      if (offset % 2 === 1) {
        const blank = document.createElement('span');
        blank.className = 'ply is-blank';
        blank.textContent = '…';
        row.append(blank);
      }
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ply';
    button.dataset.ply = String(index + 1);
    button.append(san);
    const verdict = game.records[index]?.verdict;
    let label = `${number}${offset % 2 === 0 ? '.' : '…'} ${san}`;
    if (verdict && VERDICT_MARKS[verdict]) {
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.dataset.verdict = verdict;
      mark.textContent = VERDICT_MARKS[verdict];
      mark.title = `By his reckoning: ${VERDICT_WORDS[verdict]}`;
      button.append(mark);
      label += `, ${VERDICT_WORDS[verdict]}`;
    }
    button.setAttribute('aria-label', label);
    // one tab stop for the whole sheet: the move being looked at (the arrow keys do the walking)
    button.tabIndex = index + 1 === current || (current === 0 && index === 0) ? 0 : -1;
    if (index + 1 === current) {
      button.setAttribute('aria-current', 'true');
      currentButton = button;
    }
    row.append(button);
  });
  if (rows.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'scoresheet-empty';
    empty.textContent = game.active ? 'No moves yet.' : 'The sheet is blank.';
    rows.push(empty);
  }
  if (game.outcome !== null) {
    const result = document.createElement('li');
    result.className = 'scoresheet-result';
    result.textContent = resultText(game.outcome);
    rows.push(result);
  }
  els.sheet.replaceChildren(...rows);
  if (hadFocus) (currentButton ?? els.sheet.querySelector('button.ply'))?.focus({ preventScroll: true });

  // keep the move being looked at in sight, without ever scrolling the page itself
  const list = els.sheet;
  if (currentButton !== null) {
    const line = currentButton.parentElement;
    const top = line.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + line.offsetHeight * 2 > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + line.offsetHeight * 2 - list.clientHeight;
    }
  } else {
    list.scrollTop = 0;
  }

  const total = game.moves.length;
  els.revFirst.disabled = els.revPrev.disabled = !game.active || current === 0;
  els.revNext.disabled = els.revLast.disabled = !game.active || current === total;
  els.revLive.hidden = game.view === null;
  els.btnPgn.disabled = !game.active || total === 0;
}

/** His latest move at or before the position on the board, with what he reported about it. */
function fischerRecord() {
  for (let index = viewedPly() - 1; index >= 0; index -= 1) {
    const record = game.records[index];
    if (record.by === 'fischer' && record.source) return { record, index };
  }
  return null;
}

function renderCite() {
  const found = game.active ? fischerRecord() : null;
  let kind = 'none';
  let label = 'His games';
  let text = game.active ? 'Nothing of his on the board yet.' : 'The book is made of his own games.';
  let note = game.level ? `Book: ${bookNote(game.level).toLowerCase()}` : NBSP;
  if (found !== null) {
    const { record, index } = found;
    if (record.source === 'book' && record.cite) {
      kind = 'book';
      label = 'From his own games';
      text = record.cite;
      note = record.count > 1 ? `One of ${record.count} games of his with this move` : 'His only game with this move';
    } else {
      let lastBook = -1;
      for (let i = index - 1; i >= 0; i -= 1) {
        if (game.records[i].by === 'fischer' && game.records[i].source === 'book') {
          lastBook = i;
          break;
        }
      }
      if (lastBook >= 0) {
        kind = 'left';
        label = 'Out of the book';
        text = 'From here he finds the moves himself.';
        note = `Last move from his games: ${moveLabel(lastBook)}`;
      } else {
        label = 'His games';
        text = 'None of his games went this way.';
        note = 'He is thinking for himself';
      }
    }
  }
  els.cite.dataset.kind = kind;
  els.citeLabel.textContent = label;
  els.citeGame.textContent = text;
  els.citeNote.textContent = note;
}

function evalText(cp) {
  if (!Number.isFinite(cp)) return '—';
  if (isMateFor(cp)) return `Mate in ${mateMoves(cp)} for him`;
  if (isMateAgainst(cp)) return `Mate in ${mateMoves(cp)} against him`;
  const pawns = (Math.abs(cp) / 100).toFixed(2);
  return `${cp > 0 ? '+' : cp < 0 ? '−' : ''}${pawns} (from his side)`;
}

function renderEngine() {
  const found = game.active ? fischerRecord() : null;
  els.engineEmpty.hidden = found !== null;
  els.engineList.hidden = found === null;
  if (found === null) return;
  const { record, index } = found;
  els.engMove.textContent = moveLabel(index);
  let source = 'Search';
  if (record.source === 'book') source = 'His own games (the opening book)';
  else if (record.source === 'search+style') {
    source = record.engineSan ? `Style: the search alone preferred ${record.engineSan}` : 'Search, then style';
  }
  els.engSource.textContent = source;
  els.engEval.textContent = record.source === 'book' ? '— (no search for a book move)' : evalText(record.evalCp);
  els.engDepth.textContent = Number.isFinite(record.depth) ? `${record.depth} plies` : '—';
  els.engPv.textContent = record.line || '—';
  const effort = [];
  if (Number.isFinite(record.nodes)) effort.push(`${record.nodes.toLocaleString('en-US')} positions`);
  if (Number.isFinite(record.timeMs)) effort.push(`${(record.timeMs / 1000).toFixed(record.timeMs < 100 ? 2 : 1)} s`);
  effort.push(record.via === 'server' ? 'on the server' : 'in your browser');
  els.engEffort.textContent = effort.join(' · ');
}

function renderTools() {
  els.btnBack.disabled = takeBackCount() === 0;
  els.btnFlip.disabled = !game.active;
  els.btnSound.setAttribute('aria-pressed', String(sound.enabled));
  els.btnSound.setAttribute('aria-label', sound.enabled ? 'Sound is on' : 'Sound is off');
}

// ---------------------------------------------------------------------------
// Dialogs: the chooser and the game-over card
// ---------------------------------------------------------------------------

function syncInert() {
  els.page.inert = chooser.isOpen || !els.endcard.hidden;
}

function openChooser() {
  hideEndCard();
  chooser.open({
    levelId: game.level?.id ?? prefs.levelId,
    colour: prefs.colour,
    canResume: game.active,
  });
  syncInert();
  document.body.dataset.phase = phase();
}

function closeChooser() {
  if (!chooser.isOpen) return;
  prefs.colour = chooser.colour;
  chooser.close();
  syncInert();
  render();
  save();
  armIdle();
}

function chosen({ levelId, colour }) {
  const level = levelById(levelId);
  if (level === null) return;
  const abandoned = game.active && game.outcome === null && game.moves.length > 0;
  prefs.colour = colour;
  chooser.close();
  syncInert();
  const human = colour === 'black' ? BLACK : colour === 'white' ? WHITE : (Math.random() < 0.5 ? WHITE : BLACK);
  beginGame({ level, human, colourPref: colour }, { abandoned });
  // the game has begun: the keyboard is at the board (not back on <body>, or on a button behind the dialog)
  $('board').querySelector('[role="grid"]')?.focus({ preventScroll: true });
}

function showEndCard() {
  if (game.outcome === null || chooser.isOpen) return;
  const { outcome } = game;
  const moveCount = Math.ceil(game.moves.length / 2);
  els.endKicker.textContent = `${REASONS[outcome.kind]} · ${moveCount} move${moveCount === 1 ? '' : 's'}`;
  els.endTitle.textContent = outcome.winner === null ? 'A draw' : outcome.winner === game.human ? 'You win' : 'Fischer wins';
  // the result alone on its line: a title such as "U.S. Champion, 11–0" beside it reads as a second score
  els.endScore.textContent = resultText(outcome);
  els.endVersus.textContent = `Against Fischer in ${game.level.year} · ${unbreakable(game.level.title)}`;
  const word = game.lastWord;
  els.endWord.hidden = word === null;
  if (word !== null) {
    const isQuote = word.quote !== null && typeof word.quote === 'object';
    els.endWord.dataset.kind = isQuote ? 'quote' : 'line';
    els.endWordText.textContent = isQuote ? `“${word.text}”` : typographic(word.text);
    els.endWordSource.textContent = isQuote ? `${attribution(word.quote)} · his own words` : 'FischerBot, not Fischer';
  }
  els.endcard.hidden = false;
  syncInert();
  els.endAgain.focus({ preventScroll: true });
}

function hideEndCard() {
  if (!els.endcard || els.endcard.hidden) return;
  els.endcard.hidden = true;
  syncInert();
}

function playAgain() {
  const colour = game.colourPref;
  const human = colour === 'black' ? BLACK : colour === 'white' ? WHITE : (Math.random() < 0.5 ? WHITE : BLACK);
  beginGame({ level: game.level, human, colourPref: colour });
}

// ---------------------------------------------------------------------------
// PGN
// ---------------------------------------------------------------------------

function currentPgn() {
  return buildPgn({
    sans: game.sans,
    humanIsWhite: game.human === WHITE,
    year: game.level?.year ?? null,
    outcome: game.outcome,
    startFen: game.startFen,
    date: new Date(),
    event: game.level ? `FischerBot: ${game.level.title}` : 'FischerBot',
    termination: game.outcome ? REASONS[game.outcome.kind].toLowerCase() : null,
  });
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the old way
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

async function copyPgn(button) {
  if (!game.active) return;
  const pgn = currentPgn();
  document.body.dataset.pgn = pgn;                 // also readable by tests and by anyone curious
  const ok = await copyText(pgn);
  const original = button.dataset.label ?? button.textContent;
  button.dataset.label = original;
  button.textContent = ok ? 'Copied' : 'Could not copy';
  els.pgnNote.textContent = ok ? 'PGN on the clipboard' : '';
  window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => {
    button.textContent = original;
    els.endPgn.textContent = els.endPgn.dataset.label ?? els.endPgn.textContent;
    els.btnPgn.textContent = els.btnPgn.dataset.label ?? els.btnPgn.textContent;
    els.pgnNote.textContent = '';
  }, 2200);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function onKey(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'Escape') {
    if (chooser.isOpen) closeChooser();
    else if (!els.endcard.hidden) hideEndCard();
    else if (game.view !== null) review(game.moves.length);
    else return;
    event.preventDefault();
    return;
  }
  if (chooser.isOpen || !els.endcard.hidden || !game.active) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target !== null && target.closest('.cb, input, textarea, select, [role="radio"], [contenteditable]')) return;
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (step !== undefined) {
    review(viewedPly() + step);
    event.preventDefault();
  } else if (event.key === 'Home') {
    review(0);
    event.preventDefault();
  } else if (event.key === 'End') {
    review(game.moves.length);
    event.preventDefault();
  }
}

function wire() {
  Object.assign(els, {
    page: $('page'), status: $('status'), statusText: $('status-text'),
    opp: $('opp'), oppTitle: $('opp-title'), oppMeta: $('opp-meta'), oppMate: $('opp-mate'),
    oppYear: $('opp-year'), oppTaken: $('opp-taken'), boardFrame: $('board-frame'),
    review: $('review'), reviewSteps: $('review-steps'), reviewDock: $('review-dock'),
    cite: $('cite'), citeLabel: $('cite-label'), citeGame: $('cite-game'), citeNote: $('cite-note'),
    stripBottom: $('strip-bottom'),
    btnNew: $('btn-new'), btnBack: $('btn-back'), btnFlip: $('btn-flip'), btnSound: $('btn-sound'),
    error: $('error'), errorText: $('error-text'), btnRetry: $('btn-retry'),
    sheet: $('scoresheet'), sheetWhite: $('sheet-white'), sheetBlack: $('sheet-black'),
    revFirst: $('rev-first'), revPrev: $('rev-prev'), revNext: $('rev-next'), revLast: $('rev-last'), revLive: $('rev-live'),
    btnPgn: $('btn-pgn'), pgnNote: $('pgn-note'),
    engineToggle: $('engine-toggle'), engineBody: $('engine-body'), engineEmpty: $('engine-empty'), engineList: $('engine-list'),
    engMove: $('eng-move'), engSource: $('eng-source'), engEval: $('eng-eval'), engDepth: $('eng-depth'),
    engPv: $('eng-pv'), engEffort: $('eng-effort'),
    endcard: $('endcard'), endKicker: $('end-kicker'), endTitle: $('end-title'), endScore: $('end-score'), endVersus: $('end-versus'),
    endWord: $('end-word'), endWordText: $('end-word-text'), endWordSource: $('end-word-source'),
    endAgain: $('end-again'), endNew: $('end-new'), endPgn: $('end-pgn'), endClose: $('end-close'),
  });

  els.btnNew.addEventListener('click', openChooser);
  els.btnBack.addEventListener('click', takeBack);
  els.btnFlip.addEventListener('click', () => {
    game.flipped = !game.flipped;
    render({ animate: false });
    save();
  });
  els.btnSound.addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    prefs.sound = sound.enabled;
    renderTools();
    save();
    sound.play('move');
  });
  els.btnRetry.addEventListener('click', () => {
    if (!game.active || game.outcome !== null || game.position.turn === game.human) return;
    $('board').querySelector('[role="grid"]')?.focus({ preventScroll: true });   // the button is about to go
    askFischer();
  });

  // one column (and a phone on its side): the scoresheet is under the board, out of sight, so the
  // arrows that step through the game sit directly under the board instead of under the sheet
  const narrow = window.matchMedia('(max-width: 999px)');
  const dockReview = () => (narrow.matches ? els.reviewDock : els.review).prepend(els.reviewSteps);
  narrow.addEventListener('change', dockReview);
  dockReview();

  els.sheet.addEventListener('click', event => {
    const button = event.target.closest('button.ply');
    if (button === null) return;
    review(Number(button.dataset.ply));
    if (narrow.matches) {
      // ... and a move chosen from the sheet brings the board it changed back into view
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      els.boardFrame.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    }
  });
  els.revFirst.addEventListener('click', () => review(0));
  els.revPrev.addEventListener('click', () => review(viewedPly() - 1));
  els.revNext.addEventListener('click', () => review(viewedPly() + 1));
  els.revLast.addEventListener('click', () => review(game.moves.length));
  els.revLive.addEventListener('click', () => review(game.moves.length));
  els.btnPgn.addEventListener('click', () => copyPgn(els.btnPgn));

  els.engineToggle.addEventListener('click', () => {
    const open = els.engineToggle.getAttribute('aria-expanded') !== 'true';
    els.engineToggle.setAttribute('aria-expanded', String(open));
    els.engineBody.hidden = !open;
  });

  els.endAgain.addEventListener('click', playAgain);
  els.endNew.addEventListener('click', openChooser);
  els.endPgn.addEventListener('click', () => copyPgn(els.endPgn));
  els.endClose.addEventListener('click', hideEndCard);
  els.endcard.addEventListener('pointerdown', event => {
    if (event.target === els.endcard) hideEndCard();
  });

  document.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', () => {
    if (game.active) save();
  });
}

async function boot() {
  loadPrefs();
  wire();
  sound = new Sound({ enabled: prefs.sound });
  client = new EngineClient({
    onMode: mode => {
      document.body.dataset.engine = mode;
    },
  });
  client.start();                                   // the book is a large file: start fetching it now
  opponent = new Opponent({
    card: $('opp'), bubble: $('bubble'),
    said: $('bubble-said'), text: $('bubble-text'), source: $('bubble-source'),
  });
  chooser = new Chooser($('chooser'), {
    levels: LEVELS,
    posterUrl: '/static/img/fischer-wide.webp',
    onChoose: chosen,
    onClose: closeChooser,
  });
  board = new Board($('board'), { pieceUrl, onMove: humanMoved });
  render({ animate: false });

  const commentary = await fetch('/static/data/commentary.json')
    .then(response => (response.ok ? response.json() : null)).catch(() => null);
  commentator = new Commentator(commentary);

  // ?debug: a handle for tests and tinkering (nothing depends on it)
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.fischerbot = { game, say: (line, options) => opponent.say(line, { urgent: true, ...options }) };
  }

  const fromQuery = gameFromQuery();
  if (fromQuery !== null) beginGame(fromQuery);
  else if (!restoreGame()) openChooser();
  document.body.dataset.ready = 'true';
}

boot();
