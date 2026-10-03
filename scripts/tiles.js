// The Milky Way back-drop, 4096 pixels square and 9-13 MB as a JPEG, split so
// the viewer can open with a small overview and fetch the full-resolution
// tiles only for what's on screen once zoomed in far enough to need them.
//
// The tiles are cut with jpegtran, which copies the JPEG's compressed blocks
// unchanged, so they're exactly the original's pixels: re-encoding the image
// (as WebP at quality 82, once) visibly blurred it at deep zoom. Only the
// overview is re-encoded, and it's only drawn smaller than its own size.

import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

/** A JPEG larger than this on either side is tiled. */
export const TILE_OVER = 2048
/** Each tile's own area, in pixels. */
export const TILE_SIZE = 512
/**
 * What each tile repeats of its neighbours, so filtering at a tile's edge
 * blends with the pixels beyond it, as one texture would, rather than
 * clamping to the edge and showing a seam. Cuts must start on a JPEG block
 * boundary for jpegtran to copy blocks as they are: 16 pixels with chroma
 * subsampling, 8 without, so this and TILE_SIZE are multiples of 16.
 */
export const TILE_OVERLAP = 16
/** The overview's longest side, and its encoding. */
const OVERVIEW_SIZE = 2048
const OVERVIEW_AS = { quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }

/**
 * @typedef {{ crop: number[], core: number[] }} TilePlan
 * `crop`: x, y, width, height of the tile's image in the full image;
 * `core`: left, top, right, bottom of the area it draws, within `crop`.
 */

/**
 * @param {number} width @param {number} height  the full image's size
 * @returns {TilePlan[]} row by row, from the top left
 */
export function planTiles(width, height) {
  const tiles = []
  for (let y0 = 0; y0 < height; y0 += TILE_SIZE)
    for (let x0 = 0; x0 < width; x0 += TILE_SIZE) {
      const x1 = Math.min(width, x0 + TILE_SIZE)
      const y1 = Math.min(height, y0 + TILE_SIZE)
      const cx = Math.max(0, x0 - TILE_OVERLAP)
      const cy = Math.max(0, y0 - TILE_OVERLAP)
      const cw = Math.min(width, x1 + TILE_OVERLAP) - cx
      const ch = Math.min(height, y1 + TILE_OVERLAP) - cy
      tiles.push({ crop: [cx, cy, cw, ch], core: [x0 - cx, y0 - cy, x1 - cx, y1 - cy] })
    }
  return tiles
}

/**
 * The files a tiled image is stored as, and what each holds.
 * @param {number} width @param {number} height  the full image's size
 * @returns {{ overview: { file: string, width: number, height: number }, tiles: (TilePlan & { file: string })[] }}
 */
export function tileSet(width, height) {
  const scale = Math.min(1, OVERVIEW_SIZE / Math.max(width, height))
  return {
    overview: { file: 'overview.jpg', width: Math.round(width * scale), height: Math.round(height * scale) },
    tiles: planTiles(width, height).map(plan => ({ ...plan, file: `${plan.crop[0]}-${plan.crop[1]}.jpg` })),
  }
}

/**
 * Write a JPEG's overview and tiles (tileSet) into `dir`, which is created.
 * @param {string} source @param {string} dir @param {ReturnType<typeof tileSet>} set
 */
export async function writeTiles(source, dir, { overview, tiles }) {
  // Into a temporary directory first, so an interrupted run leaves nothing
  // that looks complete.
  const temp = `${dir}.part`
  rmSync(temp, { recursive: true, force: true })
  mkdirSync(temp, { recursive: true })

  await sharp(source, { limitInputPixels: false })
    .resize(overview.width, overview.height)
    .jpeg(OVERVIEW_AS)
    .toFile(join(temp, overview.file))

  for (const { crop, file } of tiles) {
    const [x, y, w, h] = crop
    try {
      execFileSync('jpegtran', ['-crop', `${w}x${h}+${x}+${y}`, '-copy', 'none', '-optimize', '-outfile', join(temp, file), source])
    } catch (error) {
      if (/** @type {any} */ (error).code === 'ENOENT')
        throw new Error('Tiling the Milky Way needs jpegtran, from libjpeg-turbo (Debian and Ubuntu: libjpeg-turbo-progs).')
      throw error
    }
    // jpegtran moves a cut that doesn't start on a block boundary, which
    // would shift the tile against its neighbours.
    const meta = await sharp(join(temp, file)).metadata()
    if (meta.width !== w || meta.height !== h)
      throw new Error(`jpegtran cut ${source} at ${x}, ${y} to ${meta.width}x${meta.height}, not ${w}x${h}`)
  }
  renameSync(temp, dir)
}
