// Extract versions of the galaxy from Endless Sky, each into its own file in
// public/data/versions/, listed in public/data/versions.json, with the sprites
// the viewer needs in public/sprites/.
//
//   npm run extract -- --releases 3              the last three stable releases
//   npm run extract -- --ref <ref> [--repo <url>] a branch, tag or pull request
//   npm run extract [-- /path/to/endless-sky]    a local check-out
//   npm run extract -- --remove <version>        drop a stored version
//   npm run extract -- --list                    what's stored
//
// --releases keeps exactly the newest N stable releases, as GitHub marks them
// (not pre-releases), adding any missing and removing older ones. Other
// versions are kept until removed. A version whose commit hasn't changed isn't
// extracted again, unless --force is given.
//
// --ref fetches from GitHub into a sparse, shallow check-out under .cache/, so
// no local clone is needed; pull requests are pull/<n>/head, and --repo picks a
// fork. A local check-out is ../endless-sky by default, or $ES_PATH.
//
// Sprites are shared by the versions, named by their content, and any no
// stored version uses are removed.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fetchRef, githubReleases, releaseTags, UPSTREAM } from './fetchRef.js'
import { readGalaxy } from './readGalaxy.js'
import { choiceLabels } from './eventChoices.js'
import { defaultVersion, sortVersions, stableByNumber, stableReleases, versionId, versionNumbers } from '../src/lib/data/versions.js'

/** @typedef {import('../src/lib/data/versions.js').Version} Version */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache', 'endless-sky')
const OUT_DATA = join(ROOT, 'public', 'data')
const OUT_VERSIONS = join(OUT_DATA, 'versions')
const OUT_SPRITES = join(ROOT, 'public', 'sprites')
const INDEX = join(OUT_DATA, 'versions.json')

const args = parseArgs({
  allowPositionals: true,
  options: {
    ref: { type: 'string', multiple: true },
    repo: { type: 'string' },
    releases: { type: 'string' },
    remove: { type: 'string', multiple: true },
    force: { type: 'boolean' },
    list: { type: 'boolean' },
  },
})
const { repo = UPSTREAM, force = false } = args.values
const refs = args.values.ref ?? []

/** @param {string} es @param {string} command */
function git(es, command) {
  try {
    return execSync(`git -C "${es}" ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return null
  }
}

/** @param {string} es */
function isCheckout(es) {
  return existsSync(join(es, 'data')) && existsSync(join(es, 'images'))
}

// ---------------------------------------------------------------------------
// The index of stored versions.

/** @type {Version[]} */
let versions = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')).versions : []

function saveIndex() {
  versions = sortVersions(versions)
  mkdirSync(OUT_DATA, { recursive: true })
  writeFileSync(INDEX, JSON.stringify({ versions, default: defaultVersion(versions) }, null, 1))
}

/** @param {string} id */
function removeVersion(id) {
  const version = versions.find(v => v.id === id)
  if (!version) return false
  rmSync(join(OUT_DATA, version.file), { force: true })
  versions = versions.filter(v => v !== version)
  console.log(`Removed ${id}.`)
  return true
}

if (args.values.list) {
  for (const v of sortVersions(versions))
    console.log(`${v.id.padEnd(22)} ${v.stable ? 'stable ' : v.kind.padEnd(7)} ${v.commit ?? ''} ${v.date?.slice(0, 10) ?? ''}`)
  if (!versions.length) console.log('No versions stored yet.')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Extracting one version.

/**
 * Extract a version, unless it's stored already at the same commit.
 * @param {{ ref?: string, local?: string, stable?: boolean }} what
 */
async function extract({ ref, local, stable = false }) {
  let es = CACHE
  let tag = null
  if (ref) {
    let fetched
    try {
      fetched = fetchRef({ ref, repo, dir: CACHE })
    } catch {
      // git has already said why on stderr.
      console.error(`Couldn't fetch ${ref} from ${repo}.`)
      process.exitCode = 1
      return
    }
    tag = fetched.tag
  } else {
    es = /** @type {string} */ (local)
    if (!isCheckout(es)) {
      console.error(`Not an Endless Sky check-out (no data/ and images/): ${es}`)
      process.exitCode = 1
      return
    }
  }

  const commit = git(es, 'rev-parse --short HEAD')
  // A shallow fetch has no tags to describe from, so it's named by its tag if
  // it has one, or else by the ref it was fetched as.
  const describe = ref ? tag ?? `${ref}-g${commit}` : git(es, 'describe --tags --always --dirty') ?? 'local'
  const id = versionId(ref ? tag ?? ref : describe)
  const kind = ref ? (tag && versionNumbers(tag) ? 'release' : 'ref') : 'local'
  const known = versions.find(v => v.id === id)
  if (known && known.commit === commit && !force && existsSync(join(OUT_DATA, known.file))) {
    known.stable = stable || known.stable
    console.log(`${id} is up to date (${commit}).`)
    return
  }

  const { galaxy, duplicates, analysis, settled } = await readGalaxy(es, { root: ROOT, sprites: true })
  const source = {
    path: ref ? repo : es,
    describe,
    commit,
    branch: ref ?? git(es, 'rev-parse --abbrev-ref HEAD'),
    date: git(es, 'log -1 --format=%cI'),
    extracted: new Date().toISOString(),
  }
  const file = `versions/${id}.json`
  mkdirSync(OUT_VERSIONS, { recursive: true })
  writeFileSync(join(OUT_DATA, file), JSON.stringify({ source, ...galaxy }))
  versions = versions.filter(v => v.id !== id)
  versions.push({ id, file, describe, kind, stable, commit, date: source.date, extracted: source.extracted })

  console.log(`Extracted ${id}: ${galaxy.systems.length} systems, ${galaxy.links.length} links, ${galaxy.planets.length} planets, `
    + `${galaxy.wormholes.length} wormholes and ${galaxy.galaxies.length} galaxy sprites from ${source.path}.`)
  if (duplicates.length) console.log(`  Merged repeat definitions: ${duplicates.join(', ')}`)
  const byStatus = Object.groupBy(Object.values(galaxy.events), (/** @type {any} */ e) => e.status)
  console.log(`  Events that change the map or planets: ${Object.keys(galaxy.events).length} (`
    + Object.entries(byStatus).map(([status, list]) => `${list?.length} ${status}`).join(', ') + ')')
  for (const c of galaxy.choices)
    console.log(`  Choice: ${c.label ?? c.key}: ${c.options.map((/** @type {any} */ o) => `${o.label ?? o.id}${o.id === c.default ? '*' : ''} (${o.events.length})`).join(' / ')}`)
  if (settled.length) console.log(`  Settled either way by later events, so not offered: ${settled.join('; ')}`)
  const unnamed = galaxy.choices.filter((/** @type {any} */ c) => !c.label)
  if (unnamed.length) console.log(`  Choices with no name in scripts/eventChoices.js: ${unnamed.map((/** @type {any} */ c) => c.key).join('; ')}`)
  const stale = Object.keys(choiceLabels).filter(key => !analysis.choices.some((/** @type {any} */ c) => c.key === key))
  if (stale.length) console.log(`  Names in scripts/eventChoices.js matching no choice: ${stale.join('; ')}`)
}

