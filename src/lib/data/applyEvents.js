// The galaxy after the story's events: those the extractor assumes happened,
// plus those of the chosen option of each story choice (scripts/events.js).
// Events are applied in the order the extractor gives, which follows each
// storyline's progression, so later events win as they would in game.

import { applyChange, finishGalaxy } from './universe.js'

/**
 * The events to apply, in order.
 * @param {any} galaxy  the extracted galaxy.json
 * @param {Record<string, string>} picks  choice key -> chosen option id
 * @returns {string[]}
 */
export function eventsToApply(galaxy, picks) {
  const chosen = (/** @type {any} */ c) => picks[c.key] ?? c.default
  const choices = new Map(galaxy.choices.map((/** @type {any} */ c) => [c.key, c]))
  return Object.entries(galaxy.events)
    .filter(([, e]) => e.status === 'assumed'
      // Every choice an event hangs on must be set to its option. That covers
      // nested choices too: an event under one carries its parent's as well.
      || (e.status === 'choice' && e.choices.every((/** @type {any} */ c) => chosen(choices.get(c.choice)) === c.option)))
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([name]) => name)
}

/**
 * A copy of the galaxy with the given events applied, in the same shape, plus
 * `changedBy`: for each system, the events that changed it or its planets.
 * @param {any} galaxy
 * @param {string[]} names
 */
export function applyEvents(galaxy, names) {
  const systems = new Map(galaxy.systems.map((/** @type {any} */ { stars, ...s }) => [s.name, structuredClone(s)]))
  const planets = new Map(galaxy.planets.map((/** @type {any} */ { system, inhabited, ...p }) => [p.name, structuredClone(p)]))
  /** @type {Map<string, Set<string>>} */
  const changedBy = new Map()
  /** @type {Map<string, Set<string>>} planet -> events, resolved to systems at the end */
  const planetChanges = new Map()
  /** @param {Map<string, Set<string>>} map @param {string} key @param {string} event */
  const note = (map, key, event) => map.set(key, (map.get(key) ?? new Set()).add(event))

  for (const name of names)
    for (const change of galaxy.events[name].changes) {
      applyChange({ systems, planets }, change)
      const [kind, a, b] = change.tokens
      if (kind === 'system') note(changedBy, a, name)
      else if (kind === 'planet') note(planetChanges, a, name)
      else {
        note(changedBy, a, name)
        note(changedBy, b, name)
      }
    }

  const finished = finishGalaxy(systems.values(), planets.values())
  for (const p of finished.planets)
    for (const event of planetChanges.get(p.name) ?? []) if (p.system) note(changedBy, p.system, event)
  return { ...galaxy, ...finished, changedBy }
}
