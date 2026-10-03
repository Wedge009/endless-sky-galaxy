// The game's data format (DataFile.cpp): tokens split by white-space, quoted
// with double quotes or back-ticks, '#' comments, and nesting by indentation.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseData } from '../scripts/dataFile.js'

test('splits tokens, keeping quoted ones whole', () => {
  const [node] = parseData('system "Alpha Centauri" `back-ticked "quote"` plain')
  assert.deepEqual(node.tokens, ['system', 'Alpha Centauri', 'back-ticked "quote"', 'plain'])
})

test('ignores comments and blank lines', () => {
  const nodes = parseData('# a comment\n\nsystem Sol # trailing\n')
  assert.equal(nodes.length, 1)
  assert.deepEqual(nodes[0].tokens, ['system', 'Sol'])
})

test('nests by indentation, tabs or spaces', () => {
  const [system] = parseData('system Sol\n\tobject Earth\n\t\tobject Luna\n\tlink Vega\n')
  assert.deepEqual(system.children.map(c => c.tokens[0]), ['object', 'link'])
  assert.deepEqual(system.children[0].children[0].tokens, ['object', 'Luna'])
})

test('records where each node came from', () => {
  const [, second] = parseData('a\nb', 'file.txt')
  assert.equal(second.file, 'file.txt')
  assert.equal(second.line, 2)
})