// ---------------------------------------------------------------------------
// What to do.

for (const id of args.values.remove ?? []) if (!removeVersion(id)) console.log(`No version ${id} is stored.`)

if (args.values.releases !== undefined) {
  const count = Number(args.values.releases)
  const listed = await githubReleases(repo)
  let wanted
  if (listed) wanted = stableReleases(listed, count)
  else {
    console.log(`Couldn't read ${repo}'s releases from GitHub, so guessing the stable ones from their numbers.`)
    wanted = stableByNumber(releaseTags(repo), count)
  }
  console.log(`The newest ${count} stable releases: ${wanted.join(', ')}.`)
  for (const v of versions.filter(v => v.kind === 'release' && v.stable && !wanted.includes(v.id))) removeVersion(v.id)
  for (const tag of wanted) await extract({ ref: tag, stable: true })
}

for (const ref of refs) await extract({ ref })

const nothingElse = !refs.length && args.values.releases === undefined && !args.values.remove?.length
if (nothingElse || args.positionals.length)
  await extract({ local: resolve(args.positionals[0] ?? process.env.ES_PATH ?? join(ROOT, '..', 'endless-sky')) })

saveIndex()

// ---------------------------------------------------------------------------
// Tidy up: the single files of before stored versions, and sprites no
// stored version uses.

for (const old of ['galaxy.json', 'compare.json']) rmSync(join(OUT_DATA, old), { force: true })

/** Every sprite a stored version refers to. */
const used = new Set()
for (const v of versions) {
  const text = existsSync(join(OUT_DATA, v.file)) ? readFileSync(join(OUT_DATA, v.file), 'utf8') : ''
  for (const m of text.matchAll(/"url":"(sprites\/[^"]+)"/g)) used.add(m[1])
}
/** @param {string} dir @returns {number} files removed */
function prune(dir) {
  if (!existsSync(dir)) return 0
  let removed = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      removed += prune(path)
      if (!readdirSync(path).length) rmdirSync(path)
    } else if (!used.has(relative(join(ROOT, 'public'), path).split('\\').join('/'))) {
      rmSync(path)
      removed++
    }
  }
  return removed
}
const pruned = prune(OUT_SPRITES)
if (pruned) console.log(`Removed ${pruned} sprites no stored version uses.`)
console.log(`Stored: ${versions.map(v => v.id).join(', ') || 'nothing'}; shown by default: ${defaultVersion(versions) ?? 'none'}.`)
