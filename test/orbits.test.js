// Placing a system's objects on a date (System::SetDate), with periods worked
// out from masses where the data gives none (System::FinishLoading).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dateFromDays, daysSinceEpoch, orbitsOf, positionsOn } from '../src/lib/data/orbits.js'

test('counts days as Date::DaysSinceEpoch does', () => {
  assert.equal(daysSinceEpoch(1, 1, 1), 1)
  assert.equal(daysSinceEpoch(1, 3, 2000) - daysSinceEpoch(28, 2, 2000), 2, '2000 is a leap year')
  assert.equal(daysSinceEpoch(1, 3, 2100) - daysSinceEpoch(28, 2, 2100), 1, '2100 is not')
  assert.equal(daysSinceEpoch(16, 11, 3013), 1100430)
})

test('turns a day count back into a date', () => {
  for (const date of [[1, 1, 1], [29, 2, 2000], [31, 12, 3013], [16, 11, 3013]])
    assert.deepEqual(dateFromDays(daysSinceEpoch(date[0], date[1], date[2])), date)
})

/** @param {any} props */
const object = props => ({ name: null, sprite: null, distance: 0, period: 0, offset: 0, children: [], ...props })

test('uses a period the data gives', () => {
  const [, planet] = orbitsOf({ objects: [object({ sprite: 'star/g0' }), object({ distance: 100, period: 40 })] }, {})
  assert.equal(planet.speed, 360 / 40)
})

test('works a planet\'s period out from the stars\' mass', () => {
  const stars = { 'star/g0': { mass: 1000 } }
  const [, planet] = orbitsOf({ objects: [object({ sprite: 'star/g0' }), object({ distance: 100 })] }, stars)
  assert.ok(Math.abs(planet.speed - 360 / Math.sqrt(100 ** 3 / 1000)) < 1e-9)
})

test('works a moon\'s period out from its planet\'s mass, so moons orbit independently', () => {
  const stars = { 'star/g0': { mass: 1000 }, 'planet/gas': { mass: 400 } }
  const moons = [object({ distance: 200 }), object({ distance: 300 })]
  const list = orbitsOf({ objects: [object({ sprite: 'star/g0' }), object({ sprite: 'planet/gas', distance: 1000, period: 500, children: moons })] }, stars)
  assert.ok(Math.abs(list[2].speed - 360 / Math.sqrt(200 ** 3 / 400)) < 1e-9)
  assert.notEqual(list[2].speed, list[3].speed)
})

test('places objects with Angle::Unit, (sin, -cos), around their parents', () => {
  const list = orbitsOf({ objects: [object({ distance: 100, period: 360, children: [object({ distance: 10, period: 360, offset: 90 })] })] }, {})
  const [planet, moon] = positionsOn(list, 0)
  // At angle 0 a planet is straight "up" the screen, the game's y being down.
  assert.ok(Math.abs(planet[0]) < 1e-9 && Math.abs(planet[1] + 100) < 1e-9)
  // Its moon, a quarter turn on, is to its right.
  assert.ok(Math.abs(moon[0] - 10) < 1e-9 && Math.abs(moon[1] + 100) < 1e-9)
  // A quarter of a period later, the planet is to the right of the star.
  const [later] = positionsOn(list, 90)
  assert.ok(Math.abs(later[0] - 100) < 1e-9 && Math.abs(later[1]) < 1e-9)
})
