// The 3D galaxy: the game's 2D map laid on the XZ plane, so a system at map
// position (x, y) sits at world (x, 0, y). The map's y axis points down the
// screen, which with the camera looking down -Y puts the galaxy's north at the
// top of the view, as in game. One world unit is one map unit (a pixel at the
// game's 100% map zoom), so sprites are sized by their image dimensions.

import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { flatten } from '../data/universe.js'

// From MapPanel.cpp: the system ring's radii, and the gap links leave around it.
const RING_OUTER = 6
const RING_INNER = 3.5
const LINK_OFFSET = 7
// A system's name shows within this distance of the camera, fading out over the
// last NAME_FADE, like the game hiding names below 50% zoom. Measured per
// system, so a tilted view doesn't crowd its horizon with far-off names.
const NAME_DISTANCE = 1100
const NAME_FADE = 300
const PICK_RADIUS_PX = 12

const ringVertex = /* glsl */ `
  attribute vec3 color;
  attribute float alpha;
  attribute float radius;
  uniform float uScale;
  uniform float uMinPx;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vInner;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float px = radius * 2.0 * uScale / -mv.z;
    // Keep rings legible when zoomed out, without letting them swell up close.
    gl_PointSize = clamp(px, uMinPx, 64.0);
    vColor = color;
    vAlpha = alpha;
    vInner = ${(RING_INNER / RING_OUTER).toFixed(4)};
  }
`
const ringFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vInner;
  void main() {
    float r = length(gl_PointCoord * 2.0 - 1.0);
    float aa = fwidth(r);
    float a = smoothstep(vInner - aa, vInner, r) * (1.0 - smoothstep(1.0 - aa, 1.0, r));
    if (a * vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
  }
`

// The game's star icons, for its "stars" map mode (MapPanel.cpp, SHOW_STARS):
// drawn at 0.6 x the cube root of the zoom, at 80% alpha. One world unit is a
// pixel at 100% zoom, so the zoom is the screen pixels per world unit.
const iconVertex = /* glsl */ `
  uniform float uScale;
  uniform float uPixelRatio;
  uniform float uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float zoom = uScale / -mv.z / uPixelRatio;
    gl_PointSize = min(uSize * 0.6 * pow(zoom, 1.0 / 3.0) * uPixelRatio, 256.0);
  }
`
const iconFragment = /* glsl */ `
  uniform sampler2D uMap;
  void main() {
    vec4 c = texture2D(uMap, vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y));
    gl_FragColor = vec4(c.rgb, c.a * 0.8);
  }
