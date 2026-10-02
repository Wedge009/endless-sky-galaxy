// Work out which mission events a reference map should treat as having
// happened, and which hang on a choice the player makes.
//
// The galaxy's default state assumes the player plays each storyline through
// to the end, completing missions rather than failing or declining them.
// Events on that path are assumed. Where the story branches, the events that
// only one branch reaches become an option of a choice. Branches are found
// from mission conditions, in two forms:
//
// - Outcome: mission X is either done, or not (declined or failed), and some
//   missions only follow the latter: `has "X: declined"`, or `not "X: done"`
//   on a mission offered alongside a declinable X.
// - Siblings: missions with the same prerequisite that exclude each other:
//   each with `not` on the other being offered, or `to fail` once the other
//   (or what follows it) makes progress.
//
// An option's "side" is every mission and event that can only be reached
// through it. An event belongs to an option if it's on that option's side
// and no other's. Choices that change nothing the viewer shows are dropped.
//
// Conditions are followed through whatever sets them: a mission's own
// status, an event, or a `set` in some mission's or event's actions, since
// storylines often mark progress with conditions of their own.

/** @typedef {import('./dataFile.js').DataNode} DataNode */

const MISSION_REF = /^(.*): (done|offered|active|accepted|declined|failed|aborted)$/
/** The phase of a mission in which it gains each status. */
const STATUS_PHASE = { done: 'complete', offered: 'offer', accepted: 'accept', active: 'accept', declined: 'decline', failed: 'fail', aborted: 'abort' }
/** Statuses reached on the way to completing a mission. */
const PROGRESS = new Set(['done', 'offered', 'active', 'accepted'])
/** Statuses that mean the mission wasn't completed. */
const UNDONE = new Set(['declined', 'failed', 'aborted'])
/** Phases on the way to completing a mission. (`visit` fires on landing before it's complete.) */
const SUCCESS_PHASES = new Set(['offer', 'accept', 'enter', 'stopover', 'waypoint', 'complete'])
/** Phases in which a mission isn't completed. */
const UNDONE_PHASES = new Set(['decline', 'fail', 'abort', 'defer'])
/** Phases after the offer, which happen only if the mission is taken up. */
const AFTER_OFFER = new Set([...SUCCESS_PHASES].filter(p => p !== 'offer'))
/** The order phases come in within one mission, for ordering events. */
const PHASE_ORDER = { offer: 0, accept: 1, enter: 2, stopover: 2, waypoint: 2, complete: 3 }
/** Statuses with which choices exclude each other: as soon as one is offered. */
const EXCLUDING = new Set(['offered', 'accepted'])

/**
 * @typedef {{ positive: string[][], negative: string[], never: boolean }} Requirements
 *   `positive` holds clauses that must all hold, each satisfied by any one of
 *   its references: a mission status ("X: done"), an event ("event: E"), or
 *   any other condition.
 * @typedef {{ mission?: string, event?: string, phase?: string }} Source
 *   What makes a condition true: a mission in some phase, or an event.
 * @typedef {{ event: string, mission: string, phase: string, delay: number[] }} Trigger
 * @typedef {{ name: string, offer: Requirements, failIf: Requirements,
 *   triggers: Trigger[], declinable: boolean, neverCompletes: boolean }} Mission
 */

/**
 * Collect what a condition set refers to. Numeric conditions such as karma
 * or `random` aren't followed, so an `or` that one could satisfy is dropped.
 * @param {DataNode[]} nodes
 * @returns {Requirements}
 */
function readConditions(nodes) {
  /** @type {Requirements} */
  const out = { positive: [], negative: [], never: false }
  for (const node of nodes) {
    const [first, second] = node.tokens
    if (first === 'never') out.never = true
    else if (first === 'has' && second) out.positive.push([second])
    else if (first === 'not' && second) out.negative.push(second)
    else if (first === 'and') {
      const inner = readConditions(node.children)
      out.positive.push(...inner.positive)
      out.negative.push(...inner.negative)
      out.never ||= inner.never
    } else if (first === 'or') {
      const refs = []
      let open = false
      for (const child of node.children) {
        if (child.tokens[0] === 'has' && child.tokens[1]) refs.push(child.tokens[1])
        else open = true
      }
      if (!open && refs.length) out.positive.push(refs)
    } else if (node.tokens.length === 3 && ['>', '>=', '!='].includes(second) && Number(node.tokens[2]) >= 0) {
      // "X: failed" > 0 and the like.
      out.positive.push([first])
    }
  }
  return out
}

