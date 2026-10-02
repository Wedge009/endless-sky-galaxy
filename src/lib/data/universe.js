// The galaxy's systems and planets as the game loads them, shared by the
// extractor (reading the data files) and the viewer (applying mission events
// on top). Event changes go through the same loading code as the definitions
// themselves (GameEvent.cpp, UniverseObjects::Change), so one implementation
// serves both. The browser gets data nodes already parsed, never the files.
//
// As in the game, a second definition of the same object amends the first: a
// key given without "add" replaces that key's earlier values, "add" appends
// and "remove" deletes (see System::Load and Planet::Load).

/** @typedef {{ tokens: string[], children: DataNode[] }} DataNode */

const num = (/** @type {string} */ s) => Number.parseFloat(s)

/**
 * Walk a node's children, splitting off any "add"/"remove" prefix and
 * clearing a key's previous values on its first plain occurrence.
 * @param {DataNode} node
 * @param {any} target
 * @param {Record<string, () => void>} clear  key -> how to clear it
 * @param {(key: string, values: string[], child: DataNode, mode: '' | 'add' | 'remove') => void} handle
 */
function loadChildren(node, target, clear, handle) {
  const cleared = new Set()
  for (const child of node.children) {
    const mode = child.tokens[0] === 'add' || child.tokens[0] === 'remove' ? child.tokens[0] : ''
    const key = child.tokens[mode ? 1 : 0]
    const values = child.tokens.slice(mode ? 2 : 1)
    if (key === undefined) continue
    if (clear[key] && ((mode === 'remove' && !values.length) || (!mode && !cleared.has(key)))) {
      clear[key]()
      cleared.add(key)
      if (mode === 'remove') continue
    }
    handle(key, values, child, mode)
  }
}

/** @param {DataNode} node @returns {any} */
export function loadObject(node) {
  // The name follows the key, which may itself follow "add" or "remove".
  const name = node.tokens[node.tokens[0] === 'add' || node.tokens[0] === 'remove' ? 2 : 1] ?? null
  // A period of 0 means none was given, and the game works it out from the
  // masses involved (System::FinishLoading; see orbits.js).
  const object = { name, sprite: null, distance: 0, period: 0, offset: 0, children: [] }
  for (const child of node.children) {
    const [key, value] = child.tokens
    if (key === 'sprite') object.sprite = value
    else if (key === 'distance') object.distance = num(value)
    else if (key === 'period') object.period = num(value)
    else if (key === 'offset') object.offset = num(value)
    else if (key === 'object') object.children.push(loadObject(child))
  }
  return object
}

/**
 * Remove the first object, at any depth, matching the template the way
 * System::Load does: by sprite, distance and offset, and by period if the
 * object has one of its own. Its moons go with it.
 * @param {any[]} objects @param {any} template
 * @returns {any[]}
 */
function removeObject(objects, template) {
  let done = false
  /** @param {any[]} list @returns {any[]} */
  const visit = list => list.flatMap(o => {
    if (!done && o.sprite === template.sprite && o.distance === template.distance && o.offset === template.offset
      && (!o.period || o.period === template.period)) {
      done = true
      return []
    }
    return [{ ...o, children: visit(o.children) }]
  })
  return visit(objects)
}

/**
 * Load a system definition, or amend the one already there.
 * @param {Map<string, any>} systems
 * @param {DataNode} node
 * @returns {boolean} whether it amended an earlier definition
 */
