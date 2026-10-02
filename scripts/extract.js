// Extract the galaxy from an Endless Sky check-out into public/data/galaxy.json,
// copying the sprites the viewer needs into public/sprites/.
//
//   npm run extract [-- /path/to/endless-sky] [--compare <ref> | --compare none]
//   npm run extract -- --ref <ref> [--repo <url>] [--compare <ref> | --compare none]
//
// The first form reads a local check-out: ../endless-sky by default (or
// $ES_PATH). Any branch, tag or working tree can be pointed at, which is how
// development versions are viewed.
//
// The second fetches a branch, tag or pull request (pull/<n>/head) from GitHub
// into a sparse, shallow check-out under .cache/, so no local clone is needed.
// The repository defaults to upstream; --repo picks a fork.
//
// Another version is also extracted, into public/data/compare.json, for the
// viewer to show what has changed since: by default the latest release, or for
// a release, the one before it. Only its data is read, not its sprites.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fetchRef, releaseTags, UPSTREAM } from './fetchRef.js'
import { readGalaxy } from './readGalaxy.js'
import { choiceLabels } from './eventChoices.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache', 'endless-sky')
const OUT_DATA = join(ROOT, 'public', 'data')

const args = parseArgs({
  allowPositionals: true,
  options: { ref: { type: 'string' }, repo: { type: 'string' }, compare: { type: 'string' } },
})
const { ref, repo = UPSTREAM } = args.values
if (ref && args.positionals.length) {
  console.error('Give either a check-out path or --ref, not both.')
  process.exit(1)
}

/** @param {string} target @returns {ReturnType<typeof fetchRef>} */
function fetchOrExit(target) {
  try {
    return fetchRef({ ref: target, repo, dir: CACHE })
  } catch {
    // git has already said why on stderr.
    console.error(`Couldn't fetch ${target} from ${repo}.`)
    process.exit(1)
  }
}

/** @param {string} es @param {string} command */
function git(es, command) {
  try {
    return execSync(`git -C "${es}" ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return null
  }
}

/** @param {string} es */
function checkCheckout(es) {
  if (!existsSync(join(es, 'data')) || !existsSync(join(es, 'images'))) {
    console.error(`Not an Endless Sky checkout (no data/ and images/): ${es}`)
    process.exit(1)
  }
}

/**
 * Where a version came from, for the viewer's version label.
 * @param {string} es @param {string | undefined} fetchedAs @param {{ tag: string | null } | null} fetched
 */
function sourceOf(es, fetchedAs, fetched) {
  const commit = git(es, 'rev-parse --short HEAD')
  return {
    path: fetchedAs ? repo : es,
    // A shallow fetch has no tags to describe from, so name it by its tag if
    // it has one, or else by the ref it was fetched as.
    describe: fetched ? fetched.tag ?? `${fetchedAs}-g${commit}` : git(es, 'describe --tags --always --dirty'),
    commit,
    branch: fetchedAs ?? git(es, 'rev-parse --abbrev-ref HEAD'),
    date: git(es, 'log -1 --format=%cI'),
    extracted: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// The version to compare against. For a local check-out, the tag is only
// known if it's checked out exactly at one; asking now, before anything is
// fetched, keeps that cheap.

const local = ref ? null : resolve(args.positionals[0] ?? process.env.ES_PATH ?? join(ROOT, '..', 'endless-sky'))
if (local) checkCheckout(local)
const currentTag = ref ? (/^v\d+\.\d+\.\d+$/.test(ref) ? ref : null) : git(local ?? '', 'describe --tags --exact-match')

let compareRef = args.values.compare
if (compareRef === undefined) {
  try {
    const releases = releaseTags(repo)
    const at = currentTag ? releases.indexOf(currentTag) : -1
    compareRef = at >= 0 ? releases[at + 1] : releases[0]
  } catch {
    console.log(`Couldn't list the releases of ${repo}, so nothing to compare against.`)
  }
}
if (compareRef === 'none' || compareRef === currentTag) compareRef = undefined

mkdirSync(OUT_DATA, { recursive: true })

// The comparison first, as the sparse check-out is then left at the version
// being viewed.
if (compareRef) {
  const fetched = fetchOrExit(compareRef)
  const { galaxy } = await readGalaxy(CACHE, { root: ROOT, sprites: false })
  const { galaxies, stars, commodities, ...data } = galaxy
  writeFileSync(join(OUT_DATA, 'compare.json'), JSON.stringify({ source: sourceOf(CACHE, compareRef, fetched), ...data }))
  console.log(`Compared against ${fetched.tag ?? compareRef}: ${galaxy.systems.length} systems, ${galaxy.links.length} links, ${galaxy.planets.length} planets.`)
} else {
  rmSync(join(OUT_DATA, 'compare.json'), { force: true })
}

const fetched = ref ? fetchOrExit(ref) : null
const ES = ref ? CACHE : /** @type {string} */ (local)
checkCheckout(ES)
const { galaxy, duplicates, analysis, settled } = await readGalaxy(ES, { root: ROOT, sprites: true })
const output = { source: sourceOf(ES, ref, fetched), ...galaxy }
writeFileSync(join(OUT_DATA, 'galaxy.json'), JSON.stringify(output))

// ---------------------------------------------------------------------------
// Report.

console.log(`Extracted ${galaxy.systems.length} systems, ${galaxy.links.length} links, ${galaxy.planets.length} planets, `
  + `${galaxy.wormholes.length} wormholes and ${galaxy.galaxies.length} galaxy sprites from ${ES} (${output.source.describe}).`)
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
