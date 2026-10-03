// How the game reads a sprite's file name (ImageFileData.cpp).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseImageFile } from '../scripts/sprites.js'

test('a trailing number without a blend mark is part of the name', () => {
  assert.equal(parseImageFile('g0.png')?.name, 'g0')
  assert.equal(parseImageFile('dust7.png')?.name, 'dust7')
})

test('a blend mark alone sets the blending, as frame 0', () => {
  assert.deepEqual(parseImageFile('core+.png'), { name: 'core', ext: 'png', is2x: false, blend: '+', frame: 0 })
})

test('a blend mark before a number makes it a frame', () => {
  assert.deepEqual(parseImageFile('flare+3.png'), { name: 'flare', ext: 'png', is2x: false, blend: '+', frame: 3 })
  assert.deepEqual(parseImageFile('ship-12.png'), { name: 'ship', ext: 'png', is2x: false, blend: '-', frame: 12 })
})

test('reads high-DPI variants and skips swizzle masks', () => {
  assert.equal(parseImageFile('earth@2x.png')?.is2x, true)
  assert.equal(parseImageFile('earth@1x.png')?.name, 'earth')
  assert.equal(parseImageFile('ship@sw.png'), null)
})

test('keeps a hyphenated name, and ignores what is not an image', () => {
  assert.equal(parseImageFile('gas7-b.png')?.name, 'gas7-b')
  assert.equal(parseImageFile('notes.txt'), null)
})