export function loadSystem(systems, node) {
  const name = node.tokens[1]
  const existed = systems.has(name)
  const s = systems.get(name) ?? {
    name, displayName: null, pos: [0, 0], government: null, attributes: [], links: [],
    hidden: false, shrouded: false, inaccessible: false,
    jumpRange: null, belt: [], haze: null, starfieldDensity: 1, objects: [], trade: {}, fleets: [], minables: [], hazards: [],
  }
  systems.set(name, s)
  loadChildren(node, s, {
    'display name': () => (s.displayName = null),
    government: () => (s.government = null),
    attributes: () => (s.attributes = []),
    link: () => (s.links = []),
    trade: () => (s.trade = {}),
    fleet: () => (s.fleets = []),
    minables: () => (s.minables = []),
    hazard: () => (s.hazards = []),
    belt: () => (s.belt = []),
    object: () => (s.objects = []),
    hidden: () => (s.hidden = false),
    shrouded: () => (s.shrouded = false),
    inaccessible: () => (s.inaccessible = false),
  }, (key, values, child, mode) => {
    const remove = mode === 'remove'
    const without = (/** @type {any[]} */ list, /** @type {(x: any) => boolean} */ match) => list.filter(x => !match(x))
    switch (key) {
      case 'display name': s.displayName = values[0]; break
      case 'pos': s.pos = [num(values[0]), num(values[1])]; break
      case 'government': s.government = values[0]; break
      case 'hidden': case 'shrouded': case 'inaccessible': s[key] = !remove; break
      case 'jump range': s.jumpRange = num(values[0]); break
      case 'starfield density': s.starfieldDensity = remove ? 1 : num(values[0]); break
      case 'haze': s.haze = values[0]; break
      case 'belt': s.belt.push(num(values[0])); break
      case 'attributes':
        s.attributes = remove ? s.attributes.filter((/** @type {string} */ a) => !values.includes(a))
          : [...new Set([...s.attributes, ...values])]
        break
      case 'link':
        s.links = remove ? s.links.filter((/** @type {string} */ l) => l !== values[0]) : [...new Set([...s.links, values[0]])]
        break
      case 'trade':
        if (remove) delete s.trade[values[0]]
        else s.trade[values[0]] = num(values[1])
        break
      case 'fleet':
        s.fleets = remove ? without(s.fleets, f => f.name === values[0])
          : [...s.fleets, { name: values[0], period: num(values[1]) }]
        break
      case 'minables':
        s.minables = remove ? without(s.minables, m => m.name === values[0])
          : [...s.minables, { name: values[0], count: num(values[1]), energy: num(values[2]) }]
        break
      case 'hazard':
        s.hazards = remove ? without(s.hazards, h => h.name === values[0])
          : [...s.hazards, { name: values[0], period: num(values[1]) }]
        break
      case 'object':
        if (remove) s.objects = removeObject(s.objects, loadObject(child))
        else s.objects.push(loadObject(child))
        break
    }
  })
  return existed
}

/**
 * Load a planet definition, or amend the one already there.
 * @param {Map<string, any>} planets
 * @param {DataNode} node
 * @returns {boolean} whether it amended an earlier definition
 */
export function loadPlanet(planets, node) {
  const name = node.tokens[1]
  const existed = planets.has(name)
  const p = planets.get(name) ?? {
    name, displayName: null, attributes: [], landscape: null, government: null,
    description: [], spaceport: [], port: null, shipyards: [], outfitters: [],
    security: null, bribe: null, tribute: null, requiredReputation: null, wormhole: null,
  }
  planets.set(name, p)
  /** @param {DataNode} child */
  const paragraph = child => ({ text: child.tokens.at(-1), conditional: child.children.some(c => c.tokens[0] === 'to') })
  loadChildren(node, p, {
    attributes: () => (p.attributes = []),
    description: () => (p.description = []),
    spaceport: () => (p.spaceport = []),
    port: () => (p.port = null),
    shipyard: () => (p.shipyards = []),
    outfitter: () => (p.outfitters = []),
    tribute: () => (p.tribute = null),
  }, (key, values, child, mode) => {
    const remove = mode === 'remove'
    switch (key) {
      case 'display name': p.displayName = values[0]; break
      case 'landscape': p.landscape = values[0]; break
      case 'government': p.government = values[0]; break
      case 'security': p.security = num(values[0]); break
      case 'bribe': p.bribe = num(values[0]); break
      case 'required reputation': p.requiredReputation = num(values[0]); break
      case 'wormhole': p.wormhole = values[0]; break
      case 'description': p.description.push(paragraph(child)); break
      case 'spaceport': p.spaceport.push(paragraph(child)); break
      case 'attributes':
        p.attributes = remove ? p.attributes.filter((/** @type {string} */ a) => !values.includes(a))
          : [...new Set([...p.attributes, ...values])]
        break
      // Sets in the game (Planet::Load), so adding one twice has no effect.
      case 'shipyard':
        p.shipyards = remove ? p.shipyards.filter((/** @type {string} */ v) => v !== values[0]) : [...new Set([...p.shipyards, values[0]])]
        break
      case 'outfitter':
        p.outfitters = remove ? p.outfitters.filter((/** @type {string} */ v) => v !== values[0]) : [...new Set([...p.outfitters, values[0]])]
        break
      case 'tribute': {
        const fleet = child.children.find(c => c.tokens[0] === 'fleet')
        p.tribute = { value: num(values[0]), fleet: fleet ? { name: fleet.tokens[1], count: num(fleet.tokens[2] ?? '1') } : null }
        break
      }
      case 'port': {
        p.port = { name: values[0] ?? null, recharges: [], services: [], description: [] }
        for (const c of child.children) {
          if (c.tokens[0] === 'recharges') p.port.recharges.push(...c.tokens.slice(1))
          else if (c.tokens[0] === 'services') p.port.services.push(...c.tokens.slice(1))
          else if (c.tokens[0] === 'description') p.port.description.push(paragraph(c))
        }
        break
      }
    }
  })
  return existed
}


