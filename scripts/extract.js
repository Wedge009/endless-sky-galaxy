// Extract the galaxy from an Endless Sky check-out into public/data/galaxy.json,
// copying the sprites the viewer needs into public/sprites/.
//
//   npm run extract [-- /path/to/endless-sky]
//
// The check-out uses ../endless-sky by default (or $ES_PATH). Any branch, tag or
// working tree can be pointed at, which is how development versions are viewed.
//
// Only the base state of the galaxy is extracted: the top-level definitions in
// data/, before any mission event has added, removed or changed anything.

import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { parseDataFile } from './dataFile.js'

/** @typedef {import('./dataFile.js').DataNode} DataNode */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ES = resolve(process.argv[2] ?? process.env.ES_PATH ?? join(ROOT, '..', 'endless-sky'))
const OUT_DATA = join(ROOT, 'public', 'data')
const OUT_SPRITES = join(ROOT, 'public', 'sprites')

if (!existsSync(join(ES, 'data')) || !existsSync(join(ES, 'images'))) {
  console.error(`Not an Endless Sky checkout (no data/ and images/): ${ES}`)
  process.exit(1)
}

/** @param {string} dir @returns {string[]} */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap(entry => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? listFiles(path) : entry.name.endsWith('.txt') ? [path] : []
    })
}

