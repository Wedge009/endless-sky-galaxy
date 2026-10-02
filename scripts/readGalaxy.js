// Read one Endless Sky check-out into the galaxy the viewer shows: the
// top-level definitions in data/, before any mission event has changed
// anything, and the events that change what the viewer shows, classified by
// scripts/events.js as assumed to have happened or hanging on a story choice.

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import sharp from 'sharp'
import { parseDataFile } from './dataFile.js'
import { analyseEvents } from './events.js'
import { choiceLabels } from './eventChoices.js'
import { finishGalaxy, flatten, loadPlanet, loadShop, loadSystem } from '../src/lib/data/universe.js'
import { applyEvents, eventsToApply } from '../src/lib/data/applyEvents.js'

/** @typedef {import('./dataFile.js').DataNode} DataNode */

/**
 * @param {string} ES  the check-out
 * @param {{ root: string, sprites: boolean }} options  `root` is this project, for
 *   exporting sprites into public/; without `sprites`, none are exported and
 *   the galaxy has no backdrop, region labels or star icons, as for a version
 *   that's only compared against
 */
export async function readGalaxy(ES, { root, sprites }) {
  /** @param {string} dir @returns {string[]} */
  function listFiles(dir) {
    return readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .flatMap(entry => {
        const path = join(dir, entry.name)
        return entry.isDirectory() ? listFiles(path) : entry.name.endsWith('.txt') ? [path] : []
      })
  }

  const num = (/** @type {string} */ s) => Number.parseFloat(s)

  // ---------------------------------------------------------------------------
  // Load every top-level definition the map needs. Systems and planets are
  // loaded by src/lib/data/universe.js, which the viewer shares for applying
  // events.

  /** @type {Map<string, any>} */ const systems = new Map()
  /** @type {Map<string, any>} */ const planets = new Map()
  /** @type {Map<string, any>} */ const governments = new Map()
  /** @type {Map<string, any>} */ const galaxies = new Map()
  /** @type {Map<string, any>} */ const wormholes = new Map()
  /** @type {Map<string, any>} */ const stars = new Map()
  /** @type {Map<string, number[]>} */ const colors = new Map()
  /** @type {{ name: string, low: number, high: number }[]} */ const commodities = []
  /** @type {Map<string, any>} */ const outfitters = new Map()
  /** @type {Map<string, any>} */ const shipyards = new Map()
  /** @type {Map<string, string | null>} outfit -> category */ const outfitCategories = new Map()
  /** @type {Map<string, string | null>} ship -> category; variants take their base's */ const shipCategories = new Map()
  /** @type {[string, string][]} variant -> base ship */ const variants = []
  /** @type {Record<string, string[]>} the order the game lists categories in (categories.txt) */ const categoryOrder = {}
  /** @type {number[] | null} day, month, year a new game starts on (starts.txt) */ let startDate = null
  const duplicates = []

  /** @param {string[]} values @returns {number[] | null} */
  function colorOf(values) {
    if (values.length >= 3 && values.slice(0, 3).every(v => !Number.isNaN(num(v)))) return values.slice(0, 3).map(num)
    return colors.get(values[0]) ?? null
  }

  const files = listFiles(join(ES, 'data')).filter(f => !relative(join(ES, 'data'), f).startsWith('_deprecated'))
  const pendingColors = []
  /** @type {DataNode[]} every top-level node, in load order, for the event analysis */
  const allNodes = []
  for (const file of files) {
    for (const node of parseDataFile(file)) {
      allNodes.push(node)
      const [type, name] = node.tokens
      if (type === 'system' && name) loadSystem(systems, node) && duplicates.push(`system ${name}`)
      else if (type === 'planet' && name) loadPlanet(planets, node) && duplicates.push(`planet ${name}`)
      else if (type === 'color' && name && node.tokens.length >= 5) colors.set(name, node.tokens.slice(2, 5).map(num))
      else if (type === 'government' && name) {
        const g = governments.get(name) ?? { name, displayName: null, color: null }
        governments.set(name, g)
        for (const child of node.children) {
          if (child.tokens[0] === 'color') pendingColors.push(() => (g.color = colorOf(child.tokens.slice(1)) ?? g.color))
          else if (child.tokens[0] === 'display name') g.displayName = child.tokens[1]
        }
      } else if (type === 'galaxy' && name) {
        const g = galaxies.get(name) ?? { name, pos: [0, 0], sprite: null }
        galaxies.set(name, g)
        for (const child of node.children) {
          if (child.tokens[0] === 'pos') g.pos = [num(child.tokens[1]), num(child.tokens[2])]
          else if (child.tokens[0] === 'sprite') g.sprite = child.tokens[1]
        }
      } else if (type === 'wormhole' && name) {
        const w = wormholes.get(name) ?? { name, displayName: null, mappable: false, links: [], color: null }
        wormholes.set(name, w)
        for (const child of node.children) {
          const [key, ...values] = child.tokens
          if (key === 'mappable') w.mappable = true
          else if (key === 'display name') w.displayName = values[0]
          else if (key === 'link') w.links.push([values[0], values[1]])
          else if (key === 'color') pendingColors.push(() => (w.color = colorOf(values)))
        }
      } else if (type === 'start' && name === 'default') {
        const date = node.children.find(c => c.tokens[0] === 'date')
        if (date) startDate = date.tokens.slice(1, 4).map(Number)
      } else if (type === 'category' && (name === 'ship' || name === 'outfit')) categoryOrder[name] = node.children.map(c => c.tokens[0])
      else if (type === 'outfitter' && name) loadShop(outfitters, node)
      else if (type === 'shipyard' && name) loadShop(shipyards, node)
      else if (type === 'outfit' && name) {
        const category = node.children.find(c => c.tokens[0] === 'category')?.tokens[1]
        if (category || !outfitCategories.has(name)) outfitCategories.set(name, category ?? null)
      } else if (type === 'ship' && name) {
        // A variant, `ship "Base" "Variant"`, is sold under its own name.
        if (node.tokens[2]) variants.push([node.tokens[2], name])
        else {
          const category = node.children.find(c => c.tokens[0] === 'attributes')?.children.find(c => c.tokens[0] === 'category')?.tokens[1]
          if (category || !shipCategories.has(name)) shipCategories.set(name, category ?? null)
        }
      } else if (type === 'star' && name) {
        const s = stars.get(name) ?? { sprite: name, icon: null, power: null, wind: null, mass: 0, habitable: 0 }
        stars.set(name, s)
        for (const child of node.children) {
          const [key, value] = child.tokens
          if (key === 'icon') s.icon = value
          else if (key === 'power') s.power = num(value)
          else if (key === 'wind') s.wind = num(value)
        else if (key === 'mass') s.mass = num(value)
        else if (key === 'habitable') s.habitable = num(value)
        }
      } else if (type === 'trade') {
        for (const child of node.children)
          if (child.tokens[0] === 'commodity' && child.tokens.length >= 4)
            commodities.push({ name: child.tokens[1], low: num(child.tokens[2]), high: num(child.tokens[3]) })
      }
    }
  }
  // Colours may be named before they're defined, so resolve them last.
  pendingColors.forEach(resolveColor => resolveColor())

  // ---------------------------------------------------------------------------
  // Sprites. A sprite name like "label/core" refers to an image file such as
  // images/label/core+.png. As ImageFileData reads a file name: "@2x" marks a
  // high-DPI variant and "@sw" a swizzle mask (not an image); then trailing
  // digits are a frame number only when a blend mark comes before them ('-'
  // normal, '+' additive, '^' or '~' half-additive, '=' pre-multiplied), and a
  // blend mark alone means frame 0. So "g0" is a star sprite, not frame 0 of
  // "g". The first frame of an animation is used.

  const IMAGE = /\.(png|jpe?g|webp|avif)$/i
  const BLEND = new Set(['-', '^', '+', '=', '~'])
  /** @param {string} file */
  function parseImageFile(file) {
    const ext = file.match(IMAGE)?.[1]
    if (!ext) return null
    let name = file.slice(0, -ext.length - 1)
    let is2x = false
    if (name.endsWith('@2x')) [name, is2x] = [name.slice(0, -3), true]
    if (name.endsWith('@1x')) name = name.slice(0, -3)
    if (name.endsWith('@sw')) return null
    let at = name.length
    while (at > 0 && /\d/.test(name[at - 1])) at--
    let blend = ''
    let frame = 0
    if (at > 0 && BLEND.has(name[at - 1])) {
      blend = name[at - 1]
      frame = Number(name.slice(at)) || 0
      name = name.slice(0, at - 1)
    }
    return { name, ext: ext.toLowerCase(), is2x, blend, frame }
  }
  /** @type {Map<string, any>} */
  const spriteCache = new Map()

  /** @param {string | null} name */
  async function exportSprite(name) {
    if (!name || !sprites) return null
    if (spriteCache.has(name)) return spriteCache.get(name)
    const dir = join(ES, 'images', dirname(name))
    const base = name.split('/').at(-1)
    const candidates = existsSync(dir)
      ? readdirSync(dir).map(file => ({ file, m: parseImageFile(file) })).filter(c => c.m?.name === base)
      : []
    // Prefer the 1x, first-frame image.
    candidates.sort((a, b) => Number(a.m?.is2x) - Number(b.m?.is2x) || (a.m?.frame ?? 0) - (b.m?.frame ?? 0))
    const pick = candidates[0]
    if (!pick || !pick.m) {
      spriteCache.set(name, null)
      return null
    }

    const source = join(dir, pick.file)
    // Copied as they are, not re-encoded: the viewer zooms in much further than
    // the game, so any detail lost to compression shows.
    const url = `sprites/${name.replace(/[^\w/-]+/g, '_')}.${pick.m.ext}`
    const dest = join(root, 'public', url)
    mkdirSync(dirname(dest), { recursive: true })
    if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(source).mtimeMs) {
      copyFileSync(source, dest)
    }
    const meta = await sharp(source, { limitInputPixels: false }).metadata()
    const scale = pick.m.is2x ? 0.5 : 1
    const sprite = {
      url,
      width: (meta.width ?? 0) * scale,
      height: (meta.height ?? 0) * scale,
      additive: ['+', '^', '~'].includes(pick.m.blend),
    }
    spriteCache.set(name, sprite)
    return sprite
  }

  // ---------------------------------------------------------------------------
  // Assemble the galaxy.

  const outGalaxies = []
  for (const g of galaxies.values()) {
    // Region labels without a sprite are revealed by an event as the player
    // explores. Their images follow the "label <region>" naming, so show them.
    let sprite = g.sprite
    let fromEvent = false
    if (!sprite && g.name.startsWith('label ')) {
      sprite = `label/${g.name.slice(6)}`
      fromEvent = true
    }
    const exported = await exportSprite(sprite)
    if (exported) outGalaxies.push({ name: g.name, pos: g.pos, sprite: exported, fromEvent })
  }

  const outStars = {}
  for (const s of stars.values())
    outStars[s.sprite] = { icon: await exportSprite(s.icon), power: s.power, wind: s.wind, mass: s.mass, habitable: s.habitable }

  // The sprites of every stellar object, for the system view: those in the
  // definitions, and those events bring in (a bombed planet, say).
  const objectSprites = new Set(flatten([...systems.values()].flatMap(s => s.objects)).map(o => o.sprite).filter(Boolean))
  /** @param {DataNode} node */
  const spritesIn = node => {
    if (node.tokens[0] === 'sprite' && node.tokens[1]) objectSprites.add(node.tokens[1])
    node.children.forEach(spritesIn)
  }
  for (const node of allNodes) if (node.tokens[0] === 'event') node.children.filter(c => c.tokens[0] === 'system').forEach(spritesIn)
  /** @type {Record<string, any>} */
  const outSprites = {}
  for (const name of [...objectSprites].sort()) {
    const sprite = await exportSprite(name)
    if (sprite) outSprites[name] = sprite
  }

  const finished = finishGalaxy(systems.values(), planets.values())

  // ---------------------------------------------------------------------------
  // Events. Those that matter change a system as the map shows it, a link, a
  // region label, a planet or what a shop sells; changes to fleets and the
  // like don't show.

  const MAP_KEYS = new Set(['pos', 'government', 'link', 'hidden', 'shrouded', 'inaccessible', 'object', 'attributes'])
  /** @param {DataNode} event */
  function isRelevant(event) {
    return event.children.some(c => ['link', 'unlink', 'galaxy', 'planet', 'outfitter', 'shipyard'].includes(c.tokens[0])
      || (c.tokens[0] === 'system' && c.children.some(g => MAP_KEYS.has(g.tokens[g.tokens[0] === 'add' || g.tokens[0] === 'remove' ? 1 : 0]))))
  }
  const analysis = analyseEvents(allNodes, { isRelevant, labels: choiceLabels })

  /** A data node without its source position, as the viewer applies it. @param {DataNode} node @returns {any} */
  const bare = node => ({ tokens: node.tokens, children: node.children.map(bare) })
  const eventNodes = new Map(allNodes.filter(n => n.tokens[0] === 'event').map(n => [n.tokens[1], n]))
  for (const [name, e] of Object.entries(analysis.events)) {
    e.file = e.file && relative(join(ES, 'data'), e.file)
    // The changes the viewer applies (see applyChange in src/lib/data/universe.js).
    e.changes = (eventNodes.get(name)?.children ?? [])
      .filter(c => ['system', 'planet', 'link', 'unlink', 'outfitter', 'shipyard'].includes(c.tokens[0]))
      .map(bare)
  }

  const galaxy = {
    galaxies: outGalaxies,
    governments: Object.fromEntries([...governments.values()].map(g => [g.name, { displayName: g.displayName, color: g.color }])),
    commodities,
    stars: outStars,
    sprites: outSprites,
    startDate,
    systems: finished.systems,
    links: finished.links,
    planets: finished.planets,
    wormholes: [...wormholes.values()],
    outfitters: Object.fromEntries(outfitters),
    shipyards: Object.fromEntries(shipyards),
    // What each item sold is, for grouping a shop's stock.
    categories: {
      outfits: Object.fromEntries(outfitCategories),
      ships: Object.fromEntries([...shipCategories, ...variants.map(([variant, base]) => [variant, shipCategories.get(base) ?? null])]),
      order: { outfits: categoryOrder.outfit ?? [], ships: categoryOrder.ship ?? [] },
    },
    events: analysis.events,
    choices: analysis.choices,
  }

  // A choice is only worth offering if its outcomes still differ in what a
  // reference map shows, once every event is applied. Later events often settle
  // a branch either way, leaving only reworded text, fleets coming more or less
  // often, or details of play such as the reputation needed to land. Such a
  // choice takes its default.
  /** @param {any} a @param {any} b */
  function differs(a, b) {
    const key = (/** @type {string[]} */ l) => l.join('\u0000')
    const links = new Set(a.links.map(key))
    if (a.links.length !== b.links.length || b.links.some((/** @type {string[]} */ l) => !links.has(key(l)))) return true
    // Fleets, minables and hazards are shown by name, not how often or how many.
    const names = (/** @type {any[]} */ list) => list.map(x => x.name).sort()
    // Stellar objects by name and sprite, as a system view would show them, but
    // not their order: events replace an object by removing and adding it, which
    // moves it to the end.
    const named = (/** @type {any[]} */ objects) => flatten(objects).map(o => `${o.name}\u0000${o.sprite}`).sort()
    const system = (/** @type {any} */ s) => JSON.stringify({
      ...s, fleets: names(s.fleets), minables: names(s.minables), hazards: names(s.hazards), objects: named(s.objects), stars: null,
    })
    if (a.systems.some((/** @type {any} */ s, /** @type {number} */ i) => system(s) !== system(b.systems[i]))) return true
    const planet = (/** @type {any} */ p) => JSON.stringify({
      ...p, description: null, spaceport: null, port: p.port && { ...p.port, description: null }, requiredReputation: null, bribe: null,
    })
    if (a.planets.some((/** @type {any} */ p, /** @type {number} */ i) => planet(p) !== planet(b.planets[i]))) return true
    return JSON.stringify([a.outfitters, a.shipyards]) !== JSON.stringify([b.outfitters, b.shipyards])
  }
  const settled = []
  for (const choice of [...galaxy.choices]) {
    const outcome = (/** @type {string} */ id) => applyEvents(galaxy, eventsToApply(galaxy, { [choice.key]: id }))
    const chosen = outcome(choice.default)
    if (choice.options.some((/** @type {any} */ o) => o.id !== choice.default && differs(chosen, outcome(o.id)))) continue
    galaxy.choices = galaxy.choices.filter((/** @type {any} */ c) => c !== choice)
    for (const o of choice.options)
      for (const name of o.events) {
        const e = galaxy.events[name]
        e.choices = e.choices.filter((/** @type {any} */ c) => c.choice !== choice.key)
        if (o.id !== choice.default) e.status = 'alternative'
        else if (!e.choices.length) e.status = 'assumed'
      }
    settled.push(choice.label ?? choice.key)
  }
  return { galaxy, duplicates, analysis, settled }
}