/**
 * Load an outfitter or shipyard, or amend the one already there, as
 * Shop<Item>::Load does. Stock is a set of items: a plain item or "add" puts
 * one in, "remove" takes one out, and "clear" (or "remove" alone) empties it.
 * A "stock" block given again without "add" replaces the stock.
 *
 * Shops with a location filter or conditions to sell aren't attached to
 * planets but offered wherever they match (the ammunition restocks), so
 * they're marked and left out of planets' stock.
 * @param {Map<string, any>} shops
 * @param {DataNode} node
 */
export function loadShop(shops, node) {
  const name = node.tokens[1]
  const shop = shops.get(name) ?? { name, items: [], anywhere: false }
  shops.set(name, shop)
  let overwriteStock = shop.items.length > 0
  /** @param {DataNode} child */
  const single = child => {
    const [token, value] = child.tokens
    if ((token === 'clear' || token === 'remove') && value === undefined) shop.items = []
    else if (token === 'clear' || token === 'remove') shop.items = shop.items.filter((/** @type {string} */ i) => i !== value)
    else if (token === 'add' && value !== undefined) shop.items = [...new Set([...shop.items, value])]
    else shop.items = [...new Set([...shop.items, token])]
  }
  for (const child of node.children) {
    const mode = child.tokens[0] === 'add' || child.tokens[0] === 'remove' ? child.tokens[0] : ''
    const key = child.tokens[mode ? 1 : 0]
    if (key === 'location' || (key === 'to' && child.tokens[mode ? 2 : 1] === 'sell')) shop.anywhere = mode !== 'remove'
    else if (key === 'stock') {
      if (mode !== 'add' && overwriteStock) {
        overwriteStock = false
        shop.items = []
      }
      if (mode === 'remove') shop.items = []
      else child.children.forEach(single)
    } else single(child)
  }
}

/** Every stellar object, depth first. @param {any[]} objects @returns {any[]} */
export const flatten = objects => objects.flatMap(o => [o, ...flatten(o.children)])

/**
 * Approximates Planet::FinishLoading: inhabited if it has a service, required
 * reputation or a defence fleet, and isn't marked uninhabited.
 * @param {any} p
 */
export function isInhabited(p) {
  const hasServices = p.spaceport.length || p.port || p.shipyards.length || p.outfitters.length
  return Boolean((hasServices || p.requiredReputation || p.tribute?.fleet) && !p.attributes.includes('uninhabited'))
}

/**
 * Apply one change from an event, as UniverseObjects::Change does. Only the
 * kinds the viewer shows are handled; region labels are shown regardless.
 * @param {{ systems: Map<string, any>, planets: Map<string, any>, outfitters: Map<string, any>, shipyards: Map<string, any> }} universe
 * @param {DataNode} node
 */
export function applyChange({ systems, planets, outfitters, shipyards }, node) {
  const [key, a, b] = node.tokens
  if (key === 'system' && a) loadSystem(systems, node)
  else if (key === 'planet' && a) loadPlanet(planets, node)
  else if (key === 'outfitter' && a) loadShop(outfitters, node)
  else if (key === 'shipyard' && a) loadShop(shipyards, node)
  // System::Link and System::Unlink change both ends.
  else if ((key === 'link' || key === 'unlink') && systems.has(a) && systems.has(b)) {
    const [from, to] = [systems.get(a), systems.get(b)]
    from.links = from.links.filter((/** @type {string} */ l) => l !== b)
    to.links = to.links.filter((/** @type {string} */ l) => l !== a)
    if (key === 'link') {
      from.links.push(b)
      to.links.push(a)
    }
  }
}

/**
 * The derived lists the viewer reads: each system's stars, the links between
 * systems (each pair once: the map draws a link if either end lists it), and
 * each planet's system and whether it's inhabited.
 * @param {Iterable<any>} systemList
 * @param {Iterable<any>} planetList
 */
export function finishGalaxy(systemList, planetList) {
  const systems = [...systemList].map(s => ({
    ...s,
    stars: flatten(s.objects).map(o => o.sprite).filter(sp => sp?.startsWith('star/')),
  }))
  const names = new Set(systems.map(s => s.name))
  const links = new Map()
  for (const s of systems)
    for (const other of s.links)
      if (names.has(other)) {
        const pair = [s.name, other].sort()
        links.set(pair.join('\u0000'), pair)
      }
  const planetSystem = new Map()
  for (const s of systems)
    for (const o of flatten(s.objects))
      if (o.name) planetSystem.set(o.name, s.name)
  const planets = [...planetList].map(p => ({ ...p, system: planetSystem.get(p.name) ?? null, inhabited: isInhabited(p) }))
  return { systems, links: [...links.values()], planets }
}
