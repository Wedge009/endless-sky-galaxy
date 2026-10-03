<script>
  import GalaxyMap from './lib/components/GalaxyMap.svelte'
  import Legend from './lib/components/Legend.svelte'
  import Search from './lib/components/Search.svelte'
  import SystemPanel from './lib/components/SystemPanel.svelte'
  import SystemView from './lib/components/SystemView.svelte'
  import ChangesMenu from './lib/components/ChangesMenu.svelte'
  import StoryMenu from './lib/components/StoryMenu.svelte'
  import { applyEvents, eventsToApply } from './lib/data/applyEvents.js'
  import { compareGalaxies } from './lib/data/compareGalaxies.js'
  import { defaultComparison } from './lib/data/versions.js'
  import { CHANGE_COLORS, systemColors } from './lib/utils/colors.js'
  import { load, save } from './lib/utils/persisted.js'

  /** The versions stored (data/versions.json). @type {{ versions: import('./lib/data/versions.js').Version[], default: string } | null} */
  let index = $state.raw(null)
  let error = $state('')
  /** Each version's galaxy as extracted, once loaded. @type {Record<string, any>} */
  let loaded = $state.raw({})
  const loading = new Set()

  /** @param {Response} r */
  const json = r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`)))
  fetch('data/versions.json')
    .then(json)
    .then(data => (index = data))
    .catch(e => (error = String(e.message ?? e)))

  /** Fetch a version's galaxy, if it isn't already. @param {string} id */
  function loadVersion(id) {
    const version = index?.versions.find(v => v.id === id)
    if (!version || loaded[id] || loading.has(id)) return
    loading.add(id)
    fetch(`data/${version.file}`)
      .then(json)
      .then(data => (loaded = { ...loaded, [id]: data }))
      .catch(e => (error = String(e.message ?? e)))
  }

  let settings = $state(
    load('settings', {
      mode: 'government',
      hiddenSystems: true,
      names: true,
      regions: true,
      eventRegions: true,
      backdrop: true,
      wormholes: true,
      storyEvents: true,
      /** @type {Record<string, string>} choice key -> chosen option */
      choices: {},
      /** @type {string | null} the version last shown */
      version: null,
      /** The version to compare with: '' for the one before, or 'none'. */
      compare: '',
    }),
  )
  $effect(() => save('settings', $state.snapshot(settings)))

  // The version shown: the one in the address, else the one last shown, else
  // the index's default (the newest stable release).
  /** @type {string | null} */
  let asked = $state(decodeURIComponent(location.hash.slice(1)) || null)
  const stored = (/** @type {string | null} */ id) => !!id && !!index?.versions.some(v => v.id === id)
  let shown = $derived(index && (stored(asked) ? asked : stored(settings.version) ? settings.version : index.default))
  $effect(() => {
    if (!shown) return
    loadVersion(shown)
    settings.version = shown
    history.replaceState(null, '', `#${encodeURIComponent(shown)}`)
  })
  /** The version on screen: the one asked for once it's loaded, until then the last. @type {string | null} */
  let current = $state(null)
  $effect(() => {
    if (shown && loaded[shown]) current = shown
  })
  /** The galaxy as extracted: its base state, before any story event. */
  let base = $derived(current ? loaded[current] : null)

  /** The version to show changes since. */
  let compareId = $derived(!index || !current || settings.compare === 'none' ? null
    : stored(settings.compare) && settings.compare !== current ? settings.compare
    : defaultComparison(index.versions, current))
  $effect(() => {
    if (compareId) loadVersion(compareId)
  })
  let compareBase = $derived(compareId ? loaded[compareId] ?? null : null)

  /** Where the map was looking, kept across a change of version. @type {any} */
  let savedView = null
  /** @param {string} id */
  function chooseVersion(id) {
    if (id === current) return
    savedView = map?.getView() ?? null
    asked = id
  }

  // A link to another version, followed from this page, changes only the
  // address's hash, not the page.
  function onHashChange() {
    const id = decodeURIComponent(location.hash.slice(1))
    if (id) chooseVersion(id)
  }

  let options = $derived({
    hiddenSystems: settings.hiddenSystems,
    names: settings.names,
    regions: settings.regions,
    eventRegions: settings.eventRegions,
    backdrop: settings.backdrop,
    wormholes: settings.wormholes,
  })

  let applied = $derived(base && settings.storyEvents ? eventsToApply(base, settings.choices) : [])
  /** The galaxy shown: the base state, or after the story's events. @type {any} */
  let galaxy = $derived(base && (settings.storyEvents ? applyEvents(base, applied) : base))
  // The compared version in the same state: with its own story events, for the
  // same choices where it has them, or without any.
  let previous = $derived(compareBase && (settings.storyEvents
    ? applyEvents(compareBase, eventsToApply(compareBase, settings.choices))
    : compareBase))
  let changes = $derived(galaxy && previous ? compareGalaxies(galaxy, previous) : null)

  // Without events nothing is changed by them, and without another version
  // nothing has changed since, so fall back to governments.
  let mode = $derived((settings.mode === 'events' && !settings.storyEvents) || (settings.mode === 'changes' && !changes)
    ? 'government' : settings.mode)
  let colors = $derived(galaxy ? systemColors(galaxy, mode, changes) : [])
  /** What the map draws over the systems in the changes mode. */
  let changeOverlay = $derived.by(() => {
    if (mode !== 'changes' || !changes) return null
    const positions = new Map([...previous.systems, ...galaxy.systems].map((/** @type {any} */ s) => [s.name, s.pos]))
    const link = (/** @type {string[]} */ l, /** @type {number[]} */ color) => ({ from: positions.get(l[0]), to: positions.get(l[1]), color })
    return {
      ghosts: changes.removedSystems.map((/** @type {any} */ s) => ({ name: s.displayName ?? s.name, pos: s.pos })),
      ghostColor: CHANGE_COLORS.removed,
      links: [
        ...changes.addedLinks.map(l => link(l, CHANGE_COLORS.new)),
        ...changes.removedLinks.map(l => link(l, CHANGE_COLORS.removed)),
      ],
    }
  })
  let systemsByName = $derived(galaxy ? new Map(galaxy.systems.map((/** @type {any} */ s) => [s.name, s])) : new Map())
  let planetsByName = $derived(galaxy ? new Map(galaxy.planets.map((/** @type {any} */ p) => [p.name, p])) : new Map())

  /** @type {string | null} */
  let selected = $state(null)
  /** @type {string | null} */
  let hovered = $state(null)
  let center = $state([0, 0])
  let showSettings = $state(false)
  /** @type {any} */
  let map = $state(null)

  /** Whether the selected system is open in the system view. */
  let viewing = $state(false)
  /** @type {string | null} the planet picked in the system view */
  let focusPlanet = $state(null)
  /** In the system view, the panel can be put away without leaving. */
  let panelOpen = $state(true)

  /** @param {string | null} name @param {boolean} fly */
  function select(name, fly) {
    if (name !== selected) {
      viewing = false
      focusPlanet = null
      panelOpen = true
    }
    selected = name
    map?.select(name, fly)
  }

  /** Colour the map by where an outfit or ship is sold. @param {'outfit' | 'ship'} kind @param {string} item */
  function findItem(kind, item) {
    settings.mode = `sells:${kind}:${item}`
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    // Leave the keys to a field that has them, such as the search box.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
    // The system view has keys of its own, Esc to leave it among them.
    if (viewing) return
    if (e.key === 'Escape') select(null, false)
    else if (e.key === 'Home') map?.resetView()
  }

  let hoveredSystem = $derived(hovered ? systemsByName.get(hovered) : null)

  // A new map after a change of version marks the selection again, if the
  // system is still there.
  $effect(() => {
    if (!map || !galaxy) return
    if (selected && !systemsByName.has(selected)) select(null, false)
    else map.select(selected, false)
  })
