// Loading systems, planets and shops as the game does (System::Load,
// Planet::Load, Shop<Item>::Load), and applying event changes.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseData } from '../scripts/dataFile.js'
import { applyChange, finishGalaxy, loadPlanet, loadShop, loadSystem } from '../src/lib/data/universe.js'

/** Load every system, planet and shop in some data text. @param {string} text */
function load(text) {
  const universe = { systems: new Map(), planets: new Map(), outfitters: new Map(), shipyards: new Map() }
  for (const node of parseData(text)) {
    if (node.tokens[0] === 'system') loadSystem(universe.systems, node)
    else if (node.tokens[0] === 'planet') loadPlanet(universe.planets, node)
    else if (node.tokens[0] === 'outfitter') loadShop(universe.outfitters, node)
  }
  return universe
}

test('a key given again without "add" replaces its earlier values', () => {
  const { systems } = load('system A\n\tlink B\n\tlink C\n\tattributes x\nsystem A\n\tlink D\n')
  const a = systems.get('A')
  assert.deepEqual(a.links, ['D'])
  // Keys the second definition leaves out are kept.
  assert.deepEqual(a.attributes, ['x'])
})

test('"add" appends and "remove" deletes', () => {
  const { systems } = load('system A\n\tlink B\n\tlink C\nsystem A\n\tadd link D\n\tremove link B\n')
  assert.deepEqual(systems.get('A').links, ['C', 'D'])
})

test('"remove" alone clears a key, and flags can be removed', () => {
  const { systems } = load('system A\n\tlink B\n\thidden\nsystem A\n\tremove link\n\tremove hidden\n')
  assert.deepEqual(systems.get('A').links, [])
  assert.equal(systems.get('A').hidden, false)
})

test('reads stellar objects, with "add object" keeping its name', () => {
  const { systems } = load('system A\n\tobject\n\t\tsprite star/g0\n\tobject Earth\n\t\tsprite planet/earth\n\t\tdistance 900\n\t\tperiod 365\n\t\toffset 90\n\t\tobject Luna\n\t\t\tsprite planet/luna\nsystem A\n\tadd object Mars\n\t\tsprite planet/mars\n')
  const [star, earth, mars] = systems.get('A').objects
  assert.equal(star.name, null)
  assert.deepEqual([earth.name, earth.distance, earth.period, earth.offset], ['Earth', 900, 365, 90])
  assert.equal(earth.children[0].name, 'Luna')
  assert.equal(mars.name, 'Mars')
})

test('"remove object" matches by sprite, distance and offset, not by name', () => {
  const text = 'system A\n\tobject\n\t\tsprite planet/rock\n\t\tdistance 100\n\tobject\n\t\tsprite planet/rock\n\t\tdistance 200\n'
    + 'system A\n\tremove object\n\t\tsprite planet/rock\n\t\tdistance 200\n'
  assert.deepEqual(load(text).systems.get('A').objects.map((/** @type {any} */ o) => o.distance), [100])
})

test('planets list each shop once, as the game keeps them in a set', () => {
  const { planets } = load('planet P\n\toutfitter Basic\nplanet P\n\tadd outfitter Basic\n\tadd outfitter Extra\n')
  assert.deepEqual(planets.get('P').outfitters, ['Basic', 'Extra'])
})

test('shops: items, "add", "remove", "clear" and a "stock" block', () => {
  const { outfitters } = load('outfitter S\n\tA\n\tB\noutfitter S\n\tadd C\n\tremove A\n')
  assert.deepEqual(outfitters.get('S').items, ['B', 'C'])
  const cleared = load('outfitter S\n\tA\noutfitter S\n\tclear\n\tD\n').outfitters.get('S')
  assert.deepEqual(cleared.items, ['D'])
  const stocked = load('outfitter S\n\tstock\n\t\tA\noutfitter S\n\tstock\n\t\tB\n').outfitters.get('S')
  assert.deepEqual(stocked.items, ['B'])
})

test('shops sold by location are marked, with their filter', () => {
  const shop = load('outfitter "Torpedo Restock"\n\tto sell\n\t\thas x\n\tlocation\n\t\tattributes outfitter\n\tstock\n\t\tTorpedo\n').outfitters.get('Torpedo Restock')
  assert.equal(shop.anywhere, true)
  assert.deepEqual(shop.location, [['attributes', 'outfitter']])
  assert.deepEqual(shop.items, ['Torpedo'])
})

test('"link" and "unlink" in an event change both ends', () => {
  const universe = load('system A\nsystem B\n')
  applyChange(universe, parseData('link A B')[0])
  assert.deepEqual([universe.systems.get('A').links, universe.systems.get('B').links], [['B'], ['A']])
  applyChange(universe, parseData('unlink B A')[0])
  assert.deepEqual([universe.systems.get('A').links, universe.systems.get('B').links], [[], []])
})

test('finishing lists each link once and finds each planet\'s system', () => {
  const { systems, planets } = load('system A\n\tlink B\n\tobject Home\nsystem B\n\tlink A\nplanet Home\n\tspaceport `Busy.`\n')
  const galaxy = finishGalaxy(systems.values(), planets.values())
  assert.deepEqual(galaxy.links, [['A', 'B']])
  assert.equal(galaxy.planets[0].system, 'A')
  assert.equal(galaxy.planets[0].inhabited, true)
})

test('only list-like keys are replaced by a second definition; others add to it', () => {
  const { systems } = load('system A\n\ttrade Food 100\n\ttrade Metal 200\nsystem A\n\ttrade Food 150\n')
  assert.deepEqual(systems.get('A').trade, { Food: 150, Metal: 200 })
  const { planets } = load('planet P\n\tshipyard One\n\tattributes a\nplanet P\n\tshipyard Two\n\tattributes b\n')
  assert.deepEqual(planets.get('P').shipyards, ['One', 'Two'])
  assert.deepEqual(planets.get('P').attributes, ['b'])
})

test("a planet's port and spaceport are replaced together", () => {
  const { planets } = load('planet P\n\tspaceport `Old.`\nplanet P\n\tport\n\t\tservices trading\n')
  assert.deepEqual(planets.get('P').spaceport, [])
  assert.deepEqual(planets.get('P').port.services, ['trading'])
})

test('"remove object" with nothing beneath it removes them all', () => {
  const { systems } = load('system A\n\tobject\n\t\tsprite star/g0\n\tobject Earth\nsystem A\n\tremove object\n')
  assert.deepEqual(systems.get('A').objects, [])
})