/**
 * Whether an action node sets a condition: `set X`, `X = 1`, `X ++`, `X += 1`.
 * @param {string[]} tokens
 */
function setsCondition(tokens) {
  if (tokens[0] === 'set' && tokens[1]) return tokens[1]
  if (tokens.length === 2 && tokens[1] === '++') return tokens[0]
  if (tokens.length === 3 && ['=', '+='].includes(tokens[1]) && Number(tokens[2]) > 0) return tokens[0]
  return null
}

/**
 * @param {DataNode[]} nodes  every top-level node, in load order
 * @param {object} options
 * @param {(event: DataNode) => boolean} options.isRelevant  whether an event changes something the viewer shows
 * @param {(event: DataNode) => boolean} [options.isSignificant]  whether that's worth a choice:
 *   a branch that only rewords a description isn't
 * @param {Record<string, { label?: string, options?: Record<string, string>, default?: string }>} [options.labels]
 */
export function analyseEvents(nodes, { isRelevant, isSignificant = isRelevant, labels = {} }) {
  /** @type {Map<string, Mission>} */ const missions = new Map()
  /** @type {Map<string, DataNode>} */ const events = new Map()
  /** @type {Map<string, Trigger[]>} event -> what triggers it */ const triggersOf = new Map()
  /** @type {Map<string, Source[]>} condition -> what sets it */ const settersOf = new Map()
  const loadOrder = new Map()

  /** @param {string} key @param {Source} source */
  const addSetter = (key, source) => settersOf.set(key, [...(settersOf.get(key) ?? []), source])

  /**
   * Find the events a mission triggers and the conditions it sets.
   * @param {DataNode} node @param {Mission} mission @param {string} phase
   */
  function findActions(node, mission, phase) {
    for (const child of node.children) {
      const [key, value] = child.tokens
      if (key === 'event' && value && !child.children.length) {
        const min = Number(child.tokens[2] ?? 0)
        mission.triggers.push({ event: value, mission: mission.name, phase, delay: [min, Number(child.tokens[3] ?? min)] })
      } else {
        const condition = setsCondition(child.tokens)
        if (condition) addSetter(condition, { mission: mission.name, phase })
        findActions(child, mission, phase)
      }
    }
  }

  for (const node of nodes) {
    const [type, name] = node.tokens
    if (!name) continue
    if (type === 'event') {
      events.set(name, node)
      for (const child of node.children) {
        const condition = setsCondition(child.tokens)
        if (condition) addSetter(condition, { event: name })
      }
    } else if (type === 'mission' || type === 'conversation') {
      /** @type {Mission} */
      const mission = {
        name: type === 'mission' ? name : `conversation ${name}`,
        offer: { positive: [], negative: [], never: false },
        failIf: { positive: [], negative: [], never: false },
        triggers: [],
        // Whether the player can turn it down, which is what makes "not X:
        // done" on another mission an alternative rather than a timing guard.
        declinable: false,
        neverCompletes: false,
      }
      loadOrder.set(mission.name, loadOrder.size)
      /** @param {DataNode} n @param {string} token @returns {boolean} */
      const hasToken = (n, token) => n.tokens[0] === token || n.children.some(c => hasToken(c, token))
      if (type === 'conversation') findActions(node, mission, 'offer')
      for (const child of type === 'mission' ? node.children : []) {
        const [key, value] = child.tokens
        if (key === 'to' && value === 'offer') mission.offer = readConditions(child.children)
        else if (key === 'to' && value === 'fail') mission.failIf = readConditions(child.children)
        else if (key === 'to' && value === 'complete' && child.children.some(c => c.tokens[0] === 'never')) mission.neverCompletes = true
        else if (key === 'on' && value) {
          if (value === 'offer' && hasToken(child, 'decline')) mission.declinable = true
          findActions(child, mission, value)
        }
        // An NPC's "on kill" and the like are part of completing the mission.
        else if (key === 'npc') findActions(child, mission, 'complete')
      }
      missions.set(mission.name, mission)
      for (const t of mission.triggers) if (!mission.offer.never) triggersOf.set(t.event, [...(triggersOf.get(t.event) ?? []), t])
    }
  }

  const dateOf = (/** @type {string} */ event) => {
    const node = events.get(event)?.children.find(c => c.tokens[0] === 'date' && c.tokens.length >= 4)
    return node ? node.tokens.slice(1, 4).map(Number) : null
  }

  /**
   * What can make a reference true.
   * @param {string} ref
   * @returns {Source[]}
   */
  function sourcesOf(ref) {
    if (ref.startsWith('event: ')) return [{ event: ref.slice(7) }]
    const m = ref.match(MISSION_REF)
    const own = m && missions.has(m[1]) ? [{ mission: m[1], phase: STATUS_PHASE[m[2]] }] : []
    return [...own, ...(settersOf.get(ref) ?? [])]
  }

  // Missions whose completion leads nowhere, such as conversations that
  // always end by declining, or missions that can't be completed. For these,
  // being declined or failed is how the story moves on, not a branch.
  const continues = new Set()
  for (const m of missions.values())
    for (const ref of m.offer.positive.flat())
      for (const s of sourcesOf(ref))
        if (s.mission && AFTER_OFFER.has(s.phase ?? '')) continues.add(s.mission)
  const failForward = new Set([...missions.values()]
    .filter(m => m.neverCompletes || (!continues.has(m.name) && !m.triggers.some(t => AFTER_OFFER.has(t.phase))))
    .map(m => m.name))

  /** Whether a phase of a mission is on the path where the player completes missions. */
  const onPath = (/** @type {string} */ mission, /** @type {string} */ phase) =>
    SUCCESS_PHASES.has(phase) || (failForward.has(mission) && UNDONE_PHASES.has(phase))
  const pathTriggers = (/** @type {string} */ event) => (triggersOf.get(event) ?? []).filter(t => onPath(t.mission, t.phase))

  // -------------------------------------------------------------------------
  // Sides. A mission is on a side if one of its clauses can only be satisfied
  // from that side; an event, or any other condition, if everything that can
  // make it happen is.

  /**
   * @param {{ missions: string[], anchor?: { mission: string, phases: Set<string> } }} seed
   *   Missions wholly on the side, and optionally one mission of which only
   *   some phases are (an outcome's anchor).
   */
  function sideOf(seed) {
    const inMissions = new Set(seed.missions)
    const inEvents = new Set()
    const sourceIn = (/** @type {Source} */ s) => s.event ? inEvents.has(s.event)
      : inMissions.has(s.mission ?? '') || (seed.anchor?.mission === s.mission && seed.anchor.phases.has(s.phase ?? ''))
    const refIn = (/** @type {string} */ ref) => {
      const sources = sourcesOf(ref)
      return sources.length > 0 && sources.every(sourceIn)
    }
    for (let changed = true; changed;) {
      changed = false
      for (const name of events.keys()) {
        if (inEvents.has(name) || dateOf(name)) continue
        const ts = triggersOf.get(name) ?? []
        const setBy = settersOf.get(`event: ${name}`) ?? []
        if (ts.length && ts.every(t => sourceIn({ mission: t.mission, phase: t.phase })) && setBy.every(sourceIn)) {
          inEvents.add(name)
          changed = true
        }
      }
      for (const mission of missions.values()) {
        if (inMissions.has(mission.name) || mission.offer.never) continue
        if (mission.offer.positive.some(clause => clause.every(refIn))) {
          inMissions.add(mission.name)
          changed = true
        }
      }
    }
    return { missions: inMissions, events: inEvents }
  }

  // -------------------------------------------------------------------------
  // Candidate choices.

  /** The references a mission's offer requires outright. */
  const parentsOf = (/** @type {Mission} */ m) => new Set(m.offer.positive.filter(c => c.length === 1).map(c => c[0]))
  const shareParent = (/** @type {Mission} */ a, /** @type {Mission} */ b) => {
    const pa = parentsOf(a)
    return [...parentsOf(b)].some(p => pa.has(p))
  }
  /** The missions a reference depends on. */
  const missionsOf = (/** @type {string} */ ref) => sourcesOf(ref).flatMap(s =>
    s.mission ? [s.mission] : (triggersOf.get(s.event ?? '') ?? []).map(t => t.mission))

  /** @type {{ key: string, kind: 'outcome' | 'siblings', anchor?: string, oneWay?: boolean, options: { id: string, seed: any }[] }[]} */
  const candidates = []

  // Outcome choices: X done, or not.
  for (const x of missions.values()) {
    if (x.offer.never || failForward.has(x.name)) continue
    // An alternative storyline has to follow from X not being done. The
    // events of merely failing X are consequences, not a branch.
    const alternatives = [...missions.values()].filter(m => !m.offer.never && m !== x && (
      m.offer.positive.some(c => c.length === 1 && c[0].match(MISSION_REF)?.[1] === x.name && UNDONE.has(c[0].match(MISSION_REF)?.[2] ?? ''))
      || (x.declinable && m.offer.negative.includes(`${x.name}: done`) && shareParent(m, x))))
    if (!alternatives.length) continue
    candidates.push({
      key: x.name, kind: 'outcome', anchor: x.name,
      options: [
        { id: 'done', seed: { missions: [], anchor: { mission: x.name, phases: AFTER_OFFER } } },
        { id: 'not done', seed: { missions: alternatives.map(m => m.name), anchor: { mission: x.name, phases: UNDONE_PHASES } } },
      ],
    })
  }

  // Sibling choices: missions that exclude each other, grouped.
  const parent = new Map()
  const find = (/** @type {string} */ a) => { while (parent.get(a) !== a) a = parent.get(a); return a }
  const union = (/** @type {string} */ a, /** @type {string} */ b) => {
    for (const n of [a, b]) if (!parent.has(n)) parent.set(n, n)
    parent.set(find(a), find(b))
  }
  // Excluding a mission once it's merely done or active is a timing guard
  // (offer a hint only until the real thing is done, say).
  const excludes = (/** @type {Mission} */ a, /** @type {Mission} */ b) =>
    a.offer.negative.some(r => r.match(MISSION_REF)?.[1] === b.name && EXCLUDING.has(r.match(MISSION_REF)?.[2] ?? ''))
  /** The missions whose progress makes `a` fail. */
  const failSources = (/** @type {Mission} */ a) => new Set(a.failIf.positive.filter(c => c.length === 1)
    .filter(([ref]) => !UNDONE.has(ref.match(MISSION_REF)?.[2] ?? ''))
    .flatMap(([ref]) => missionsOf(ref)))
  /** Whether `a` fails once `b`, or a mission continuing straight from it, makes progress. */
  const failsOn = (/** @type {Mission} */ a, /** @type {Mission} */ b) => [...failSources(a)].some(name => {
    if (name === b.name) return true
    const next = missions.get(name)
    return next ? [...parentsOf(next)].some(ref => missionsOf(ref).includes(b.name)) : false
  })
  /** Missions that exclude another one way only: often optional side missions that lapse. */
  const oneWay = new Set()
  for (const a of missions.values()) {
    const others = new Set([...a.offer.negative.map(r => r.match(MISSION_REF)?.[1] ?? ''), ...failSources(a)])
    for (const name of others) {
      const b = missions.get(name)
      if (!b || b === a || a.offer.never || b.offer.never || !shareParent(a, b)) continue
      // A one-sided "not B: offered" is usually a timing guard (offer A only
      // until B comes along), so that needs to go both ways.
      const mutual = (excludes(a, b) && excludes(b, a)) || (failsOn(a, b) && (failsOn(b, a) || excludes(b, a)))
      if (mutual || failsOn(a, b)) union(a.name, b.name)
      if (!mutual && failsOn(a, b)) oneWay.add(a.name)
    }
  }
  /** @type {Map<string, string[]>} */
  const groups = new Map()
  for (const name of parent.keys()) groups.set(find(name), [...(groups.get(find(name)) ?? []), name])
  for (const members of groups.values()) {
    members.sort((a, b) => loadOrder.get(a) - loadOrder.get(b))
    candidates.push({
      key: members.join(' | '), kind: 'siblings', oneWay: members.some(m => oneWay.has(m)),
      options: members.map(m => ({ id: m, seed: { missions: [m] } })),
    })
  }

  // -------------------------------------------------------------------------
  // Keep the choices that decide something the viewer shows.

  const relevant = new Set([...events].filter(([, node]) => isRelevant(node)).map(([name]) => name))
  const choices = []
  /** Events of the paths not taken in branches too slight to offer. */
  const notTaken = new Set()
  for (const c of candidates) {
    const sides = c.options.map(o => sideOf(o.seed))
    let options = c.options.map((o, i) => {
      const own = [...sides[i].events].filter(e => sides.every((s, j) => j === i || !s.events.has(e)))
      return { id: o.id, missions: sides[i].missions, events: own.filter(e => relevant.has(e)) }
    })
    // Where missions exclude each other one way only, those that change
    // nothing are optional side missions that lapse, not options.
    if (c.oneWay) options = options.filter(o => o.events.length)
    if (options.length < 2 || !options.some(o => o.events.length)) continue
    // An outcome whose "not done" side changes nothing visible is just a
    // failure path, not a choice worth offering.
    if (c.kind === 'outcome' && !options[1].events.length) continue
    // A branch that only changes descriptive text takes its default path.
    if (!options.some(o => o.events.some(e => isSignificant(events.get(e) ?? { tokens: [], children: [], file: '', line: 0 })))) {
      const chosen = labels[c.key]?.default ?? options[0].id
      for (const o of options) if (o.id !== chosen) o.events.forEach(e => notTaken.add(e))
      continue
    }
    choices.push({ ...c, options })
  }

  // The same branch can be found in both forms: keep the first of any with
  // identical options.
  const seen = new Set()
  const unique = choices.filter(c => {
    const key = JSON.stringify(c.options.map(o => [...o.events].sort()).sort())
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Nesting: a choice that only arises on one option's side of another.
  const nested = unique.map(c => {
    const anchors = c.kind === 'outcome' ? [c.anchor ?? ''] : c.options.map(o => o.id)
    const under = unique.filter(p => p !== c).flatMap(p => p.options
      .filter(o => anchors.every(a => o.missions.has(a)) && p.options.every(q => q === o || !anchors.some(a => q.missions.has(a))))
      .map(o => ({ choice: p.key, option: o.id })))
    return { ...c, under }
  })

  // -------------------------------------------------------------------------
  // Order events as a playthrough would. Where a mission or event can be
  // reached several ways, the deepest counts: the shallow ways are usually
  // patches that let old saves catch up.

  const depth = new Map()
  /** @param {string} name @param {Set<string>} stack @returns {number} */
  function missionDepth(name, stack = new Set()) {
    if (depth.has(name)) return depth.get(name)
    if (stack.has(name)) return 0
    stack.add(name)
    let d = 0
    for (const ref of missions.get(name)?.offer.positive.flat() ?? [])
      for (const s of sourcesOf(ref))
        d = Math.max(d, s.event ? eventDepth(s.event, stack) : missionDepth(s.mission ?? '', stack) + 1)
    stack.delete(name)
    // Within a cycle this can come out a little shallow, which only affects
    // ordering, and memoising keeps it linear.
    depth.set(name, d)
    return d
  }
  /** @param {string} event @param {Set<string>} stack @returns {number} */
  function eventDepth(event, stack = new Set()) {
    if (dateOf(event)) return 0
    const ts = pathTriggers(event)
    return ts.length ? Math.max(...ts.map(t => missionDepth(t.mission, stack))) + 1 : 0
  }

  const choiceOf = new Map()
  for (const c of nested)
    for (const o of c.options)
      for (const e of o.events) choiceOf.set(e, [...(choiceOf.get(e) ?? []), { choice: c.key, option: o.id }])

  const eventOrder = new Map([...events.keys()].map((n, i) => [n, i]))
  const outEvents = [...relevant].map(name => {
    const date = dateOf(name)
    const path = pathTriggers(name)
    const all = triggersOf.get(name) ?? []
    const status = choiceOf.has(name) ? 'choice'
      : notTaken.has(name) ? 'alternative'
      : date || path.length ? 'assumed' : all.length ? 'alternative' : 'never'
    // Dated events first, by date; then by depth, phase and delay, taking
    // the deepest trigger.
    const last = [...path].sort((a, b) => missionDepth(b.mission) - missionDepth(a.mission)
      || (PHASE_ORDER[b.phase] ?? 3) - (PHASE_ORDER[a.phase] ?? 3) || b.delay[0] - a.delay[0])[0]
    const sort = date ? [-1, date[2], date[1], date[0]]
      : last ? [missionDepth(last.mission), PHASE_ORDER[last.phase] ?? 3, last.delay[0]] : [Infinity]
    return {
      name, sort,
      file: events.get(name)?.file ?? null,
      date: date ? `${date[2]}-${String(date[1]).padStart(2, '0')}-${String(date[0]).padStart(2, '0')}` : null,
      status,
      choices: choiceOf.get(name) ?? [],
      triggers: all.map(t => ({ mission: t.mission, phase: t.phase, delay: t.delay })),
    }
  })
  const compare = (/** @type {number[]} */ a, /** @type {number[]} */ b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
    return 0
  }
  outEvents.sort((a, b) => compare(a.sort, b.sort) || eventOrder.get(a.name) - eventOrder.get(b.name))

  return {
    events: Object.fromEntries(outEvents.map(({ name, sort, ...rest }, order) => [name, { ...rest, order }])),
    choices: nested.map(c => {
      const label = labels[c.key] ?? {}
      return {
        key: c.key, kind: c.kind, label: label.label ?? null, under: c.under,
        default: label.default ?? c.options[0].id,
        options: c.options.map(o => ({ id: o.id, label: label.options?.[o.id] ?? null, events: o.events })),
      }
    }),
  }
}
