// The background of a system as the game draws it in flight (StarField.cpp):
// a field of stars and patches of the system's haze, drawn flat on the screen
// behind everything, following the view with a little parallax. The game
// makes both at random each session; here they're seeded, so a system always
// looks the same, but they're made the same way.

import * as THREE from 'three'

// From StarField.cpp.
const STARS = 16384
const STAR_WRAP = 4096
const HAZE_WRAP = 6627
const HAZE_DISTANCE = 1200
const HAZE_COUNT = 16
const HAZE_SCALE = 8
const STAR_ZOOM = 0.7
const HAZE_ZOOM = 0.9
// The game zooms between these; further out, the background stays as the
// game would draw it at its widest, rather than shrinking to specks.
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2

/** A small seeded generator (mulberry32), for a repeatable field. @param {number} seed */
function random(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** @param {string} text */
const hash = text => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)

const starVertex = /* glsl */ `
  attribute float size;
  attribute float chance;
  uniform vec2 uCenter;
  uniform vec2 uTile;
  uniform float uZoom;
  uniform float uAngle;
  uniform float uDensity;
  uniform float uPixelRatio;
  varying float vAlpha;
  void main() {
    // Only so many stars in a sparse system (System::StarfieldDensity).
    if (chance >= uDensity) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 p = mod(position.xy - uCenter + ${STAR_WRAP / 2}.0, ${STAR_WRAP}.0) - ${STAR_WRAP / 2}.0 + uTile * ${STAR_WRAP}.0;
    float c = cos(uAngle);
    float s = sin(uAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * uZoom;
    gl_Position = projectionMatrix * vec4(p.x, -p.y, 0.0, 1.0);
    // starfield.vert: half-size grows as zoom^0.25, alpha as size and sqrt(zoom).
    gl_PointSize = 2.0 * size * pow(uZoom, 0.25) * uPixelRatio * 1.5;
    vAlpha = min(1.0, sqrt(uZoom)) * size * 0.2 + 0.05;
  }
`
const starFragment = /* glsl */ `
  varying float vAlpha;
  void main() {
    // starfield.frag: a diamond, brightest at its centre. The point is drawn a
    // little larger than the diamond, so it isn't clipped.
    vec2 c = (gl_PointCoord * 2.0 - 1.0) * 1.5;
    float a = vAlpha * (1.0 - abs(c.x) - abs(c.y));
    if (a <= 0.0) discard;
    gl_FragColor = vec4(vec3(a), 1.0);
  }
`

/**
 * @param {any} galaxy
 * @param {THREE.WebGLRenderer} renderer
 */
