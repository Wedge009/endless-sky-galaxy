// Extract the galaxy from an Endless Sky check-out into public/data/galaxy.json,
// copying the sprites the viewer needs into public/sprites/.
//
//   npm run extract [-- /path/to/endless-sky]
//   npm run extract -- --ref <ref> [--repo <url>]
//
// The first form reads a local check-out: ../endless-sky by default (or
// $ES_PATH). Any branch, tag or working tree can be pointed at, which is how
// development versions are viewed.
//
// The second fetches a branch, tag or pull request (pull/<n>/head) from GitHub
// into a sparse, shallow check-out under .cache/, so no local clone is needed.
// The repository defaults to upstream; --repo picks a fork.
//
// The galaxy's state is the top-level definitions in data/, before any mission
// event has added, removed or changed anything. Alongside it, the events that
// change what the viewer shows are classified by scripts/events.js: assumed to
// have happened, or hanging on one of a few story choices.

import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { parseDataFile } from './dataFile.js'
import { fetchRef, UPSTREAM } from './fetchRef.js'
import { analyseEvents } from './events.js'
import { choiceLabels } from './eventChoices.js'
import { finishGalaxy, loadPlanet, loadSystem } from '../src/lib/data/universe.js'
import { applyEvents, eventsToApply } from '../src/lib/data/applyEvents.js'

/** @typedef {import('./dataFile.js').DataNode} DataNode */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs({
  allowPositionals: true,
  options: { ref: { type: 'string' }, repo: { type: 'string' } },
})
const { ref, repo = UPSTREAM } = args.values
if (ref && args.positionals.length) {
  console.error('Give either a check-out path or --ref, not both.')
  process.exit(1)
}
const CACHE = join(ROOT, '.cache', 'endless-sky')
let fetched = null
if (ref) {
  try {
    fetched = fetchRef({ ref, repo, dir: CACHE })
  } catch {
    // git has already said why on stderr.
    console.error(`Couldn't fetch ${ref} from ${repo}.`)
    process.exit(1)
  }
}
const ES = ref ? CACHE
  : resolve(args.positionals[0] ?? process.env.ES_PATH ?? join(ROOT, '..', 'endless-sky'))
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
  // Copied as they are, not re-encoded: the viewer zooms in much further than
  // the game, so any detail lost to compression shows.
  const ext = pick.m[5].toLowerCase()
  const url = `sprites/${name.replace(/[^\w/-]+/g, '_')}.${ext}`
  const dest = join(ROOT, 'public', url)
  mkdirSync(dirname(dest), { recursive: true })
  if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(source).mtimeMs) {
    copyFileSync(source, dest)
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

const finished = finishGalaxy(systems.values(), planets.values())

// ---------------------------------------------------------------------------
// Events. Those that matter change a system as the map shows it, a link, a
// region label, or a planet; changes to fleets, shops' stock and the like
// don't show.

const MAP_KEYS = new Set(['pos', 'government', 'link', 'hidden', 'shrouded', 'inaccessible', 'object', 'attributes'])
/** @param {DataNode} event */
function isRelevant(event) {
  return event.children.some(c => ['link', 'unlink', 'galaxy', 'planet'].includes(c.tokens[0])
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
    .filter(c => ['system', 'planet', 'link', 'unlink'].includes(c.tokens[0]))
    .map(bare)
}

const commit = git('rev-parse --short HEAD')
const galaxy = {
  source: {
    path: ref ? repo : ES,
    // A shallow fetch has no tags to describe from, so name it by its tag if
    // it has one, or else by the ref it was fetched as.
    describe: fetched ? fetched.tag ?? `${ref}-g${commit}` : git('describe --tags --always --dirty'),
    commit,
    branch: ref ?? git('rev-parse --abbrev-ref HEAD'),
    date: git('log -1 --format=%cI'),
    extracted: new Date().toISOString(),
  },
  galaxies: outGalaxies,
  governments: Object.fromEntries([...governments.values()].map(g => [g.name, { displayName: g.displayName, color: g.color }])),
  commodities,
  stars: outStars,
  systems: finished.systems,
  links: finished.links,
  planets: finished.planets,
  wormholes: [...wormholes.values()],
  events: analysis.events,
  choices: analysis.choices,
}

// A choice is only worth offering if its outcomes still differ once every
// event is applied: later events often settle a branch either way, leaving
// at most a reworded description or a different rate of fleets. Such a choice
// takes its default.
/** @param {any} a @param {any} b */
function differs(a, b) {
  const key = (/** @type {string[]} */ l) => l.join('\u0000')
  const links = new Set(a.links.map(key))
  if (a.links.length !== b.links.length || b.links.some((/** @type {string[]} */ l) => !links.has(key(l)))) return true
  // Fleets, minables and hazards are shown by name only, not how often or how many.
  const names = (/** @type {any[]} */ list) => list.map(x => x.name).sort()
  const shown = (/** @type {any} */ s) => JSON.stringify({ ...s, fleets: names(s.fleets), minables: names(s.minables), hazards: names(s.hazards) })
  if (a.systems.some((/** @type {any} */ s, /** @type {number} */ i) => shown(s) !== shown(b.systems[i]))) return true
  const strip = (/** @type {any} */ p) => JSON.stringify({ ...p, description: null, spaceport: null, port: p.port && { ...p.port, description: null } })
  return a.planets.some((/** @type {any} */ p, /** @type {number} */ i) => strip(p) !== strip(b.planets[i]))
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

writeFileSync(join(OUT_DATA, 'galaxy.json'), JSON.stringify(galaxy))
console.log(`Extracted ${galaxy.systems.length} systems, ${galaxy.links.length} links, ${galaxy.planets.length} planets, `
  + `${galaxy.wormholes.length} wormholes and ${outGalaxies.length} galaxy sprites from ${ES} (${galaxy.source.describe}).`)
if (duplicates.length) console.log(`Merged repeat definitions: ${duplicates.join(', ')}`)

const byStatus = Object.groupBy(Object.values(galaxy.events), (/** @type {any} */ e) => e.status)
console.log(`Events that change the map or planets: ${Object.keys(galaxy.events).length} (`
  + Object.entries(byStatus).map(([status, list]) => `${list?.length} ${status}`).join(', ') + ')')
for (const c of galaxy.choices)
  console.log(`  Choice: ${c.label ?? c.key}: ${c.options.map((/** @type {any} */ o) => `${o.label ?? o.id}${o.id === c.default ? '*' : ''} (${o.events.length})`).join(' / ')}`)
if (settled.length) console.log(`  Settled either way by later events, so not offered: ${settled.join('; ')}`)
const unnamed = galaxy.choices.filter((/** @type {any} */ c) => !c.label)
if (unnamed.length) console.log(`  Choices with no name in scripts/eventChoices.js: ${unnamed.map((/** @type {any} */ c) => c.key).join('; ')}`)
const stale = Object.keys(choiceLabels).filter(key => !analysis.choices.some((/** @type {any} */ c) => c.key === key))
if (stale.length) console.log(`  Names in scripts/eventChoices.js matching no choice: ${stale.join('; ')}`)
