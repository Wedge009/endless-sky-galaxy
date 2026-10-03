// Describing a system's hazards: where, when and what.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeHazard, hazardsOf, objectKind } from '../src/lib/utils/hazards.js'

const galaxy = {
  hazards: {
    Storm: { range: [0, 10000], systemWide: true, duration: [300, 1500], constant: false, effects: true, damage: { 'ion damage': 0.5 } },
    Heat: { range: [0, 10000], systemWide: true, duration: [1, 200], constant: false, effects: false, damage: { 'relative heat damage': 0.1 } },
    Disk: { range: [0, 600], systemWide: false, duration: [1, 1], constant: true, effects: false, damage: { 'shield damage': 1, 'fuel damage': -0.5 } },
    Gravity: { range: [100, 1500], systemWide: false, duration: [1, 1], constant: true, effects: false, damage: { 'hit force': -17 } },
  },
}
const station = { name: null, sprite: 'planet/station-solar-a0', hazards: [{ name: 'Disk', period: 1 }], children: [] }
const system = { hazards: [{ name: 'Storm', period: 9000 }, { name: 'Gravity', period: 1 }], objects: [station] }

test('finds the system\'s hazards and those its objects carry', () => {
  const list = hazardsOf(system)
  assert.deepEqual(list.map(h => [h.name, h.object?.sprite ?? null]), [['Storm', null], ['Gravity', null], ['Disk', 'planet/station-solar-a0']])
})

test('weather: how often it comes, at 60 frames a second, and how long it lasts', () => {
  const about = describeHazard(galaxy, { name: 'Storm', period: 9000, object: null }, objectKind)
  assert.equal(about.where, 'throughout the system')
  assert.equal(about.when, 'on average every 3 min, for 5 s to 25 s')
  assert.deepEqual(about.effects, ['ion damage'])
  assert.equal(describeHazard(galaxy, { name: 'Heat', period: 100, object: null }, objectKind).when, 'on average every 2 s, for up to 3 s')
})

test('a fixed zone: always, within a range of its centre, with gains and pulls', () => {
  const disk = describeHazard(galaxy, { name: 'Disk', period: 1, object: station }, objectKind)
  assert.equal(disk.when, 'always')
  assert.equal(disk.where, 'within 600 of a station')
  assert.deepEqual(disk.effects, ['shield damage', 'restores fuel'])
  const gravity = describeHazard(galaxy, { name: 'Gravity', period: 1, object: null }, objectKind)
  assert.equal(gravity.where, '100–1500 from the centre')
  assert.deepEqual(gravity.effects, ['pulls ships in'])
})
