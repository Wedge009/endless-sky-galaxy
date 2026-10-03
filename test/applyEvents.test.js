// Choosing the events to apply, and applying them on top of the base state.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseData } from '../scripts/dataFile.js'
import { applyEvents, eventsToApply } from '../src/lib/data/applyEvents.js'
import { finishGalaxy, loadPlanet, loadSystem } from '../src/lib/data/universe.js'

const systems = new Map()
const planets = new Map()
for (const node of parseData('system A\n\tgovernment Old\n\tobject Home\nsystem B\nplanet Home\n\tdescription `Quiet.`\n')) {
  if (node.tokens[0] === 'system') loadSystem(systems, node)
  else loadPlanet(planets, node)
}
const changes = (/** @type {string} */ text) => parseData(text).map(function bare(n) { return { tokens: n.tokens, children: n.children.map(bare) } })
const galaxy = {
  ...finishGalaxy(systems.values(), planets.values()),
  outfitters: {},
  shipyards: {},
  choices: [{ key: 'War', default: 'win', options: [{ id: 'win', events: ['won'] }, { id: 'lose', events: ['lost'] }], under: [] }],
  events: {
    'first': { status: 'assumed', order: 0, choices: [], changes: changes('system A\n\tgovernment New\n') },
    'won': { status: 'choice', order: 1, choices: [{ choice: 'War', option: 'win' }], changes: changes('link A B\n') },
    'lost': { status: 'choice', order: 2, choices: [{ choice: 'War', option: 'lose' }], changes: changes('planet Home\n\tadd attributes ruined\n') },
    'never': { status: 'never', order: 3, choices: [], changes: changes('system A\n\tgovernment Nobody\n') },
  },
}

test('applies assumed events and those of each chosen option, in order', () => {
  assert.deepEqual(eventsToApply(galaxy, {}), ['first', 'won'])
  assert.deepEqual(eventsToApply(galaxy, { War: 'lose' }), ['first', 'lost'])
})

test('changes the galaxy, leaving the base state as it was', () => {
  const after = applyEvents(galaxy, eventsToApply(galaxy, {}))
  assert.equal(after.systems.find((/** @type {any} */ s) => s.name === 'A').government, 'New')
  assert.deepEqual(after.links, [['A', 'B']])
  assert.equal(galaxy.systems.find((/** @type {any} */ s) => s.name === 'A').government, 'Old')
  assert.deepEqual(galaxy.links, [])
})

test('notes which events changed each system, through its planets too', () => {
  const after = applyEvents(galaxy, eventsToApply(galaxy, { War: 'lose' }))
  assert.deepEqual([...after.changedBy.get('A')], ['first', 'lost'])
  assert.equal(after.changedBy.has('B'), false)
})