</script>

<svelte:window onkeydown={onKeydown} onhashchange={onHashChange} />

{#if error}
  <div class="message">
    <h1>No galaxy data</h1>
    <p>Couldn't load the extracted data ({error}).</p>
    <p>Extract some versions of the game first, such as the last three stable releases: <code>npm run extract -- --releases 3</code></p>
  </div>
{:else if !galaxy}
  <div class="message"><p>Loading the galaxy…</p></div>
{:else}
  <!-- A new version can have other systems, so it gets a new map, looking where the last one was. -->
  {#key current}
  <GalaxyMap
    {galaxy}
    initialView={savedView}
    {colors}
    {options}
    changes={changeOverlay}
    starIcons={mode === 'icons'}
    paused={viewing}
    bind:api={map}
    onSelect={(/** @type {string | null} */ name) => select(name, false)}
    onHover={(/** @type {string | null} */ name) => (hovered = name)}
    onViewChange={(/** @type {number[]} */ c) => (center = c)}
  />
  {/key}

  {#if viewing && selected && systemsByName.get(selected)}
    {#key selected}
      <SystemView
        {galaxy}
        system={systemsByName.get(selected)}
        selectedPlanet={focusPlanet}
        onSelectPlanet={(/** @type {string | null} */ name) => {
          focusPlanet = name
          if (name) panelOpen = true
        }}
        {panelOpen}
        onShowPanel={() => (panelOpen = true)}
        onClose={() => ((viewing = false), (focusPlanet = null), (panelOpen = true))}
      />
    {/key}
  {/if}

  <div class="toolbar" class:hidden={viewing}>
    <div class="panel title">
      <h1>Endless Sky Galaxy</h1>
      <select
        class="version"
        value={current}
        onchange={e => chooseVersion((/** @type {HTMLSelectElement} */ (e.target)).value)}
        aria-label="Version of the game"
        title="{galaxy.source.path} ({galaxy.source.branch}, {galaxy.source.date?.slice(0, 10)})"
      >
        {#each index?.versions ?? [] as v (v.id)}
          <option value={v.id}>{v.id}{v.stable ? '' : ` (${v.kind === 'local' ? 'local' : 'development'})`}</option>
        {/each}
      </select>
    </div>

    <Search {galaxy} onSelectSystem={(/** @type {string} */ name) => select(name, true)} onFindItem={findItem} />

    <select bind:value={settings.mode} aria-label="Colour systems by">
      <option value="government">Government</option>
      <option value="stars">Star class</option>
      <option value="icons">Star icons</option>
      <option value="visibility">Map visibility</option>
      <option value="events" disabled={!settings.storyEvents}>Changed by story events</option>
      {#if compareBase}<option value="changes">Changed since {compareId}</option>{/if}
      {#if settings.mode.startsWith('sells:')}
        <option value={settings.mode}>Where to buy {settings.mode.split(':').slice(2).join(':')}</option>
      {/if}
      <optgroup label="Commodity price">
        {#each galaxy.commodities as c (c.name)}
          <option value="commodity:{c.name}">{c.name}</option>
        {/each}
      </optgroup>
    </select>

    {#if (index?.versions.length ?? 0) > 1}
      <ChangesMenu
        {changes}
        version={compareId}
        versions={index?.versions.filter(v => v.id !== current) ?? []}
        onPickVersion={(/** @type {string} */ id) => (settings.compare = id)}
        onShow={() => (settings.mode = 'changes')}
        onSelectSystem={(/** @type {string} */ name) => select(name, true)}
      />
    {/if}

    <StoryMenu {galaxy} bind:enabled={settings.storyEvents} bind:choices={settings.choices} appliedCount={applied.length} />

    <div class="settings">
      <button onclick={() => (showSettings = !showSettings)} aria-expanded={showSettings}>View ▾</button>
      {#if showSettings}
        <div class="panel menu">
          <label><input type="checkbox" bind:checked={settings.hiddenSystems} /> Hidden and inaccessible systems</label>
          <label><input type="checkbox" bind:checked={settings.names} /> System names</label>
          <label><input type="checkbox" bind:checked={settings.regions} /> Region labels</label>
          <label class="indent">
            <input type="checkbox" bind:checked={settings.eventRegions} disabled={!settings.regions} /> Including those revealed by events
          </label>
          <label><input type="checkbox" bind:checked={settings.wormholes} /> Wormholes</label>
          <label><input type="checkbox" bind:checked={settings.backdrop} /> Milky Way backdrop</label>
          <button class="reset" onclick={() => map?.resetView()} title="Home">Reset view</button>
        </div>
      {/if}
    </div>
  </div>

  {#if !viewing}<Legend {galaxy} {mode} {center} compareVersion={compareId} />{/if}

  {#if !viewing && hoveredSystem && hoveredSystem.name !== selected}
    <div class="panel hover">
      {hoveredSystem.displayName ?? hoveredSystem.name}
      <span class="muted">· {galaxy.governments[hoveredSystem.government]?.displayName ?? hoveredSystem.government ?? 'None'}</span>
    </div>
  {/if}

  {#if selected && systemsByName.get(selected) && (!viewing || panelOpen)}
    {#key selected}
      <SystemPanel
        {galaxy}
        system={systemsByName.get(selected)}
        planets={planetsByName}
        change={changes?.systems.get(selected)}
        compareVersion={compareId}
        onFindItem={findItem}
        {viewing}
        {focusPlanet}
        onEnter={() => (viewing = true)}
        onSelectSystem={(/** @type {string} */ name) => select(name, true)}
        onClose={() => (viewing ? (panelOpen = false) : select(null, false))}
      />
    {/key}
  {/if}

  <div class="hint" class:hidden={viewing}>Drag to pan · right-drag to tilt and turn · scroll to zoom · double-click a system to close in · Home to reset view</div>
{/if}

<style>
  .toolbar {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }

  .toolbar > :global(*) {
    pointer-events: auto;
  }

  .title {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 3px 12px;
  }

  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
    color: var(--text-bright);
  }

  .version {
    font-size: 12px;
    color: var(--text-medium);
    background: transparent;
    border: none;
    padding: 0 2px;
    cursor: pointer;
  }

  .hidden {
    display: none;
  }

  .settings {
    position: relative;
  }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    white-space: nowrap;
    z-index: 10;
  }

  .menu label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .menu .indent {
    padding-left: 20px;
    color: var(--text-medium);
  }

  .reset {
    margin-top: 6px;
    align-self: flex-start;
  }

  .hover {
    position: absolute;
    left: 50%;
    bottom: 36px;
    transform: translateX(-50%);
    padding: 4px 12px;
    pointer-events: none;
    color: var(--text-bright);
  }

  .muted {
    color: var(--text-medium);
  }

  .hint {
    position: absolute;
    left: 50%;
    bottom: 10px;
    transform: translateX(-50%);
    font-size: 12px;
    color: var(--text-dim);
    pointer-events: none;
    white-space: nowrap;
  }

  .message {
    display: grid;
    place-content: center;
    height: 100%;
    text-align: center;
  }

  code {
    color: var(--text-bright);
  }

  @media (max-width: 700px) {
    .hint {
      display: none;
    }
  }
</style>