`
/** MapPanel.cpp draws at most this many stars per system. */
const MAX_STARS = 5

/** @param {number[]} p @param {number} [y] */
const toWorld = (p, y = 0) => new THREE.Vector3(p[0], y, p[1])

/**
 * @param {HTMLElement} container
 * @param {any} galaxy  the extracted galaxy.json
 * @param {{ onSelect: (name: string | null) => void, onHover: (name: string | null) => void, onViewChange: (center: number[]) => void }} events
 */
export function createGalaxyScene(container, galaxy, events) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setClearColor(0x000000)
  container.appendChild(renderer.domElement)

  const labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.className = 'label-layer'
  container.appendChild(labelRenderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 60000)
  const controls = new MapControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.zoomToCursor = true
  controls.minDistance = 30
  controls.maxDistance = 9000
  controls.maxPolarAngle = THREE.MathUtils.degToRad(82)

  // Replaced by setGalaxy when story events are applied or changed. Events
  // move and alter systems but don't add any, so the index stays valid.
  let systems = galaxy.systems
  const index = new Map(systems.map((/** @type {any} */ s, /** @type {number} */ i) => [s.name, i]))

  // --- Galaxy backdrop and region labels ----------------------------------
  const loader = new THREE.TextureLoader()
  /** @type {THREE.Mesh[]} */ const backdrops = []
  /** @type {THREE.Mesh[]} */ const regionLabels = []
  for (const g of galaxy.galaxies) {
    const texture = loader.load(g.sprite.url)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const isLabel = g.name.startsWith('label ')
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: g.sprite.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      opacity: isLabel ? 0.9 : 1,
    })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(g.sprite.width, g.sprite.height), material)
    plane.rotation.x = -Math.PI / 2
    plane.position.copy(toWorld(g.pos, isLabel ? -0.5 : -2))
    plane.renderOrder = isLabel ? 1 : 0
    plane.userData = { fromEvent: g.fromEvent }
    scene.add(plane)
    ;(isLabel ? regionLabels : backdrops).push(plane)
  }

  // --- Hyperspace links -----------------------------------------------------
  /** Two points pulled back from each end so the line stops short of the rings. */
  function trimmed(/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ y = 0) {
    const from = toWorld(a, y)
    const to = toWorld(b, y)
    const length = from.distanceTo(to)
    if (length <= 2 * LINK_OFFSET) return null
    const unit = to.clone().sub(from).divideScalar(length).multiplyScalar(LINK_OFFSET)
    return [from.add(unit), to.sub(unit)]
  }

  /**
   * A fresh geometry for a set of line segments. setFromPoints only refills
   * an existing geometry's buffer, which is sized for its first set of
   * points, so a geometry can't be reused once the number of lines changes.
   * @param {THREE.LineSegments} lines @param {THREE.Vector3[]} points @param {number[]} colors
   */
  function setLines(lines, points, colors) {
    lines.geometry.dispose()
    lines.geometry = new THREE.BufferGeometry().setFromPoints(points)
    lines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  }

  const linkMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
  const links = new THREE.LineSegments(new THREE.BufferGeometry(), linkMaterial)
  links.renderOrder = 2
  scene.add(links)

  // --- Wormholes, drawn with an arrowhead at the departure end as in game -----
  const wormholes = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  )
  wormholes.renderOrder = 2
  scene.add(wormholes)

  function rebuildWormholes() {
    const wormholePositions = []
    const wormholeColors = []
    for (const w of galaxy.wormholes) {
      const color = new THREE.Color(...(w.color ?? [0.5, 0.2, 0.9]))
      if (!w.mappable) color.multiplyScalar(0.5)
      for (const [fromName, toName] of w.links) {
        const a = systems[index.get(fromName)]
        const b = systems[index.get(toName)]
        if (!a || !b) continue
        const ends = trimmed(a.pos, b.pos, 0.2)
        if (!ends) continue
        const [from, to] = ends
        const dim = color.clone().multiplyScalar(0.45)
        wormholePositions.push(from, to)
        wormholeColors.push(dim, dim)
        const stem = from.clone().sub(to).normalize().multiplyScalar(-LINK_OFFSET * 1.6)
        const tip = from.clone().add(stem)
        const up = new THREE.Vector3(0, 1, 0)
        for (const angle of [Math.PI / 6, -Math.PI / 6]) {
          const barb = stem.clone().multiplyScalar(0.5).applyAxisAngle(up, angle)
          wormholePositions.push(tip, tip.clone().sub(barb))
          wormholeColors.push(color, color)
        }
        wormholePositions.push(from, tip)
        wormholeColors.push(color, color)
      }
    }
    setLines(wormholes, wormholePositions, wormholeColors.flatMap(c => [c.r, c.g, c.b]))
  }
  rebuildWormholes()

  // --- System rings -----------------------------------------------------------
  const ringUniforms = { uScale: { value: 1 }, uMinPx: { value: 5 * window.devicePixelRatio } }
  const ringMaterial = new THREE.ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    uniforms: ringUniforms,
    transparent: true,
    depthWrite: false,
  })

  const ringGeometry = new THREE.BufferGeometry()
  ringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(systems.flatMap((/** @type {any} */ s) => [s.pos[0], 0.5, s.pos[1]]), 3))
  ringGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(systems.length * 3), 3))
  ringGeometry.setAttribute('alpha', new THREE.Float32BufferAttribute(new Float32Array(systems.length).fill(1), 1))
  ringGeometry.setAttribute('radius', new THREE.Float32BufferAttribute(new Float32Array(systems.length).fill(RING_OUTER), 1))
  const rings = new THREE.Points(ringGeometry, ringMaterial)
  rings.renderOrder = 3
  scene.add(rings)

  // Selection and hover markers: a single larger ring each.
  /** @param {number} radius @param {number[]} color */
  function marker(radius, color) {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.6, 0], 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
    geometry.setAttribute('alpha', new THREE.Float32BufferAttribute([1], 1))
    geometry.setAttribute('radius', new THREE.Float32BufferAttribute([radius], 1))
    const points = new THREE.Points(geometry, ringMaterial)
    points.renderOrder = 4
    points.visible = false
    scene.add(points)
    return points
  }
  const selectMarker = marker(11, [1, 1, 1])
  const hoverMarker = marker(9, [0.6, 0.6, 0.6])

  // --- System names -----------------------------------------------------------
  const nameLayer = new THREE.Group()
  scene.add(nameLayer)
  /** @type {CSS2DObject[]} */
  const names = systems.map((/** @type {any} */ s) => {
    const el = document.createElement('div')
    el.className = 'system-name'
    el.textContent = s.displayName ?? s.name
    const label = new CSS2DObject(el)
    label.position.copy(toWorld(s.pos, 0.5))
    label.center.set(-0.12, 0.5)
    nameLayer.add(label)
    return label
  })

  /** @type {string[]} last opacity set on each name, to skip redundant style writes */
  const nameOpacity = names.map(() => '')

  // --- Star icons, in place of rings in the game's stars mode -----------------
  const iconLayer = new THREE.Group()
  iconLayer.visible = false
  iconLayer.renderOrder = 3
  scene.add(iconLayer)
  /** @type {Map<string, THREE.Texture>} */
  const iconTextures = new Map()
  let showIcons = false

  function rebuildIcons() {
    for (const points of /** @type {THREE.Points[]} */ ([...iconLayer.children])) {
      iconLayer.remove(points)
      points.geometry.dispose()
      ;/** @type {THREE.Material} */ (points.material).dispose()
    }
    /** @type {Map<string, { icon: any, positions: number[] }>} */
    const byIcon = new Map()
    systems.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      if (!shown[i]) return
      // Any object whose sprite stars.txt gives an icon, brown dwarfs included
      // (System::UpdateSystem), in the order they're defined.
      const icons = flatten(s.objects).map(o => galaxy.stars[o.sprite]?.icon).filter(Boolean).slice(0, MAX_STARS)
      // As in game: several stars are spread around the system at a turn
      // fixed by its name and position, further out the more there are.
      let angle = 0
      let spacing = 0
      let offset = 0
      if (icons.length > 1) {
        angle = s.name.length + Math.hypot(s.pos[0], s.pos[1])
        spacing = 360 / icons.length
        offset = icons.length * 2
      }
      for (const icon of icons) {
        angle += spacing
        const radians = THREE.MathUtils.degToRad(angle)
        // Angle::Unit is (sin, -cos), with the game's y pointing down the screen.
        const x = s.pos[0] + offset * Math.sin(radians)
        const y = s.pos[1] - offset * Math.cos(radians)
        const group = byIcon.get(icon.url) ?? { icon, positions: [] }
        group.positions.push(x, 0.55, y)
        byIcon.set(icon.url, group)
      }
    })
    for (const { icon, positions } of byIcon.values()) {
      let texture = iconTextures.get(icon.url)
      if (!texture) {
        texture = loader.load(icon.url)
        texture.colorSpace = THREE.SRGBColorSpace
        iconTextures.set(icon.url, texture)
      }
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      const material = new THREE.ShaderMaterial({
        vertexShader: iconVertex,
        fragmentShader: iconFragment,
        uniforms: {
          uScale: ringUniforms.uScale,
          uPixelRatio: { value: renderer.getPixelRatio() },
          uSize: { value: Math.max(icon.width, icon.height) },
          uMap: { value: texture },
        },
        transparent: true,
        depthWrite: false,
        blending: icon.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
      const points = new THREE.Points(geometry, material)
      points.renderOrder = 3
      iconLayer.add(points)
    }
  }

  // --- Changes since another version ------------------------------------------
  // Systems that version had and this one hasn't, as ghost rings with names,
  // and the links added or removed since, drawn over the normal ones.
  const ghosts = new THREE.Points(new THREE.BufferGeometry(), ringMaterial)
  ghosts.renderOrder = 3
  scene.add(ghosts)
  const changedLinks = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  )
  changedLinks.renderOrder = 2
  scene.add(changedLinks)
  const ghostLayer = new THREE.Group()
  nameLayer.add(ghostLayer)

  // --- State ------------------------------------------------------------------
  /** @type {boolean[]} */
  let shown = systems.map(() => true)
  let showNames = true
  /** @type {string | null} */ let selected = null
  /** @type {string | null} */ let hovered = null
  let linkPairs = galaxy.links
  /** @type {Parameters<typeof setOptions>[0] | null} */
  let lastOptions = null

  function rebuildLinks() {
    const positions = []
    const colors = []
    for (const [a, b] of linkPairs) {
      const i = index.get(a)
      const j = index.get(b)
      if (!shown[i] || !shown[j]) continue
      const ends = trimmed(systems[i].pos, systems[j].pos)
      if (!ends) continue
      // Links into hidden or shrouded space are dimmer, hinting they're not on the in-game map.
      const veiled = [systems[i], systems[j]].some(s => s.hidden || s.shrouded)
      const c = veiled ? 0.22 : 0.42
      positions.push(...ends)
      colors.push(c, c, c, c, c, c)
    }
    setLines(links, positions, colors)
  }

  // --- Camera -----------------------------------------------------------------
  /** @type {{ from: THREE.Vector3, to: THREE.Vector3, offset: THREE.Vector3, start: number, duration: number } | null} */
  let flight = null

  const viewOffset = () => camera.position.clone().sub(controls.target)

  /**
   * Glide the view to centre on a map position, keeping the camera's angle and
   * distance unless given the offset from the centre to end at.
   * @param {number[]} pos @param {THREE.Vector3} [offset]
   */
  function flyTo(pos, offset = viewOffset()) {
    flight = { from: controls.target.clone(), to: toWorld(pos), offset, start: performance.now(), duration: 700 }
  }

  // Looking straight down, as the game's map does. The sliver of +Z keeps the
  // controls' azimuth at zero, so north stays at the top of the view.
  const homeOffset = new THREE.Vector3(0, 886, 0.01)
  const start = systems[index.get('Sol')]?.pos ?? [0, 0]
  controls.target.copy(toWorld(start))
  camera.position.copy(toWorld(start)).add(homeOffset)

  // --- Picking ----------------------------------------------------------------
  const projected = new THREE.Vector3()
  /** @param {number} clientX @param {number} clientY @returns {string | null} */
  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect()
    let best = null
    let bestDistance = PICK_RADIUS_PX
    systems.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
      if (!shown[i]) return
      projected.set(s.pos[0], 0.5, s.pos[1]).project(camera)
      if (projected.z > 1) return
      const x = (projected.x + 1) / 2 * rect.width + rect.left
      const y = (1 - projected.y) / 2 * rect.height + rect.top
      const d = Math.hypot(x - clientX, y - clientY)
      if (d < bestDistance) {
        bestDistance = d
        best = s.name
      }
    })
    return best
  }

  let downAt = /** @type {{ x: number, y: number } | null} */ (null)
  /** @param {PointerEvent} e */
  const onPointerDown = e => (downAt = { x: e.clientX, y: e.clientY })
  /** @param {PointerEvent} e */
  const onPointerUp = e => {
    if (e.button !== 0 || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return
    events.onSelect(pick(e.clientX, e.clientY))
  }
  /** @param {PointerEvent} e */
  const onPointerMove = e => {
    if (e.buttons) return
    const name = pick(e.clientX, e.clientY)
    if (name === hovered) return
    hovered = name
    renderer.domElement.style.cursor = name ? 'pointer' : ''
    updateMarker(hoverMarker, name !== selected ? name : null)
    events.onHover(name)
  }
  /** @param {MouseEvent} e */
  const onDoubleClick = e => {
    const name = pick(e.clientX, e.clientY)
    if (name) flyTo(systems[index.get(name)].pos, viewOffset().setLength(260))
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('dblclick', onDoubleClick)

  /** @param {THREE.Points} points @param {string | null} name */
  function updateMarker(points, name) {
    points.visible = name !== null
    if (name !== null) points.position.copy(toWorld(systems[index.get(name)].pos))
  }

  // --- Loop -------------------------------------------------------------------
  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    ringUniforms.uScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  let lastCenter = ''
  let frame = 0
  /** While a system view covers the map, there's no need to draw it. */
  let paused = false
  function animate(/** @type {number} */ now) {
    frame = requestAnimationFrame(animate)
    if (paused) return
    if (flight) {
      const t = Math.min(1, (now - flight.start) / flight.duration)
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      const target = flight.from.clone().lerp(flight.to, ease)
      const offset = camera.position.clone().sub(controls.target).lerp(flight.offset, ease)
      controls.target.copy(target)
      camera.position.copy(target).add(offset)
      if (t >= 1) flight = null
    }
    controls.update()

    nameLayer.visible = showNames
    if (showNames) {
      names.forEach((label, i) => {
        const distance = camera.position.distanceTo(label.position)
        label.visible = shown[i] && distance < NAME_DISTANCE
        if (!label.visible) return
        const opacity = Math.min(1, (NAME_DISTANCE - distance) / NAME_FADE).toFixed(2)
        if (nameOpacity[i] !== opacity) label.element.style.opacity = nameOpacity[i] = opacity
      })
      for (const label of /** @type {CSS2DObject[]} */ (ghostLayer.children)) {
        const distance = camera.position.distanceTo(label.position)
        label.visible = distance < NAME_DISTANCE
        if (label.visible) label.element.style.opacity = Math.min(1, (NAME_DISTANCE - distance) / NAME_FADE).toFixed(2)
      }
    }

    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)

    const center = `${Math.round(controls.target.x / 25)},${Math.round(controls.target.z / 25)}`
    if (center !== lastCenter) {
      lastCenter = center
      events.onViewChange([controls.target.x, controls.target.z])
    }
  }
  frame = requestAnimationFrame(animate)

  rebuildLinks()

  /** @param {{ hiddenSystems: boolean, names: boolean, regions: boolean, eventRegions: boolean, backdrop: boolean, wormholes: boolean }} options */
  function setOptions(options) {
    lastOptions = options
    shown = systems.map((/** @type {any} */ s) => options.hiddenSystems || !(s.hidden || s.inaccessible))
    const alpha = /** @type {THREE.BufferAttribute} */ (ringGeometry.getAttribute('alpha'))
    shown.forEach((visible, i) => alpha.setX(i, visible && !showIcons ? 1 : 0))
    alpha.needsUpdate = true
    showNames = options.names
    regionLabels.forEach(m => (m.visible = options.regions && (options.eventRegions || !m.userData.fromEvent)))
    backdrops.forEach(m => (m.visible = options.backdrop))
    wormholes.visible = options.wormholes
    rebuildLinks()
    if (showIcons) rebuildIcons()
    if (hovered && !shown[index.get(hovered)]) updateMarker(hoverMarker, (hovered = null))
  }

  return {
    /** @param {number[][]} colors one [r, g, b] per system */
    setColors(colors) {
      const attribute = /** @type {THREE.BufferAttribute} */ (ringGeometry.getAttribute('color'))
      colors.forEach((c, i) => attribute.setXYZ(i, c[0], c[1], c[2]))
      attribute.needsUpdate = true
    },
    setOptions,
    /** Draw the game's star icons in place of the rings, or not. @param {boolean} visible */
    setStarIcons(visible) {
      if (visible === showIcons) return
      showIcons = visible
      iconLayer.visible = visible
      if (lastOptions) setOptions(lastOptions)
      else if (visible) rebuildIcons()
    },
    /**
     * Show the galaxy in another state, after story events. It must have
     * the same systems, in the same order.
     * @param {any} next
     */
    setGalaxy(next) {
      if (next.systems === systems) return
      galaxy = next
      systems = next.systems
      linkPairs = next.links
      const position = /** @type {THREE.BufferAttribute} */ (ringGeometry.getAttribute('position'))
      systems.forEach((/** @type {any} */ s, /** @type {number} */ i) => {
        position.setXYZ(i, s.pos[0], 0.5, s.pos[1])
        names[i].position.copy(toWorld(s.pos, 0.5))
        names[i].element.textContent = s.displayName ?? s.name
      })
      position.needsUpdate = true
      ringGeometry.computeBoundingSphere()
      rebuildWormholes()
      if (lastOptions) setOptions(lastOptions)
      else rebuildLinks()
      updateMarker(selectMarker, selected)
      updateMarker(hoverMarker, hovered !== selected ? hovered : null)
    },
    /** @param {string | null} name @param {boolean} [fly] */
    select(name, fly = false) {
      selected = name
      updateMarker(selectMarker, name)
      if (name === hovered) updateMarker(hoverMarker, null)
      if (name && fly) flyTo(systems[index.get(name)].pos)
    },
    /**
     * Show what's changed since another version, or nothing.
     * @param {{ ghosts: { name: string, pos: number[] }[], ghostColor: number[],
     *   links: { from: number[], to: number[], color: number[] }[] } | null} changes
     */
    setChanges(changes) {
      const ghostList = changes?.ghosts ?? []
      ghosts.geometry.dispose()
      ghosts.geometry = new THREE.BufferGeometry()
      ghosts.geometry.setAttribute('position', new THREE.Float32BufferAttribute(ghostList.flatMap(g => [g.pos[0], 0.5, g.pos[1]]), 3))
      ghosts.geometry.setAttribute('color', new THREE.Float32BufferAttribute(ghostList.flatMap(() => changes?.ghostColor ?? []), 3))
      ghosts.geometry.setAttribute('alpha', new THREE.Float32BufferAttribute(ghostList.map(() => 0.75), 1))
      ghosts.geometry.setAttribute('radius', new THREE.Float32BufferAttribute(ghostList.map(() => RING_OUTER), 1))
      for (const label of [...ghostLayer.children]) {
        ghostLayer.remove(label)
        ;/** @type {CSS2DObject} */ (label).element.remove()
      }
      for (const g of ghostList) {
        const el = document.createElement('div')
        el.className = 'system-name ghost'
        el.textContent = g.name
        const label = new CSS2DObject(el)
        label.position.copy(toWorld(g.pos, 0.5))
        label.center.set(-0.12, 0.5)
        ghostLayer.add(label)
      }
      const points = []
      const colors = []
      for (const link of changes?.links ?? []) {
        const ends = trimmed(link.from, link.to, 0.1)
        if (!ends) continue
        points.push(...ends)
        colors.push(...link.color, ...link.color)
      }
      setLines(changedLinks, points, colors)
    },
    /** @param {boolean} value */
    setPaused(value) {
      paused = value
    },
    resetView() {
      flyTo(start, homeOffset.clone())
    },
    dispose() {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('dblclick', onDoubleClick)
      scene.traverse(o => {
        const mesh = /** @type {any} */ (o)
        mesh.geometry?.dispose()
        mesh.material?.map?.dispose()
        mesh.material?.uniforms?.uMap?.value?.dispose()
        mesh.material?.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
      labelRenderer.domElement.remove()
    },
  }
}
