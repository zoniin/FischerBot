// The stylesheet and the page: the rules the final re-test found missing, kept from coming back.
// (What they look like is checked in a browser; these only make sure the rules are still there.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const style = read('static/css/style.css');
const boardCss = read('static/css/board.css');
const page = read('index.html');

/** The body of the first rule whose selector is exactly `selector`. */
function rule(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

test('the trays of captured pieces are never clipped', () => {
  const caps = rule(style, '.strip-caps');
  assert.match(caps, /flex:\s*none/);
  assert.doesNotMatch(caps, /overflow:\s*hidden/);
  assert.doesNotMatch(rule(style, '.opp-taken'), /overflow:\s*hidden/);
  // pieces of one kind overlap: the step from one to the next is smaller than a piece
  const px = name => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(caps)[1]);
  assert.ok(px('cap-step') < px('cap') / 2);
  assert.ok(px('cap-piece') < px('cap') / 2);
  assert.ok(px('cap-kind') > px('cap-piece'));
  // fifteen pieces (eight pawns, two knights, two bishops, two rooks, a queen) in about 150 px
  assert.ok(px('cap') + 7 * px('cap-step') + 3 * px('cap-piece') + 4 * px('cap-kind') <= 150);
});

test('your strip and the controls wrap, and the strip is never narrower than what is in it', () => {
  assert.match(rule(style, '.player-bar'), /flex-wrap:\s*wrap/);
  assert.match(rule(style, '.player-bar .strip'), /flex:\s*1 0 auto/);
  assert.doesNotMatch(rule(style, '.player-bar .strip'), /min-width:\s*0/);
});

test('the controls that can be shortened carry both labels, and only one is shown', () => {
  for (const id of ['btn-new', 'btn-back']) {
    const button = new RegExp(`id="${id}"[^>]*>(.*?)</button>`).exec(page);
    assert.ok(button, id);
    assert.match(button[1], /<span class="tool-long">[^<]+<\/span><span class="tool-short">[^<]+<\/span>/);
  }
  assert.match(rule(style, '.tool-short'), /display:\s*none/);
});

test('the text of the bubble is never in transition while its size is being fitted', () => {
  assert.match(rule(style, '.bubble-text, .bubble-text *'), /transition:\s*none\s*!important/);
  assert.match(style, /\.bubble\[data-fitting\][^{]*\{\s*transition:\s*none\s*!important/);
  assert.match(read('static/js/opponent.js'), /dataset\.fitting = 'true'/);
});

test('the line that says who he is is not cut off with an ellipsis', () => {
  const meta = rule(style, '.opp-meta');
  assert.doesNotMatch(meta, /text-overflow/);
  assert.doesNotMatch(meta, /overflow:\s*hidden/);
});

test('board coordinates are never set smaller than 9.5 px', () => {
  const size = /\.cb-coord \{[^}]*font-size:\s*clamp\(([\d.]+)px/.exec(boardCss);
  assert.ok(size);
  assert.ok(Number(size[1]) >= 9.5);
});
