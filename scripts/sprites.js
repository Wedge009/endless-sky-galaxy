// Sprites. A sprite name like "label/core" refers to an image file such as
// images/label/core+.png. As ImageFileData reads a file name: "@2x" marks a
// high-DPI variant and "@sw" a swizzle mask (not an image); then trailing
// digits are a frame number only when a blend mark comes before them ('-'
// normal, '+' additive, '^' or '~' half-additive, '=' pre-multiplied), and a
// blend mark alone means frame 0. So "g0" is a star sprite, not frame 0 of
// "g". The extractor uses the first frame of an animation.

const IMAGE = /\.(png|jpe?g|webp|avif)$/i
const BLEND = new Set(['-', '^', '+', '=', '~'])
/** @param {string} file */
export function parseImageFile(file) {
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
