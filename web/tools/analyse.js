#!/usr/bin/env node
// Engine analysis for training the style model.
//
//   node web/tools/analyse.js [--depth 10] [--nodes 150000] [--window 100] [--candidate-nodes 300000] < positions.jsonl
//
// Reads one JSON object per line: { key, fen, moves } (the game so far).
// Writes one per line: { key, best, score, depth, nodes, moves: { uci: score } }
// where `moves` holds every root move the engine scores within `window`
// centipawns of its best - the choice set the style model is trained on.
// Deterministic: the search is limited by depth and nodes, never by time.
import { createInterface } from 'node:readline';
import { Engine } from '../static/js/engine.js';

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

const depth = option('depth', 10);
const nodes = option('nodes', 150000);
const windowCp = option('window', 100);
const candidateNodes = option('candidate-nodes', 300000);

const engine = new Engine();
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const { key, fen, moves } = JSON.parse(line);
  engine.newGame();                      // every position analysed from a clean slate
  engine.setPosition(fen, moves || []);
  const result = engine.search({ timeMs: Infinity, maxDepth: depth, nodeLimit: nodes });
  const found = result.move ? engine.candidates(result, windowCp, { nodeLimit: candidateNodes }) : {};
  process.stdout.write(JSON.stringify({
    key, best: result.move, score: result.scoreCp, depth: result.depth, nodes: result.nodes, moves: found,
  }) + '\n');
}
