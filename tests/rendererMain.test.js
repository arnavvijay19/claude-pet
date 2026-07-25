'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawFrame } = require('../src/renderer/renderer-main.js');

test('draws the selected sprite-sheet frame into the transparent pet canvas', () => {
  const calls = [];
  const context = {
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
  };
  const image = {};
  drawFrame(context, image, { frameWidth: 192, frameHeight: 208 }, { row: 1, column: 2 });
  assert.deepEqual(calls, [
    ['clearRect', 0, 0, 192, 208],
    ['drawImage', image, 384, 208, 192, 208, 0, 0, 192, 208],
  ]);
});
