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

test('the chooser: the whole head is in every card, and no sentence is shown cut', () => {
  // four in a row: the picture is drawn smaller rather than cropped below 500 of its 800 rows (hair 115, chin 580)
  const at = style.indexOf('@supports (width: 1cqw)');
  assert.notEqual(at, -1);
  const block = style.slice(at, style.indexOf('@media (max-width: 1099px)', at));
  assert.match(block, /\.level-art \{[^}]*container-type:\s*size/);
  assert.match(block, /--pic:\s*min\(100cqw, 160cqh\)/);
  assert.match(block, /width:\s*var\(--pic\);\s*height:\s*var\(--pic\)/);
  // which rows show, from the two numbers of the rule: top = b * place - a * picture
  const top = /top:\s*calc\(([\d.]+)cqh - ([\d.]+) \* var\(--pic\)\)/.exec(block);
  assert.ok(top);
  const [b, a] = [Number(top[1]) / 100, Number(top[2])];
  for (const [width, height] of [[285, 228], [285, 194], [285, 164], [250, 200], [250, 164], [285, 100], [250, 100]]) {
    const picture = Math.min(width, 1.6 * height);
    const first = (a * picture - b * height) / picture * 800;
    const last = first + height / picture * 800;
    assert.ok(first <= 105 && first >= 0, `${width}x${height}: the first row shown is ${first.toFixed(0)}`);
    assert.ok(last >= 590 && last <= 800, `${width}x${height}: the last row shown is ${last.toFixed(0)}`);
  }
  // nothing in a card is clamped to a number of lines
  assert.doesNotMatch(style, /\.level[^{]*\{[^}]*line-clamp/);
  assert.match(rule(style, '.chooser-colour .kicker'), /white-space:\s*nowrap/);
});

test('a short phone, looking back: "Back to the game" stands beside the arrows and the controls keep their place', () => {
  // the words are joined in pairs, so that the button can be set on two lines and never on four
  assert.match(page, /id="rev-live" hidden>Back&nbsp;to the&nbsp;game<\/button>/);
  const at = style.indexOf('@media (max-width: 520px) and (max-height: 720px)');
  assert.notEqual(at, -1);
  const tier = style.slice(at, style.indexOf('\n}\n', at));
  assert.match(tier, /\.player-bar \{ --live-beside: 1; \}/);
  assert.match(tier, /\.player-bar > \.review-live \{[^}]*flex:\s*none;[^}]*width:\s*min-content;[^}]*white-space:\s*normal/);
  assert.match(tier, /\.player-bar\[data-live="row"\] > \.review-live \{[^}]*flex:\s*1 1 100%/);
  const app = read('static/js/app.js');
  assert.match(app, /getPropertyValue\('--live-beside'\)/);
  assert.match(app, /bar\.dataset\.live = 'row'/);
});

test('the scoresheet keeps the current move in sight when its own size changes, not only when a move is written', () => {
  const app = read('static/js/app.js');
  assert.match(app, /new ResizeObserver\(keepMoveInSight\)\.observe\(els\.sheet\)/);
  assert.match(app, /fitBar\(\);\n  keepMoveInSight\(\);/);
});

test('a game opened from a link is not saved until the visitor has moved in it', () => {
  const app = read('static/js/app.js');
  assert.match(app, /if \(game\.provisional\) return;[^\n]*\n  if \(!game\.active\) \{\n    writeStore\(STORE_GAME, null\)/);
  assert.match(app, /beginGame\(fromQuery, \{ provisional: true \}\)/);
});
