// Tiling the Milky Way (scripts/tiles.js).

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { planTiles, TILE_OVERLAP, TILE_SIZE, tileSet, writeTiles } from '../scripts/tiles.js'

test('tiles cover the image once, overlapping only for filtering', () => {
  const [width, height] = [1300, 600]
  const covered = new Uint8Array(width * height)
  for (const { crop: [x, y, w, h], core: [l, t, r, b] } of planTiles(width, height)) {
    // Cut on JPEG block boundaries, within the image.
    assert.equal(x % 16, 0)
    assert.equal(y % 16, 0)
    assert.ok(x + w <= width && y + h <= height)
    // Reaching into each neighbour by the overlap, and no further.
    assert.equal(l, x === 0 ? 0 : TILE_OVERLAP)
    assert.equal(t, y === 0 ? 0 : TILE_OVERLAP)
    assert.equal(w - r, x + w === width ? 0 : TILE_OVERLAP)
    assert.equal(h - b, y + h === height ? 0 : TILE_OVERLAP)
    assert.ok(r - l <= TILE_SIZE && b - t <= TILE_SIZE)
    for (let py = y + t; py < y + b; py++) for (let px = x + l; px < x + r; px++) covered[py * width + px]++
  }
  assert.ok(covered.every(n => n === 1))
})

let hasJpegtran = true
try {
  execFileSync('jpegtran', ['-version'], { stdio: 'ignore' })
} catch {
  hasJpegtran = false
}

// With chroma sub-sampling, the decoder smooths colour across blocks, so the
// pixels at a cut differ a little; those are in the overlap, which is never
// drawn. Without it (as the Milky Way is saved), every pixel is the same.
for (const chromaSubsampling of ['4:4:4', '4:2:0'])
  test(`tiles draw exactly the original pixels (${chromaSubsampling})`, { skip: !hasJpegtran && 'needs jpegtran' }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tiles-'))
    try {
      const [width, height] = [1100, 700]
      const noise = Buffer.alloc(width * height * 3)
      for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
      const source = join(dir, 'source.jpg')
      await sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 80, chromaSubsampling }).toFile(source)
      const original = await sharp(source).raw().toBuffer()

      const set = tileSet(width, height)
      await writeTiles(source, join(dir, 'out'), set)
      for (const { crop: [x, y, w, h], core, file } of set.tiles) {
        const [l, t, r, b] = chromaSubsampling === '4:4:4' ? [0, 0, w, h] : core
        const tile = await sharp(join(dir, 'out', file)).raw().toBuffer()
        for (let row = t; row < b; row++) {
          const start = ((y + row) * width + x + l) * 3
          assert.ok(tile.subarray((row * w + l) * 3, (row * w + r) * 3).equals(original.subarray(start, start + (r - l) * 3)), `${file} row ${row}`)
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
