// Inside a system: its stars, planets, moons and stations on their orbits, at
// the game's own scale (one world unit is a pixel of a sprite, as in flight).
// Like the galaxy, the system lies on the XZ plane with the game's y pointing
// down the screen; the sprites stand up as billboards, so they look as they
// do in game from above and stay legible when the view is tilted.

import * as THREE from 'three'
import { MapControls } from 'three/examples/jsm/controls/MapControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { orbitsOf, positionsOn } from '../data/orbits.js'
import { createBackground } from './createBackground.js'

const PICK_RADIUS_PX = 10
// Planets are small beside their orbits (Earth is 180 across, 966 from the
// Sun), so when zoomed out, sprites are drawn at least this many pixels
// across, as the galaxy's rings are, rather than vanishing.
const MIN_SPRITE_PX = 9

/**
 * @param {HTMLElement} container
 * @param {any} galaxy  with story events applied, if they are
 * @param {any} system
 * @param {{ onSelect: (planet: string | null) => void }} events
 */
export function createSystemScene(container, galaxy, system, events) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setClearColor(0x000000)
  // The background is drawn first, on its own, then the system over it.
  renderer.autoClear = false
  const background = createBackground(galaxy, renderer)
  background.setSystem(system)
  let showBackground = true
  container.appendChild(renderer.domElement)

  const labelRenderer = new CSS2DRenderer()
  labelRenderer.domElement.className = 'label-layer'
  container.appendChild(labelRenderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 10, 400000)
  const controls = new MapControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.12
  controls.zoomToCursor = true
  controls.minDistance = 100
  controls.maxDistance = 200000
  controls.maxPolarAngle = THREE.MathUtils.degToRad(82)

  const planets = new Map(galaxy.planets.map((/** @type {any} */ p) => [p.name, p]))
  const orbits = orbitsOf(system, galaxy.stars)
  const loader = new THREE.TextureLoader()
  /** @type {Map<string, THREE.Texture>} */
  const textures = new Map()

  // --- Objects ----------------------------------------------------------------
  const items = orbits.map(o => {
    const sprite = galaxy.sprites[o.object.sprite]
    let mesh = null
    if (sprite) {
      let texture = textures.get(sprite.url)
      if (!texture) {
        texture = loader.load(sprite.url)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy()
        textures.set(sprite.url, texture)
      }
      mesh = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: sprite.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }))
      mesh.scale.set(sprite.width, sprite.height, 1)
      // All in one layer, so three.js draws them furthest first: when the view
      // is tilted, whatever is nearer the camera covers what's behind it.
      mesh.renderOrder = 1
      scene.add(mesh)
    }

    // The orbit, around wherever the parent is.
    let ring = null
    if (o.object.distance > 0) {
      const points = []
      for (let i = 0; i <= 128; i++) {
        const a = (i / 128) * Math.PI * 2
        points.push(new THREE.Vector3(Math.cos(a) * o.object.distance, 0, Math.sin(a) * o.object.distance))
      }
      ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: o.isStar ? 0x554433 : 0x333333, transparent: true, depthWrite: false }),
      )
      scene.add(ring)
    }

    // Names for what has one: planets and stations you can land on, and the like.
    let label = null
    const name = o.object.name
    if (name) {
      const el = document.createElement('div')
      el.className = 'object-name'
      el.textContent = planets.get(name)?.displayName ?? name
      // A wormhole says where it leads from here.
      const wormhole = galaxy.wormholes.find((/** @type {any} */ w) => w.name === planets.get(name)?.wormhole)
      const leads = wormhole?.links.filter((/** @type {string[]} */ l) => l[0] === system.name).map((/** @type {string[]} */ l) => l[1]) ?? []
      if (leads.length) {
        const to = document.createElement('div')
        to.className = 'leads'
        to.textContent = `→ ${leads.join(', ')}`
        el.append(to)
      }
      el.addEventListener('click', () => events.onSelect(name))
      label = new CSS2DObject(el)
      label.center.set(0.5, -0.4)
      scene.add(label)
    }
    const radius = sprite ? Math.max(sprite.width, sprite.height) / 2 : 0
    return { orbit: o, mesh, ring, label, radius }
  })

  // --- Asteroid belts: where the system's minable asteroids are (System::Load,
  // "belt"), as dashed rings around the centre.
  for (const radius of system.belt ?? []) {
    const points = []
    for (let i = 0; i <= 256; i++) {
      const a = (i / 256) * Math.PI * 2
      points.push(new THREE.Vector3(Math.cos(a) * radius, -1, Math.sin(a) * radius))
    }
    const belt = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({ color: 0x6e5a3c, dashSize: radius / 40, gapSize: radius / 60, transparent: true, depthWrite: false }),
    )
    belt.computeLineDistances()
    scene.add(belt)
    const el = document.createElement('div')
    el.className = 'belt-name'
    el.textContent = 'asteroid belt'
    const label = new CSS2DObject(el)
    label.position.set(0, 0, -radius)
    label.center.set(0.5, 1.2)
    scene.add(label)
  }

  // --- Placing everything on a date -----------------------------------------
  let days = 0
  /** @type {number[][]} */
  let positions = []
  /** @param {number} day */
  function place(day) {
    days = day
    positions = positionsOn(orbits, day)
    items.forEach((item, i) => {
      const [x, y] = positions[i]
      if (item.mesh) {
        item.mesh.position.set(x, 0, y)
        // The game turns each object to face along its orbit (System::SetDate).
        if (x || y) /** @type {THREE.SpriteMaterial} */ (item.mesh.material).rotation = -Math.atan2(x, -y)
      }
      if (item.ring) {
        const parent = item.orbit.parent >= 0 ? positions[item.orbit.parent] : [0, 0]
        item.ring.position.set(parent[0], -1, parent[1])
      }
    })
    fitSprites()
  }

  /** Grow sprites too small to see to the minimum size, and keep names below them. */
  function fitSprites() {
    const worldPerPx = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / container.clientHeight
    items.forEach((item, i) => {
      const [x, y] = positions[i] ?? [0, 0]
      let radius = item.radius
      if (item.mesh) {
        const sprite = galaxy.sprites[item.orbit.object.sprite]
        const size = Math.max(sprite.width, sprite.height)
        const least = MIN_SPRITE_PX * camera.position.distanceTo(item.mesh.position) * worldPerPx
        const grow = Math.max(1, least / size)
        item.mesh.scale.set(sprite.width * grow, sprite.height * grow, 1)
        radius *= grow
      }
      if (item.label) item.label.position.set(x, 0, y + radius)
    })
  }

  // --- Camera: everything in view, looking straight down -----------------------
  const extent = Math.max(400, ...items.map(item => {
    let d = item.orbit.object.distance + item.radius
    for (let p = item.orbit.parent; p >= 0; p = orbits[p].parent) d += orbits[p].object.distance
    return d
  }))
  function resetView() {
    controls.target.set(0, 0, 0)
    const height = extent / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05
    // As the galaxy view does: the sliver of +Z keeps north at the top.
    camera.position.set(0, height, 0.01)
  }
  resetView()

  // --- Picking named objects --------------------------------------------------
  const projected = new THREE.Vector3()
  /** @param {number} clientX @param {number} clientY @returns {string | null} */
  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect()
    let best = null
    let bestDistance = Infinity
    items.forEach((item, i) => {
      if (!item.orbit.object.name) return
      const [x, y] = positions[i]
      projected.set(x, 0, y).project(camera)
      if (projected.z > 1) return
      const px = (projected.x + 1) / 2 * rect.width + rect.left
      const py = (1 - projected.y) / 2 * rect.height + rect.top
      // As large as the sprite appears, or a few pixels for a speck.
      const edge = projected.set(x + item.radius, 0, y).project(camera)
      const reach = Math.max(PICK_RADIUS_PX, Math.abs((edge.x + 1) / 2 * rect.width + rect.left - px))
      const d = Math.hypot(px - clientX, py - clientY)
      if (d < reach && d < bestDistance) {
        bestDistance = d
        best = item.orbit.object.name
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
    if (!e.buttons) renderer.domElement.style.cursor = pick(e.clientX, e.clientY) ? 'pointer' : ''
  }
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointermove', onPointerMove)

  // --- Background ---------------------------------------------------------------
  // Drawn flat behind the system, so it needs the view's centre, how many
  // pixels a map unit spans there, and which way the map's axes point on
  // screen, all read off the camera.
  const origin = new THREE.Vector3()
  const along = new THREE.Vector3()
  /** @param {THREE.Vector3} v @returns {number[]} CSS pixels, y down */
  const toScreen = v => {
    const p = v.clone().project(camera)
    return [(p.x + 1) / 2 * container.clientWidth, (1 - p.y) / 2 * container.clientHeight]
  }
  function drawBackground() {
    const target = controls.target
    const [ox, oy] = toScreen(origin.copy(target))
    const [xx, xy] = toScreen(along.copy(target).add(new THREE.Vector3(1, 0, 0)))
    const [zx, zy] = toScreen(along.copy(target).add(new THREE.Vector3(0, 0, 1)))
    // Tilting foreshortens one axis; the other still gives the scale.
    const zoom = Math.max(Math.hypot(xx - ox, xy - oy), Math.hypot(zx - ox, zy - oy))
    const angle = Math.atan2(xy - oy, xx - ox)
    background.render([target.x, target.z], zoom, angle, container.clientWidth, container.clientHeight)
  }

  // --- Loop -------------------------------------------------------------------
  function resize() {
    const { clientWidth: w, clientHeight: h } = container
    renderer.setSize(w, h)
    labelRenderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)
  resize()

  /** Days of game time per second of real time while playing, or 0 when paused. */
  let speed = 0
  /** @type {(days: number) => void} */
  let onDays = () => {}
  let last = performance.now()
  let frame = 0
  function animate(/** @type {number} */ now) {
    frame = requestAnimationFrame(animate)
    if (speed) {
      place(days + speed * (now - last) / 1000)
      onDays(days)
    }
    last = now
    controls.update()
    fitSprites()
    renderer.clear()
    if (showBackground) drawBackground()
    renderer.render(scene, camera)
    labelRenderer.render(scene, camera)
  }
  frame = requestAnimationFrame(animate)

  return {
    /** @param {number} day  days since the epoch */
    setDays(day) {
      if (Math.abs(day - days) > 1e-6) place(day)
    },
    /** @param {number} daysPerSecond @param {(days: number) => void} report */
    play(daysPerSecond, report) {
      speed = daysPerSecond
      onDays = report
    },
    /** @param {string | null} name */
    select(name) {
      for (const item of items) item.label?.element.classList.toggle('selected', item.orbit.object.name === name)
    },
    resetView,
    /** @param {boolean} visible */
    setBackground(visible) {
      showBackground = visible
    },
    dispose() {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      scene.traverse(o => {
        const mesh = /** @type {any} */ (o)
        mesh.geometry?.dispose()
        mesh.material?.dispose()
      })
      textures.forEach(t => t.dispose())
      background.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      labelRenderer.domElement.remove()
    },
  }
}
