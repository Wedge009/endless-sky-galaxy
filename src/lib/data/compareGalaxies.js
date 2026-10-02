// What has changed between two versions of the galaxy, as a reference reader
// would want to know: systems and links added or removed, and for each system
// what's different about it and its planets. Systems and planets are matched
// by name, so a rename shows as one removed and another added.

import { flatten } from './universe.js'

/**
 * @typedef {{ what: string, before?: string, after?: string, added?: string[], removed?: string[], items?: string[], reworded?: boolean }} Change
 *   A value that changed (`before` and `after`), a list that gained or lost
 *   items (`added` and `removed`), several small changes (`items`), or just a
 *   note (`what` alone).
 * @typedef {{ name: string, status: 'added' | 'removed' | 'changed' | 'reworded', changes: Change[] }} SystemChange
 *   "reworded" is a change only to some description, which a reader may
 *   want to tell apart from changes of substance.
 */

const list = (/** @type {string[]} */ items) => items.length ? items.join(', ') : 'none'
const flag = (/** @type {boolean} */ v) => (v ? 'yes' : 'no')

/** What a planet offers. @param {any} p @returns {string[]} */
const services = p => [
  (p.spaceport.length || p.port) && 'spaceport',
  ...p.shipyards.map((/** @type {string} */ s) => `shipyard: ${s}`),
  ...p.outfitters.map((/** @type {string} */ o) => `outfitter: ${o}`),
].filter(Boolean)

/** Every paragraph of a planet's descriptions, for noticing a rewrite. @param {any} p */
const prose = p => JSON.stringify([p.description, p.spaceport, p.port?.description])

/**
 * @param {any} current  the galaxy being viewed
 * @param {any} previous  the version it's compared against
 */
export function compareGalaxies(current, previous) {
  const governmentName = (/** @type {string | null} */ name) =>
    (name && (current.governments[name] ?? previous.governments[name])?.displayName) ?? name ?? 'none'
  const before = new Map(previous.systems.map((/** @type {any} */ s) => [s.name, s]))
  const after = new Map(current.systems.map((/** @type {any} */ s) => [s.name, s]))
  const planetsBefore = new Map(previous.planets.map((/** @type {any} */ p) => [p.name, p]))
  const planetsAfter = new Map(current.planets.map((/** @type {any} */ p) => [p.name, p]))

  const pairKey = (/** @type {string[]} */ l) => l.join('\u0000')
  const linksBefore = new Map(previous.links.map((/** @type {string[]} */ l) => [pairKey(l), l]))
  const linksAfter = new Map(current.links.map((/** @type {string[]} */ l) => [pairKey(l), l]))
  const addedLinks = [...linksAfter].filter(([k]) => !linksBefore.has(k)).map(([, l]) => l)
  const removedLinks = [...linksBefore].filter(([k]) => !linksAfter.has(k)).map(([, l]) => l)

  /** @type {Map<string, SystemChange>} */
  const systems = new Map()
  for (const [name] of after) if (!before.has(name)) systems.set(name, { name, status: 'added', changes: [] })
  for (const [name] of before) if (!after.has(name)) systems.set(name, { name, status: 'removed', changes: [] })

  for (const [name, s] of after) {
    const old = before.get(name)
    if (!old) continue
    /** @type {Change[]} */
    const changes = []
    /** @param {string} what @param {string} a @param {string} b */
    const compare = (what, a, b) => a !== b && changes.push({ what, before: a, after: b })
    /** @param {string} what @param {string[]} a @param {string[]} b */
    const compareList = (what, a, b) => {
      const added = b.filter(x => !a.includes(x))
      const removed = a.filter(x => !b.includes(x))
      if (added.length || removed.length) changes.push({ what, added, removed })
    }

    compare('Name', old.displayName ?? old.name, s.displayName ?? s.name)
    compare('Government', governmentName(old.government), governmentName(s.government))
    if (Math.hypot(s.pos[0] - old.pos[0], s.pos[1] - old.pos[1]) > 0.5)
      changes.push({ what: 'Position', before: old.pos.map(Math.round).join(', '), after: s.pos.map(Math.round).join(', ') })
    for (const key of ['hidden', 'shrouded', 'inaccessible']) compare(key[0].toUpperCase() + key.slice(1), flag(old[key]), flag(s[key]))
    compareList('Attributes', old.attributes, s.attributes)
    compare('Stars', list(old.stars), list(s.stars))
    compare('Jump range', String(old.jumpRange ?? 'default'), String(s.jumpRange ?? 'default'))

    compareList('Links', old.links, s.links)

    const prices = Object.keys({ ...old.trade, ...s.trade })
      .filter(c => old.trade[c] !== s.trade[c])
      .map(c => `${c} ${old.trade[c] ?? 'none'} → ${s.trade[c] ?? 'none'}`)
    if (prices.length) changes.push({ what: 'Prices', items: prices })

    // Planets by the named objects in each version of the system.
    const named = (/** @type {any} */ sys) => flatten(sys.objects).map(o => o.name).filter(Boolean)
    const was = named(old)
    const now = named(s)
    compareList('Planets and stations', was, now)
    for (const planet of now.filter(p => was.includes(p))) {
      const a = planetsBefore.get(planet)
      const b = planetsAfter.get(planet)
      if (!a || !b) continue
      compare(`${planet}: government`, governmentName(a.government), governmentName(b.government))
      compareList(`${planet}: services`, services(a), services(b))
      compareList(`${planet}: attributes`, a.attributes, b.attributes)
      compare(`${planet}: inhabited`, flag(a.inhabited), flag(b.inhabited))
      if (prose(a) !== prose(b)) changes.push({ what: `${planet}: description rewritten`, reworded: true })
    }

    if (changes.length)
      systems.set(name, { name, status: changes.every(c => c.reworded) ? 'reworded' : 'changed', changes })
  }

  const counts = { added: 0, removed: 0, changed: 0, reworded: 0 }
  for (const c of systems.values()) counts[c.status]++
  return {
    systems,
    /** Systems of the earlier version that are gone, to draw as ghosts. */
    removedSystems: [...before.values()].filter(s => !after.has(s.name)),
    addedLinks,
    removedLinks,
    counts: { ...counts, addedLinks: addedLinks.length, removedLinks: removedLinks.length },
  }
}