/** @param {string} command */
function git(command) {
  try {
    return execSync(`git -C "${ES}" ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return null
  }
}

const num = (/** @type {string} */ s) => Number.parseFloat(s)

// ---------------------------------------------------------------------------
// Load every top-level definition the map needs. As in the game, a second
// definition of the same object amends the first: a key given without "add"
// replaces that key's earlier values, "add" appends and "remove" deletes.

/** @type {Map<string, any>} */ const systems = new Map()
/** @type {Map<string, any>} */ const planets = new Map()
/** @type {Map<string, any>} */ const governments = new Map()
/** @type {Map<string, any>} */ const galaxies = new Map()
/** @type {Map<string, any>} */ const wormholes = new Map()
/** @type {Map<string, any>} */ const stars = new Map()
/** @type {Map<string, number[]>} */ const colors = new Map()
/** @type {{ name: string, low: number, high: number }[]} */ const commodities = []
const duplicates = []

/**
 * Walk a node's children, splitting off any "add"/"remove" prefix and
 * clearing a key's previous values on its first plain occurrence.
 * @param {DataNode} node
 * @param {any} target
 * @param {Record<string, () => void>} clear  key -> how to clear it
 * @param {(key: string, values: string[], child: DataNode, mode: '' | 'add' | 'remove') => void} handle
 */
function loadChildren(node, target, clear, handle) {
  const cleared = new Set()
  for (const child of node.children) {
    const mode = child.tokens[0] === 'add' || child.tokens[0] === 'remove' ? child.tokens[0] : ''
    const key = child.tokens[mode ? 1 : 0]
    const values = child.tokens.slice(mode ? 2 : 1)
    if (key === undefined) continue
    if (clear[key] && ((mode === 'remove' && !values.length) || (!mode && !cleared.has(key)))) {
      clear[key]()
      cleared.add(key)
      if (mode === 'remove') continue
    }
    handle(key, values, child, mode)
  }
}

/** @param {DataNode} node @returns {any} */
function loadObject(node) {
  const object = { name: node.tokens[1] ?? null, sprite: null, distance: 0, period: 0, children: [] }
  for (const child of node.children) {
    const [key, value] = child.tokens
    if (key === 'sprite') object.sprite = value
    else if (key === 'distance') object.distance = num(value)
    else if (key === 'period') object.period = num(value)
    else if (key === 'object') object.children.push(loadObject(child))
  }
  return object
}

/** @param {DataNode} node */
function loadSystem(node) {
  const name = node.tokens[1]
  if (systems.has(name)) duplicates.push(`system ${name}`)
  const s = systems.get(name) ?? {
    name, displayName: null, pos: [0, 0], government: null, attributes: [], links: [],
    hidden: false, shrouded: false, inaccessible: false,
    jumpRange: null, belt: [], haze: null, objects: [], trade: {}, fleets: [], minables: [], hazards: [],
  }
  systems.set(name, s)
  loadChildren(node, s, {
    'display name': () => (s.displayName = null),
    government: () => (s.government = null),
    attributes: () => (s.attributes = []),
    link: () => (s.links = []),
    trade: () => (s.trade = {}),
    fleet: () => (s.fleets = []),
    minables: () => (s.minables = []),
    hazard: () => (s.hazards = []),
    belt: () => (s.belt = []),
    object: () => (s.objects = []),
    hidden: () => (s.hidden = false),
    shrouded: () => (s.shrouded = false),
    inaccessible: () => (s.inaccessible = false),
  }, (key, values, child, mode) => {
    const remove = mode === 'remove'
    const without = (/** @type {any[]} */ list, /** @type {(x: any) => boolean} */ match) => list.filter(x => !match(x))
    switch (key) {
      case 'display name': s.displayName = values[0]; break
      case 'pos': s.pos = [num(values[0]), num(values[1])]; break
      case 'government': s.government = values[0]; break
      case 'hidden': case 'shrouded': case 'inaccessible': s[key] = !remove; break
      case 'jump range': s.jumpRange = num(values[0]); break
      case 'haze': s.haze = values[0]; break
      case 'belt': s.belt.push(num(values[0])); break
      case 'attributes':
        s.attributes = remove ? s.attributes.filter((/** @type {string} */ a) => !values.includes(a))
          : [...new Set([...s.attributes, ...values])]
        break
      case 'link':
        s.links = remove ? s.links.filter((/** @type {string} */ l) => l !== values[0]) : [...new Set([...s.links, values[0]])]
        break
      case 'trade':
        if (remove) delete s.trade[values[0]]
        else s.trade[values[0]] = num(values[1])
        break
      case 'fleet':
        s.fleets = remove ? without(s.fleets, f => f.name === values[0])
          : [...s.fleets, { name: values[0], period: num(values[1]) }]
        break
      case 'minables':
        s.minables = remove ? without(s.minables, m => m.name === values[0])
          : [...s.minables, { name: values[0], count: num(values[1]), energy: num(values[2]) }]
        break
      case 'hazard':
        s.hazards = remove ? without(s.hazards, h => h.name === values[0])
          : [...s.hazards, { name: values[0], period: num(values[1]) }]
        break
      case 'object':
        if (remove) s.objects = without(s.objects, o => o.name === values[0])
        else s.objects.push(loadObject(child))
        break
    }
  })
}

/** @param {DataNode} node */
function loadPlanet(node) {
  const name = node.tokens[1]
  if (planets.has(name)) duplicates.push(`planet ${name}`)
  const p = planets.get(name) ?? {
    name, displayName: null, attributes: [], landscape: null, government: null,
    description: [], spaceport: [], port: null, shipyards: [], outfitters: [],
    security: null, bribe: null, tribute: null, requiredReputation: null, wormhole: null,
  }
  planets.set(name, p)
  /** @param {DataNode} child */
  const paragraph = child => ({ text: child.tokens.at(-1), conditional: child.children.some(c => c.tokens[0] === 'to') })
  loadChildren(node, p, {
    attributes: () => (p.attributes = []),
    description: () => (p.description = []),
    spaceport: () => (p.spaceport = []),
    port: () => (p.port = null),
    shipyard: () => (p.shipyards = []),
    outfitter: () => (p.outfitters = []),
    tribute: () => (p.tribute = null),
  }, (key, values, child, mode) => {
    const remove = mode === 'remove'
    switch (key) {
      case 'display name': p.displayName = values[0]; break
      case 'landscape': p.landscape = values[0]; break
      case 'government': p.government = values[0]; break
      case 'security': p.security = num(values[0]); break
      case 'bribe': p.bribe = num(values[0]); break
      case 'required reputation': p.requiredReputation = num(values[0]); break
      case 'wormhole': p.wormhole = values[0]; break
      case 'description': p.description.push(paragraph(child)); break
      case 'spaceport': p.spaceport.push(paragraph(child)); break
      case 'attributes':
        p.attributes = remove ? p.attributes.filter((/** @type {string} */ a) => !values.includes(a))
          : [...new Set([...p.attributes, ...values])]
        break
      case 'shipyard':
        p.shipyards = remove ? p.shipyards.filter((/** @type {string} */ v) => v !== values[0]) : [...p.shipyards, values[0]]
        break
      case 'outfitter':
        p.outfitters = remove ? p.outfitters.filter((/** @type {string} */ v) => v !== values[0]) : [...p.outfitters, values[0]]
        break
      case 'tribute': {
        const fleet = child.children.find(c => c.tokens[0] === 'fleet')
        p.tribute = { value: num(values[0]), fleet: fleet ? { name: fleet.tokens[1], count: num(fleet.tokens[2] ?? '1') } : null }
        break
      }
      case 'port': {
        p.port = { name: values[0] ?? null, recharges: [], services: [], description: [] }
        for (const c of child.children) {
          if (c.tokens[0] === 'recharges') p.port.recharges.push(...c.tokens.slice(1))
          else if (c.tokens[0] === 'services') p.port.services.push(...c.tokens.slice(1))
          else if (c.tokens[0] === 'description') p.port.description.push(paragraph(c))
        }
        break
      }
    }
  })
}

/** @param {string[]} values @returns {number[] | null} */
function colorOf(values) {
  if (values.length >= 3 && values.slice(0, 3).every(v => !Number.isNaN(num(v)))) return values.slice(0, 3).map(num)
  return colors.get(values[0]) ?? null
}

const files = listFiles(join(ES, 'data')).filter(f => !relative(join(ES, 'data'), f).startsWith('_deprecated'))
const pendingColors = []
for (const file of files) {
  for (const node of parseDataFile(file)) {
    const [type, name] = node.tokens
    if (type === 'system' && name) loadSystem(node)
    else if (type === 'planet' && name) loadPlanet(node)
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
    } else if (type === 'star' && name) {
      const s = stars.get(name) ?? { sprite: name, icon: null, power: null, wind: null }
      stars.set(name, s)
      for (const child of node.children) {
        const [key, value] = child.tokens
        if (key === 'icon') s.icon = value
        else if (key === 'power') s.power = num(value)
        else if (key === 'wind') s.wind = num(value)
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
// Sprites. A sprite name like "label/core" refers to images/label/core+.png,
// where the optional character after the name sets the blend mode
// ('+' additive, '~' half-additive, '^' pre-multiplied-but-not-really) and
// "@2x" marks a high-DPI variant. The first frame of an animation is used.

const SPRITE_FILE = /^(.*?)([+~^=])?(?:[-+~^=]?(\d+))?(@[12]x)?\.(png|jpe?g|webp|avif)$/i
/** @type {Map<string, any>} */
const spriteCache = new Map()

/** @param {string | null} name */
async function exportSprite(name) {
  if (!name) return null
  if (spriteCache.has(name)) return spriteCache.get(name)
  const dir = join(ES, 'images', dirname(name))
  const base = name.split('/').at(-1)
  const candidates = existsSync(dir)
    ? readdirSync(dir).map(file => ({ file, m: file.match(SPRITE_FILE) })).filter(c => c.m && c.m[1] === base)
    : []
  // Prefer the 1x, first-frame image.
  candidates.sort((a, b) => Number(a.m?.[4] === '@2x') - Number(b.m?.[4] === '@2x') || Number(a.m?.[3] ?? -1) - Number(b.m?.[3] ?? -1))
  const pick = candidates[0]
  if (!pick || !pick.m) {
    spriteCache.set(name, null)
    return null
  }

  const source = join(dir, pick.file)
  const isJpeg = /jpe?g$/i.test(pick.m[5])
  const ext = isJpeg ? 'webp' : pick.m[5].toLowerCase()
  const url = `sprites/${name.replace(/[^\w/-]+/g, '_')}.${ext}`
  const dest = join(ROOT, 'public', url)
  mkdirSync(dirname(dest), { recursive: true })
  if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(source).mtimeMs) {
    if (isJpeg) await sharp(source, { limitInputPixels: false }).webp({ quality: 82 }).toFile(dest)
    else copyFileSync(source, dest)
  }
  const meta = await sharp(source, { limitInputPixels: false }).metadata()
  const scale = pick.m[4] === '@2x' ? 0.5 : 1
  const sprite = {
    url,
    width: (meta.width ?? 0) * scale,
    height: (meta.height ?? 0) * scale,
    additive: pick.m[2] === '+' || pick.m[2] === '~',
  }
  spriteCache.set(name, sprite)
  return sprite
}

// ---------------------------------------------------------------------------
// Assemble the output.

/** Every stellar object, depth first. @param {any[]} objects @returns {any[]} */
const flatten = objects => objects.flatMap(o => [o, ...flatten(o.children)])

const planetSystem = new Map()
for (const s of systems.values())
  for (const o of flatten(s.objects))
    if (o.name) planetSystem.set(o.name, s.name)

/** @param {any} p */
function isInhabited(p) {
  const hasServices = p.spaceport.length || p.port || p.shipyards.length || p.outfitters.length
  return Boolean((hasServices || p.requiredReputation || p.tribute?.fleet) && !p.attributes.includes('uninhabited'))
}

mkdirSync(OUT_DATA, { recursive: true })

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
  outStars[s.sprite] = { icon: await exportSprite(s.icon), power: s.power, wind: s.wind }

const links = new Map()
for (const s of systems.values())
  for (const other of s.links)
    if (systems.has(other)) {
      const key = [s.name, other].sort().join('\u0000')
      links.set(key, [s.name, other].sort())
    }

const commit = git('rev-parse --short HEAD')
const galaxy = {
  source: {
    path: ES,
    describe: git('describe --tags --always --dirty'),
    commit,
    branch: git('rev-parse --abbrev-ref HEAD'),
    date: git('log -1 --format=%cI'),
    extracted: new Date().toISOString(),
  },
  galaxies: outGalaxies,
  governments: Object.fromEntries([...governments.values()].map(g => [g.name, { displayName: g.displayName, color: g.color }])),
  commodities,
  stars: outStars,
  systems: [...systems.values()].map(s => ({ ...s, stars: flatten(s.objects).map(o => o.sprite).filter(sp => sp?.startsWith('star/')) })),
  links: [...links.values()],
  planets: [...planets.values()].map(p => ({ ...p, system: planetSystem.get(p.name) ?? null, inhabited: isInhabited(p) })),
  wormholes: [...wormholes.values()],
}

writeFileSync(join(OUT_DATA, 'galaxy.json'), JSON.stringify(galaxy))
console.log(`Extracted ${galaxy.systems.length} systems, ${galaxy.links.length} links, ${galaxy.planets.length} planets, `
  + `${galaxy.wormholes.length} wormholes and ${outGalaxies.length} galaxy sprites from ${ES} (${galaxy.source.describe}).`)
if (duplicates.length) console.log(`Merged repeat definitions: ${duplicates.join(', ')}`)
