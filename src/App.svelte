<script>
  import GalaxyMap from './lib/components/GalaxyMap.svelte'
  import Legend from './lib/components/Legend.svelte'
  import Search from './lib/components/Search.svelte'
  import SystemPanel from './lib/components/SystemPanel.svelte'
  import StoryMenu from './lib/components/StoryMenu.svelte'
  import { applyEvents, eventsToApply } from './lib/data/applyEvents.js'
  import { systemColors } from './lib/utils/colors.js'
  import { load, save } from './lib/utils/persisted.js'

  /** The galaxy as extracted: its base state, before any story event. @type {any} */
  let base = $state.raw(null)
  let error = $state('')

  fetch('data/galaxy.json')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
    .then(data => (base = data))
    .catch(e => (error = String(e.message ?? e)))

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
    }),
  )
  $effect(() => save('settings', $state.snapshot(settings)))

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

  // Without events nothing is changed by them, so fall back to governments.
  let mode = $derived(settings.mode === 'events' && !settings.storyEvents ? 'government' : settings.mode)
  let colors = $derived(galaxy ? systemColors(galaxy, mode) : [])
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

  /** @param {string | null} name @param {boolean} fly */
  function select(name, fly) {
    selected = name
    map?.select(name, fly)
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) select(null, false)
  }

  let hoveredSystem = $derived(hovered ? systemsByName.get(hovered) : null)
</script>

<svelte:window onkeydown={onKeydown} />

{#if error}
  <div class="message">
    <h1>No galaxy data</h1>
    <p>Couldn't load <code>data/galaxy.json</code> ({error}).</p>
    <p>Extract it from an Endless Sky checkout first: <code>npm run extract -- /path/to/endless-sky</code></p>
  </div>
{:else if !galaxy}
  <div class="message"><p>Loading the galaxy…</p></div>
{:else}
  <GalaxyMap
    {galaxy}
    {colors}
    {options}
    bind:api={map}
    onSelect={(/** @type {string | null} */ name) => select(name, false)}
    onHover={(/** @type {string | null} */ name) => (hovered = name)}
    onViewChange={(/** @type {number[]} */ c) => (center = c)}
  />

  <div class="toolbar">
    <div class="panel title">
      <h1>Endless Sky Galaxy</h1>
      <span class="version" title="{galaxy.source.path} ({galaxy.source.branch}, {galaxy.source.date})">
        {galaxy.source.describe ?? 'unknown version'}
      </span>
    </div>

    <Search {galaxy} onSelectSystem={(/** @type {string} */ name) => select(name, true)} />

    <select bind:value={settings.mode} aria-label="Colour systems by">
      <option value="government">Government</option>
      <option value="stars">Star class</option>
      <option value="visibility">Map visibility</option>
      <option value="events" disabled={!settings.storyEvents}>Changed by story events</option>
      <optgroup label="Commodity price">
        {#each galaxy.commodities as c (c.name)}
          <option value="commodity:{c.name}">{c.name}</option>
        {/each}
      </optgroup>
    </select>

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
          <button class="reset" onclick={() => map?.resetView()}>Reset view</button>
        </div>
      {/if}
    </div>
  </div>

  <Legend {galaxy} {mode} {center} />

  {#if hoveredSystem && hoveredSystem.name !== selected}
    <div class="panel hover">
      {hoveredSystem.displayName ?? hoveredSystem.name}
      <span class="muted">· {galaxy.governments[hoveredSystem.government]?.displayName ?? hoveredSystem.government ?? 'None'}</span>
    </div>
  {/if}

  {#if selected && systemsByName.get(selected)}
    {#key selected}
      <SystemPanel
        {galaxy}
        system={systemsByName.get(selected)}
        planets={planetsByName}
        onSelectSystem={(/** @type {string} */ name) => select(name, true)}
        onClose={() => select(null, false)}
      />
    {/key}
  {/if}

  <div class="hint">Drag to pan · right-drag to tilt and turn · scroll to zoom · double-click a system to close in</div>
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
