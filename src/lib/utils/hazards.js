// A system's hazards, and what each means to someone flying there. A hazard
// is centred on the system, or on a stellar object that carries it, and
// covers a range around that, or the whole system. It starts with a chance of
// one in its period each frame, at 60 frames a second (Engine.cpp), so a
// period of 1 means it's always active, and lasts for its duration.

import { flatten } from '../data/universe.js'

const FRAMES_PER_SECOND = 60

/**
 * Every hazard in a system: its own, centred on the system, and those its
 * objects carry, centred on them.
 * @param {any} system
 * @returns {{ name: string, period: number, object: any | null }[]}
 */
export function hazardsOf(system) {
  return [
    ...system.hazards.map((/** @type {any} */ h) => ({ ...h, object: null })),
    ...flatten(system.objects).flatMap(o => (o.hazards ?? []).map((/** @type {any} */ h) => ({ ...h, object: o }))),
  ]
}

/** A game time in frames, in words. @param {number} frames */
function time(frames) {
  const seconds = frames / FRAMES_PER_SECOND
  if (seconds < 90) return `${Math.round(seconds)} s`
  const minutes = seconds / 60
  return minutes < 90 ? `${Math.round(minutes)} min` : `${Math.round(minutes / 6) / 10} h`
}

/**
 * What an unnamed object is, from its sprite, for saying where a hazard is.
 * @param {any} object
 */
export function objectKind(object) {
  const sprite = object.sprite ?? ''
  if (sprite.startsWith('star/')) return /black|hole/.test(sprite) ? 'the black hole' : 'the star'
  if (sprite.startsWith('planet/station')) return 'a station'
  return 'an object'
}

/**
 * @param {any} galaxy
 * @param {{ name: string, period: number, object: any | null }} hazard
 * @param {(object: any) => string} objectName  how to name the object it's centred on
 */
export function describeHazard(galaxy, hazard, objectName) {
  const def = galaxy.hazards?.[hazard.name]
  const centre = hazard.object ? objectName(hazard.object) : 'the centre'
  const always = hazard.period <= 1
  let where = 'throughout the system'
  if (def && !def.systemWide)
    where = def.range[0] > 0 ? `${def.range[0]}–${def.range[1]} from ${centre}` : `within ${def.range[1]} of ${centre}`
  let when = 'always'
  if (!always) {
    when = `on average every ${time(hazard.period)}`
    if (def && def.duration[1] > 1) {
      const [shortest, longest] = def.duration
      when += shortest === longest ? `, for ${time(longest)}`
        : shortest < FRAMES_PER_SECOND ? `, for up to ${time(longest)}`
        : `, for ${time(shortest)} to ${time(longest)}`
    }
  }
  // What it does: its kinds of damage, a negative "damage" being a gain, and
  // any push or pull ("hit force").
  const effects = Object.entries(def?.damage ?? {}).map(([key, value]) => {
    if (key === 'hit force') return value < 0 ? 'pulls ships in' : 'pushes ships away'
    const kind = key.replace(/ damage$/, '').replace(/^relative /, '')
    return value < 0 ? `restores ${kind}` : `${kind} damage`
  })
  return { always, where, when, effects: [...new Set(effects)], visible: def?.effects ?? false, systemWide: def?.systemWide ?? false, range: def?.range ?? [0, 0] }
}
