// System ring colours for each map mode, following MapPanel.cpp where the
// game has an equivalent. The game draws its rings at 40% alpha over black,
// which reads too dim over the Milky Way backdrop, so they're brightened here.

const BRIGHTEN = 1.35

/** @param {number[]} c */
const bright = c => c.map(v => Math.min(1, v * BRIGHTEN))

/** @param {any} galaxy @param {string | null} name */
export function governmentColor(galaxy, name) {
  const color = (name && galaxy.governments[name]?.color) ?? [1, 1, 1]
  return bright(color.map((/** @type {number} */ v) => 0.6 * v))
}

/** MapPanel::MapColor, for a value from -1 (cheap) to 1 (expensive). @param {number} value */
export function valueColor(value) {
  const v = Math.max(-1, Math.min(1, value))
  return bright(v < 0 ? [0.12 + 0.12 * v, 0.48 + 0.36 * v, 0.48 - 0.12 * v] : [0.12 + 0.48 * v, 0.48, 0.48 - 0.48 * v])
}

/** @param {string | undefined} sprite e.g. "star/g5", "star/m-dwarf", "star/black-hole-core" */
export function starClass(sprite) {
  const name = (sprite ?? '').replace(/^star\//, '')
  if (!name) return 'none'
  if (/black|hole|eater/.test(name)) return 'black hole'
  if (/neutron|pulsar|magnetar|wr|wolf|nova|white|carbon|smoke|protostar/.test(name)) return 'remnant / exotic'
  if (/brown/.test(name)) return 'brown dwarf'
  const spectral = name[0]
  return 'obafgkm'.includes(spectral) ? spectral.toUpperCase() : 'remnant / exotic'
}

/** @type {Record<string, number[]>} */
export const STAR_CLASS_COLORS = {
  O: [0.55, 0.65, 1],
  B: [0.68, 0.78, 1],
  A: [0.85, 0.88, 1],
  F: [1, 0.97, 0.85],
  G: [1, 0.88, 0.55],
  K: [1, 0.66, 0.35],
  M: [1, 0.42, 0.3],
  'brown dwarf': [0.6, 0.36, 0.26],
  'remnant / exotic': [0.4, 0.95, 0.9],
  'black hole': [0.6, 0.35, 0.85],
  none: [0.35, 0.35, 0.35],
}

/** @type {Record<string, number[]>} */
export const VISIBILITY_COLORS = {
  mapped: [0.55, 0.55, 0.55],
  shrouded: [0.2, 0.8, 0.75],
  hidden: [0.85, 0.45, 1],
  'hidden + shrouded': [0.45, 0.55, 1],
  inaccessible: [1, 0.35, 0.3],
}

/** @param {any} s */
export function visibilityOf(s) {
  if (s.inaccessible) return 'inaccessible'
  if (s.hidden) return s.shrouded ? 'hidden + shrouded' : 'hidden'
  return s.shrouded ? 'shrouded' : 'mapped'
}

/** @type {Record<string, number[]>} */
export const EVENT_COLORS = {
  'changed by story events': [1, 0.72, 0.25],
  unchanged: [0.3, 0.3, 0.3],
}

export const SELLS_COLOR = [0.35, 0.85, 1]

/**
 * The systems with a planet that sells an item, for a mode like
 * 'sells:outfit:Heavy Laser' or 'sells:ship:Shuttle'.
 * @param {any} galaxy @param {string} mode
 * @returns {Set<string>}
 */
export function systemsSelling(galaxy, mode) {
  const [, kind, ...rest] = mode.split(':')
  const item = rest.join(':')
  const table = kind === 'ship' ? galaxy.shipyards : galaxy.outfitters
  const sold = new Set()
  for (const p of galaxy.planets) {
    if (!p.system) continue
    const shops = kind === 'ship' ? p.shipyards : p.outfitters
    if (shops.some((/** @type {string} */ shop) => table[shop]?.items.includes(item))) sold.add(p.system)
  }
  return sold
}

/** For the changes since another version, systems and links alike. @type {Record<string, number[]>} */
export const CHANGE_COLORS = {
  new: [0.35, 0.9, 0.4],
  changed: [1, 0.72, 0.25],
  'description only': [0.6, 0.5, 0.32],
  removed: [1, 0.35, 0.3],
  unchanged: [0.3, 0.3, 0.3],
}

/**
 * @param {any} galaxy
 * @param {string} mode  'government' | 'stars' | 'visibility' | 'events' | 'changes' | 'commodity:<name>' | 'sells:<outfit|ship>:<name>'
 * @param {ReturnType<typeof import('../data/compareGalaxies.js').compareGalaxies> | null} [changes]
 *   what's changed since another version, for the 'changes' mode
 * @returns {number[][]}
 */
export function systemColors(galaxy, mode, changes = null) {
  const uninhabited = governmentColor(galaxy, 'Uninhabited')
  if (mode.startsWith('commodity:')) {
    const commodity = galaxy.commodities.find((/** @type {any} */ c) => c.name === mode.slice(10))
    return galaxy.systems.map((/** @type {any} */ s) => {
      const price = s.trade[commodity?.name]
      if (price === undefined || !commodity) return uninhabited
      return valueColor(((price - commodity.low) / (commodity.high - commodity.low)) * 2 - 1)
    })
  }
  if (mode === 'stars')
    return galaxy.systems.map((/** @type {any} */ s) => STAR_CLASS_COLORS[starClass(s.stars[0])])
  if (mode.startsWith('sells:')) {
    const sold = systemsSelling(galaxy, mode)
    return galaxy.systems.map((/** @type {any} */ s) => (sold.has(s.name) ? SELLS_COLOR : EVENT_COLORS.unchanged))
  }
  if (mode === 'changes')
    return galaxy.systems.map((/** @type {any} */ s) => {
      const status = changes?.systems.get(s.name)?.status
      return CHANGE_COLORS[{ added: 'new', changed: 'changed', reworded: 'description only' }[status ?? ''] ?? 'unchanged']
    })
  if (mode === 'events')
    return galaxy.systems.map((/** @type {any} */ s) => EVENT_COLORS[galaxy.changedBy?.has(s.name) ? 'changed by story events' : 'unchanged'])
  if (mode === 'visibility')
    return galaxy.systems.map((/** @type {any} */ s) => VISIBILITY_COLORS[visibilityOf(s)])
  return galaxy.systems.map((/** @type {any} */ s) => governmentColor(galaxy, s.government))
}

/** @param {number[]} c */
export const css = c => `rgb(${c.map(v => Math.round(v * 255)).join(' ')})`
