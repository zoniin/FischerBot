#!/usr/bin/env node
// A UCI front end for the site's engine, so it can be put in a chess GUI or
// matched against other engines.
//
//   node web/tools/uci.js
//
// Options (setoption name <Name> value <value>):
//   Level   none | prodigy | grandmaster | champion | world
//           "none" (the default) is the bare search engine, obeying the
//           limits of each "go". Any other value plays as the page does at
//           that level - opening book, search, style - with the level's own
//           limits, whatever "go" says.
//   Hash    megabytes for the transposition table (default 32)
//   Seed    a number: makes the book choices reproducible
//
// The search is synchronous, so "stop" is only seen once a move has been
// chosen; give "go" a movetime, depth or nodes limit.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Engine, ENGINE_NAME } from '../static/js/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LEVEL_NAMES = ['none', 'prodigy', 'grandmaster', 'champion', 'world'];

let hashMb = 32;
let engine = new Engine({ hashMb });
let levelName = 'none';
let seed = null;
let bot = null;                // built on demand: it needs the book and the model
let fen = START;
let moves = [];

function say(line) { process.stdout.write(line + '\n'); }

/** A small deterministic generator (mulberry32) for reproducible book choices. */
function seeded(start) {
  let a = start >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function buildBot() {
  const [{ FischerBot, LEVELS }, { Book }, { StyleModel }] = await Promise.all([
    import('../static/js/bot.js'), import('../static/js/book.js'), import('../static/js/style.js'),
  ]);
  const data = name => JSON.parse(readFileSync(path.join(HERE, '..', 'static', 'data', name), 'utf8'));
  const level = LEVELS.find(candidate => candidate.id === levelName);
  if (!level) throw new Error(`unknown level ${levelName}`);
  return new FischerBot({
    engine, level,
    book: new Book(data('book.json')),
    style: StyleModel.fromJSON(data('style.json')),
    random: seed === null ? Math.random : seeded(seed),
  });
}

function setOption(name, value) {
  switch (name.toLowerCase()) {
    case 'level':
      if (!LEVEL_NAMES.includes(value)) { say(`info string unknown level ${value}`); return; }
      levelName = value;
      bot = null;
      break;
    case 'hash':
      hashMb = Math.max(1, Number(value) || 32);
      engine = new Engine({ hashMb });
      bot = null;
      break;
    case 'seed':
      seed = value === '' || value === 'none' ? null : Number(value);
      bot = null;
      break;
    default:
      say(`info string unknown option ${name}`);
  }
}

function setPosition(words) {
  let i = 0;
  if (words[i] === 'startpos') { fen = START; i++; }
  else if (words[i] === 'fen') {
    const end = words.indexOf('moves');
    fen = words.slice(1, end < 0 ? words.length : end).join(' ');
    i = end < 0 ? words.length : end;
  }
  moves = words[i] === 'moves' ? words.slice(i + 1) : [];
}

/** Time for this move from a clock: a twentieth of what is left, plus most of the increment. */
function clockTime(args, whiteToMove) {
  const left = Number(args[whiteToMove ? 'wtime' : 'btime']);
  if (!Number.isFinite(left)) return null;
  const increment = Number(args[whiteToMove ? 'winc' : 'binc']) || 0;
  return Math.max(10, Math.min(left - 50, left / 20 + increment * 0.8));
}

async function go(words) {
  const args = {};
  for (let i = 0; i < words.length; i++) {
    if (['movetime', 'depth', 'nodes', 'wtime', 'btime', 'winc', 'binc'].includes(words[i])) args[words[i]] = words[++i];
  }
  if (levelName !== 'none') {
    if (!bot) bot = await buildBot();
    const choice = bot.choose({ fen, moves });
    if (choice.source === 'book') say(`info string book ${choice.book.game.cite}`);
    else {
      say(`info depth ${choice.depth} score cp ${choice.evalCp} nodes ${choice.nodes} time ${Math.round(choice.timeMs)} pv ${choice.pv.join(' ')}`);
      if (choice.engineSan) say(`info string style ${choice.san} instead of ${choice.engineSan}`);
    }
    say(`bestmove ${choice.uci}`);
    return;
  }
  engine.setPosition(fen, moves);
  const whiteToMove = (fen.split(' ')[1] === 'w') === (moves.length % 2 === 0);
  const limits = {};
  if (args.depth) limits.maxDepth = Number(args.depth);
  if (args.nodes) limits.nodeLimit = Number(args.nodes);
  if (args.movetime) limits.timeMs = Number(args.movetime);
  else if (clockTime(args, whiteToMove) !== null) limits.timeMs = clockTime(args, whiteToMove);
  else if (args.depth || args.nodes) limits.timeMs = Infinity;
  const result = engine.search(limits);
  if (result.move === null) { say('bestmove 0000'); return; }
  const mate = Math.abs(result.scoreCp) >= 99000
    ? `mate ${Math.sign(result.scoreCp) * Math.ceil((100000 - Math.abs(result.scoreCp)) / 2)}`
    : `cp ${result.scoreCp}`;
  say(`info depth ${result.depth} score ${mate} nodes ${result.nodes} time ${Math.round(result.timeMs)} ` +
      `nps ${Math.round(result.nodes * 1000 / Math.max(1, result.timeMs))} pv ${result.pv.join(' ')}`);
  say(`bestmove ${result.move}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const raw of lines) {
  const words = raw.trim().split(/\s+/);
  try {
    switch (words[0]) {
      case 'uci':
        say(`id name ${ENGINE_NAME}`);
        say('id author FischerBot');
        say(`option name Level type combo default none ${LEVEL_NAMES.map(name => `var ${name}`).join(' ')}`);
        say('option name Hash type spin default 32 min 1 max 1024');
        say('option name Seed type string default none');
        say('uciok');
        break;
      case 'isready': say('readyok'); break;
      case 'setoption': {
        const at = words.indexOf('value');
        setOption(words.slice(2, at < 0 ? words.length : at).join(' '), at < 0 ? '' : words.slice(at + 1).join(' '));
        break;
      }
      case 'ucinewgame':
        engine.newGame();
        if (bot) bot.newGame();
        break;
      case 'position': setPosition(words.slice(1)); break;
      case 'go': await go(words.slice(1)); break;
      case 'quit': process.exit(0);
      default: break;      // "stop", "ponderhit" and unknown commands are ignored
    }
  } catch (error) {
    say(`info string error ${error.message}`);
    if (words[0] === 'go') say('bestmove 0000');
  }
}
