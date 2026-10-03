// The versions of the game the extractor has stored, as listed in
// public/data/versions.json: stable releases, and whatever else was extracted
// on purpose (a development branch, a pull request, a local check-out).

/**
 * @typedef {{ id: string, file: string, describe: string, kind: 'release' | 'ref' | 'local',
 *   stable: boolean, commit: string | null, date: string | null, extracted: string }} Version
 */

/** A version tag such as "v0.10.16" as numbers, or null. @param {string} tag */
export function versionNumbers(tag) {
  const m = tag.match(/^v(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/)
  return m ? m.slice(1).map(n => Number(n ?? 0)) : null
}

/** Newest first. @param {string} a @param {string} b */
export function compareTags(a, b) {
  const [x, y] = [versionNumbers(a) ?? [], versionNumbers(b) ?? []]
  for (let i = 0; i < 4; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  return 0
}

/**
 * The newest stable releases, from GitHub's list of releases: those not
 * marked as pre-releases, which is the project's own judgement (v0.11.0 was a
 * pre-release, though its number is even).
 * @param {{ tag_name: string, prerelease: boolean, draft: boolean }[]} releases
 * @param {number} count
 */
export function stableReleases(releases, count) {
  return releases
    .filter(r => !r.prerelease && !r.draft && versionNumbers(r.tag_name))
    .map(r => r.tag_name)
    .sort(compareTags)
    .slice(0, count)
}

/**
 * Without GitHub's list, a guess from the numbers: stable releases have an
 * even last number. Not always right, as for v0.11.0.
 * @param {string[]} tags @param {number} count
 */
export function stableByNumber(tags, count) {
  return tags.filter(t => (versionNumbers(t)?.[2] ?? 1) % 2 === 0 && versionNumbers(t)?.[3] === 0)
    .sort(compareTags)
    .slice(0, count)
}

/** A name safe for a file, from a ref or description. @param {string} name */
export const versionId = name => name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')

/**
 * Stable releases first, newest first; then everything else, newest first.
 * @param {Version[]} versions
 */
export function sortVersions(versions) {
  const stable = versions.filter(v => v.stable).sort((a, b) => compareTags(a.id, b.id))
  const others = versions.filter(v => !v.stable).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  return [...stable, ...others]
}

/** The version to show by default: the newest stable release, if any. @param {Version[]} versions */
export function defaultVersion(versions) {
  return sortVersions(versions)[0]?.id ?? null
}

/**
 * What to compare a version with by default: the stable release before it,
 * or for anything else, the newest stable release that isn't it.
 * @param {Version[]} versions @param {string} id
 * @returns {string | null}
 */
export function defaultComparison(versions, id) {
  const stable = sortVersions(versions).filter(v => v.stable)
  const at = stable.findIndex(v => v.id === id)
  if (at >= 0) return stable[at + 1]?.id ?? null
  return stable.find(v => v.id !== id)?.id ?? null
}