export function createBackground(galaxy, renderer) {
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1)

  // --- Stars: the game's random walk, so they gather in its wisps -------------
  const next = random(0x5eed)
  const offsets = []
  for (let x = -50; x <= 50; x++)
    for (let y = -50; y <= 50; y++) {
      const d = x * x + y * y
      if (d >= 625 && d <= 2500) offsets.push([x, y])
    }
  const positions = new Float32Array(STARS * 3)
  const sizes = new Float32Array(STARS)
  const chances = new Float32Array(STARS)
  let x = Math.floor(next() * STAR_WRAP)
  let y = Math.floor(next() * STAR_WRAP)
  for (let i = 0; i < STARS; i++) {
    for (let j = 0; j < 10; j++) {
      const [dx, dy] = offsets[Math.floor(next() * offsets.length)]
      x = (x + dx) & (STAR_WRAP - 1)
      y = (y + dy) & (STAR_WRAP - 1)
    }
    positions.set([x + next(), y + next(), 0], i * 3)
    sizes[i] = (Math.floor(next() * 16) + 20) * 0.0625
    chances[i] = next()
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  starGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
  starGeometry.setAttribute('chance', new THREE.BufferAttribute(chances, 1))
  starGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
  const starUniforms = {
    uCenter: { value: new THREE.Vector2() },
    uZoom: { value: 1 },
    uAngle: { value: 0 },
    uDensity: { value: 1 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  }
  // The field repeats every STAR_WRAP; a few tiles around the centre cover
  // the screen at the game's widest zoom.
  /** @type {THREE.Points[]} */
  const starTiles = []
  for (let tx = -2; tx <= 2; tx++)
    for (let ty = -2; ty <= 2; ty++) {
      const material = new THREE.ShaderMaterial({
        vertexShader: starVertex,
        fragmentShader: starFragment,
        uniforms: { ...starUniforms, uTile: { value: new THREE.Vector2(tx, ty) } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const points = new THREE.Points(starGeometry, material)
      points.frustumCulled = false
      scene.add(points)
      starTiles.push(points)
    }

  // --- Haze ---------------------------------------------------------------------
  /** @type {{ x: number, y: number, angle: number }[]} */
  let haze = []
  /** @type {THREE.Mesh[]} */
  const hazePool = []
  /** @type {THREE.MeshBasicMaterial | null} */
  let hazeMaterial = null
  let hazeSize = 400
  const loader = new THREE.TextureLoader()
  const plane = new THREE.PlaneGeometry(1, 1)

  /**
   * Set the background up for a system: its starfield density and its haze,
   * placed as StarField::Init places it, at least HAZE_DISTANCE apart.
   * @param {any} system
   */
  function setSystem(system) {
    starUniforms.uDensity.value = system.starfieldDensity ?? 1
    const next = random(hash(system.name))
    haze = []
    while (haze.length < HAZE_COUNT) {
      const candidate = { x: next() * HAZE_WRAP, y: next() * HAZE_WRAP, angle: next() * Math.PI * 2 }
      const wrapped = (/** @type {number} */ d) => d - HAZE_WRAP * Math.round(d / HAZE_WRAP)
      if (haze.every(h => wrapped(h.x - candidate.x) ** 2 + wrapped(h.y - candidate.y) ** 2 >= HAZE_DISTANCE ** 2))
        haze.push(candidate)
    }
    const sprite = galaxy.sprites[system.haze ?? '_menu/haze'] ?? galaxy.sprites['_menu/haze']
    hazeMaterial?.map?.dispose()
    hazeMaterial?.dispose()
    hazeMaterial = null
    if (sprite) {
      const texture = loader.load(sprite.url)
      texture.colorSpace = THREE.SRGBColorSpace
      hazeMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: sprite.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
      hazeSize = Math.max(sprite.width, sprite.height)
    }
    hazePool.forEach(m => (m.material = /** @type {any} */ (hazeMaterial)))
  }

  /**
   * Draw it for a view centred on `center` (map units), at `zoom` screen
   * pixels per map unit, turned by `angle` radians.
   * @param {number[]} center @param {number} zoom @param {number} angle
   * @param {number} width @param {number} height  in CSS pixels
   */
  function render(center, zoom, angle, width, height) {
    camera.left = -width / 2
    camera.right = width / 2
    camera.top = height / 2
    camera.bottom = -height / 2
    camera.updateProjectionMatrix()
    const base = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

    starUniforms.uCenter.value.set(center[0], center[1])
    starUniforms.uZoom.value = base * STAR_ZOOM
    starUniforms.uAngle.value = angle

    // Every copy of each patch that reaches the screen, as AddHaze does.
    const hz = base * HAZE_ZOOM
    const reach = Math.hypot(width, height) / 2 / hz + hazeSize * HAZE_SCALE
    let used = 0
    if (hazeMaterial)
      for (const h of haze) {
        const startX = center[0] - reach + ((((h.x - (center[0] - reach)) % HAZE_WRAP) + HAZE_WRAP) % HAZE_WRAP)
        const startY = center[1] - reach + ((((h.y - (center[1] - reach)) % HAZE_WRAP) + HAZE_WRAP) % HAZE_WRAP)
        for (let y = startY; y < center[1] + reach; y += HAZE_WRAP)
          for (let x = startX; x < center[0] + reach; x += HAZE_WRAP) {
            let mesh = hazePool[used]
            if (!mesh) {
              mesh = new THREE.Mesh(plane, hazeMaterial)
              mesh.frustumCulled = false
              scene.add(mesh)
              hazePool.push(mesh)
            }
            const dx = x - center[0]
            const dy = y - center[1]
            const c = Math.cos(angle)
            const s = Math.sin(angle)
            mesh.position.set((c * dx - s * dy) * hz, -(s * dx + c * dy) * hz, 0)
            mesh.rotation.z = -(h.angle + angle)
            mesh.scale.setScalar(hazeSize * HAZE_SCALE * hz)
            mesh.renderOrder = -1
            mesh.visible = true
            used++
          }
      }
    for (let i = used; i < hazePool.length; i++) hazePool[i].visible = false

    renderer.render(scene, camera)
  }

  return {
    setSystem,
    render,
    dispose() {
      starGeometry.dispose()
      starTiles.forEach(p => /** @type {THREE.Material} */ (p.material).dispose())
      plane.dispose()
      hazeMaterial?.map?.dispose()
      hazeMaterial?.dispose()
    },
  }
}
