// What changed between two versions of the galaxy.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseData } from '../scripts/dataFile.js'
import { compareGalaxies } from '../src/lib/data/compareGalaxies.js'
import { finishGalaxy, loadPlanet, loadShop, loadSystem } from '../src/lib/data/universe.js'

/** @param {string} text */
function galaxy(text) {
  const systems = new Map()
  const planets = new Map()
  const outfitters = new Map()
  for (const node of parseData(text)) {
    if (node.tokens[0] === 'system') loadSystem(systems, node)
    else if (node.tokens[0] === 'planet') loadPlanet(planets, node)
    else if (node.tokens[0] === 'outfitter') loadShop(outfitters, node)
  }
  return { ...finishGalaxy(systems.values(), planets.values()), governments: {}, outfitters: Object.fromEntries(outfitters), shipyards: {} }
}

const before = galaxy(`system Same
system Gone
	link Same
system Moved
	government Republic
	object Port
planet Port
	description \`Old words.\`
	outfitter Shop
system Quiet
	object Library
planet Library
	description \`Old words.\`
outfitter Shop
	Blaster
`)
const after = galaxy(`system Same
	link New
system New
	link Same
system Moved
	government "Free Worlds"
	object Port
planet Port
	description \`Old words.\`
	outfitter Shop
	outfitter Ammo
system Quiet
	object Library
planet Library
	description \`New words.\`
outfitter Shop
	Blaster
	Laser
`)
const changes = compareGalaxies(after, before)

test('finds systems added and removed, and links with them', () => {
  assert.equal(changes.systems.get('New')?.status, 'added')
  assert.equal(changes.systems.get('Gone')?.status, 'removed')
  assert.deepEqual(changes.removedSystems.map(s => s.name), ['Gone'])
  assert.deepEqual(changes.addedLinks, [['New', 'Same']])
  assert.deepEqual(changes.removedLinks, [['Gone', 'Same']])
})

test('says what changed in a system and its planets', () => {
  const moved = changes.systems.get('Moved')
  assert.equal(moved?.status, 'changed')
  assert.deepEqual(moved?.changes, [
    { what: 'Government', before: 'Republic', after: 'Free Worlds' },
    { what: 'Port: services', added: ['outfitter: Ammo'], removed: [] },
  ])
})

test('tells a rewritten description from a change of substance', () => {
  assert.equal(changes.systems.get('Quiet')?.status, 'reworded')
  assert.equal(changes.systems.has('Same'), true, 'a new link changes it')
})

test('finds shops whose stock changed', () => {
  assert.deepEqual(changes.shops, [{ kind: 'outfitter', name: 'Shop', added: ['Laser'], removed: [] }])
})
