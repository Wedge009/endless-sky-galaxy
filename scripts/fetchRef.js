// Fetch any ref of the game's repository into a sparse, shallow check-out
// holding only what the extractor reads: about 200 MB, against about 1 GB for
// a full clone.
//
// The check-out is kept and re-used, so moving to another ref fetches only
// the files that differ. Blobs are fetched lazily (a partial clone), so the
// images outside the sparse set are never downloaded.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const UPSTREAM = 'https://github.com/endless-sky/endless-sky.git'

/** Everything extract.js reads: the data files and the sprites it exports. */
const SPARSE = ['data', 'images/map', 'images/label', 'images/ui', 'images/planet', 'images/star']

/**
 * @param {string} dir
 * @param {string[]} args
 * @param {{ quiet?: boolean }} [options]
 */
function git(dir, args, { quiet = false } = {}) {
  return execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] })
    .toString().trim()
}

/**
 * Check out `ref` from `repo` into `dir`, creating the check-out if need be.
 * `ref` is anything the remote advertises: a branch, a tag, or a pull request
 * as `pull/<n>/head`. A full commit hash also works on GitHub.
 * @param {{ ref: string, repo?: string, dir: string }} options
 * @returns {{ commit: string, tag: string | null }}
 */
export function fetchRef({ ref, repo = UPSTREAM, dir }) {
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true })
    git(dir, ['init', '--quiet'])
    git(dir, ['remote', 'add', 'origin', repo])
    // Set up a partial clone by hand, since `git clone` can't start from an
    // arbitrary ref such as a pull request.
    git(dir, ['config', 'remote.origin.promisor', 'true'])
    git(dir, ['config', 'remote.origin.partialclonefilter', 'blob:none'])
  } else {
    git(dir, ['remote', 'set-url', 'origin', repo])
  }
  // Every time, so a check-out made before the set grew picks up the rest.
  git(dir, ['sparse-checkout', 'set', ...SPARSE])

  console.log(`Fetching ${ref} from ${repo}...`)
  git(dir, ['fetch', '--depth=1', '--filter=blob:none', '--no-tags', 'origin', ref])
  git(dir, ['checkout', '--quiet', '--detach', '--force', 'FETCH_HEAD'])
  const commit = git(dir, ['rev-parse', 'HEAD'])

  // A shallow check-out has no tags to describe itself with, so ask the
  // remote whether a release tag points at this commit. Only version tags
  // count: upstream also moves a "continuous" tag along master for CI builds.
  let tag = null
  try {
    const tags = git(dir, ['ls-remote', '--tags', 'origin'], { quiet: true }).split('\n')
      .map(line => line.split('\t'))
      // Annotated tags are matched through their peeled "^{}" entry.
      .map(([hash, name]) => [hash, name?.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '')])
    tag = tags.find(([hash, name]) => hash === commit && /^v?\d/.test(name ?? ''))?.[1] ?? null
  } catch {}
  return { commit, tag }
}

/**
 * The repository's release tags, newest first: vX.Y.Z only, so neither the
 * "continuous" tag nor any pre-release counts.
 * @param {string} [repo]
 * @returns {string[]}
 */
export function releaseTags(repo = UPSTREAM) {
  const out = execFileSync('git', ['ls-remote', '--tags', '--refs', repo], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
  const version = (/** @type {string} */ tag) => tag.slice(1).split('.').map(Number)
  return out.split('\n')
    .map(line => line.split('\t')[1]?.replace(/^refs\/tags\//, ''))
    .filter(tag => tag && /^v\d+\.\d+\.\d+$/.test(tag))
    .sort((a, b) => {
      const [x, y] = [version(a), version(b)]
      return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]
    })
}
