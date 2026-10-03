// Which versions count as stable, how they're ordered, and which is shown and
// compared with by default.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareTags, defaultComparison, defaultVersion, sortVersions, stableByNumber, stableReleases, versionId } from '../src/lib/data/versions.js'

// As GitHub lists them in October 2026.
const releases = [
  ['continuous', true], ['v0.11.3', true], ['v0.11.2', false], ['v0.11.1', true], ['v0.11.0', true],
  ['v0.10.16', false], ['v0.10.15', true], ['v0.10.14', false], ['v0.10.13.1', true], ['v0.10.12', false],
].map(([tag_name, prerelease]) => ({ tag_name: String(tag_name), prerelease: Boolean(prerelease), draft: false }))

test('stable releases are those GitHub doesn\'t mark as pre-releases', () => {
  assert.deepEqual(stableReleases(releases, 3), ['v0.11.2', 'v0.10.16', 'v0.10.14'])
})

test('without GitHub, even numbers are a guess, wrong for v0.11.0', () => {
  assert.deepEqual(stableByNumber(releases.map(r => r.tag_name), 3), ['v0.11.2', 'v0.11.0', 'v0.10.16'])
})

test('orders tags by their numbers, not as text', () => {
  assert.deepEqual(['v0.10.9', 'v0.10.16', 'v0.11.2', 'v0.10.13.1', 'v0.10.13'].sort(compareTags),
    ['v0.11.2', 'v0.10.16', 'v0.10.13.1', 'v0.10.13', 'v0.10.9'])
})

test('makes a ref safe as a file name', () => {
  assert.equal(versionId('pull/12766/head'), 'pull-12766-head')
  assert.equal(versionId('v0.11.2'), 'v0.11.2')
})

/** @param {string} id @param {boolean} stable @param {string} date */
const version = (id, stable, date) => ({ id, file: `versions/${id}.json`, describe: id, kind: /** @type {const} */ (stable ? 'release' : 'ref'), stable, commit: null, date, extracted: date })
const stored = [version('master', false, '2026-10-02'), version('v0.10.16', true, '2025-10-25'), version('v0.11.2', true, '2026-06-27'), version('v0.10.14', true, '2025-06-28')]

test('lists stable releases newest first, then the rest', () => {
  assert.deepEqual(sortVersions(stored).map(v => v.id), ['v0.11.2', 'v0.10.16', 'v0.10.14', 'master'])
})

test('shows the newest stable release by default', () => {
  assert.equal(defaultVersion(stored), 'v0.11.2')
})

test('compares a release with the one before, and anything else with the newest', () => {
  assert.equal(defaultComparison(stored, 'v0.11.2'), 'v0.10.16')
  assert.equal(defaultComparison(stored, 'v0.10.14'), null)
  assert.equal(defaultComparison(stored, 'master'), 'v0.11.2')
})
