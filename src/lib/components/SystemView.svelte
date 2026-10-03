<script>
  import { onMount } from 'svelte'
  import { createSystemScene } from '../three/createSystemScene.js'
  import { dateFromDays, daysSinceEpoch } from '../data/orbits.js'

  // A system's stellar objects on their orbits, on a date that can be set or
  // played forward. Starts on the day a new game does.
  let { galaxy, system, selectedPlanet, panelOpen = true, onSelectPlanet, onShowPanel, onClose } = $props()

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const start = galaxy.startDate ?? [16, 11, 3013]
  const startDays = daysSinceEpoch(start[0], start[1], start[2])
  const SPEEDS = [1, 10, 100, 1000]

  /** @type {HTMLDivElement} */
  let container
  /** @type {ReturnType<typeof createSystemScene> | null} */
  let scene = $state(null)
  let days = $state(startDays)
  let playing = $state(false)
  let speed = $state(1)
  let showBackground = $state(true)

  onMount(() => {
    scene = createSystemScene(container, galaxy, system, { onSelect: name => onSelectPlanet(name) })
    scene.setDays(days)
    return () => scene?.dispose()
  })

  $effect(() => scene?.play(playing ? speed : 0, d => (days = d)))
  $effect(() => scene?.select(selectedPlanet))
  $effect(() => scene?.setBackground(showBackground))

  let date = $derived(dateFromDays(Math.floor(days)))
  let isoDate = $derived(`${String(date[2]).padStart(4, '0')}-${String(date[1]).padStart(2, '0')}-${String(date[0]).padStart(2, '0')}`)

  /** @param {Event} e */
  function setDate(e) {
    const [y, m, d] = (/** @type {HTMLInputElement} */ (e.target)).value.split('-').map(Number)
    if (!y || !m || !d) return
    days = daysSinceEpoch(d, m, y)
    scene?.setDays(days)
  }

  function reset() {
    playing = false
    days = startDays
    scene?.setDays(days)
    scene?.resetView()
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
    if (e.key === 'Escape') onClose()
    else if (e.key === 'Home') scene?.resetView()
    else if (e.key === ' ') {
      playing = !playing
      e.preventDefault()
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="system-view">
  <div class="scene" bind:this={container}></div>

  <div class="toolbar">
    <button onclick={onClose} title="Back to the galaxy map (Esc)">← Galaxy</button>
    <div class="panel title">
      <h1>{system.displayName ?? system.name}</h1>
      <span class="date">{date[0]} {MONTHS[date[1] - 1]} {date[2]}</span>
    </div>
    <div class="panel controls">
      <input type="date" value={isoDate} onchange={setDate} aria-label="Date" />
      <button onclick={() => (playing = !playing)} title="Play or pause (space)">{playing ? '❚❚' : '▶'}</button>
      <select bind:value={speed} aria-label="Days per second">
        {#each SPEEDS as s}<option value={s}>{s} {s === 1 ? 'day' : 'days'}/s</option>{/each}
      </select>
      <button onclick={reset} title="Back to the day a new game starts">Reset</button>
    </div>
    <label class="panel toggle" title="The stars and haze the game draws behind the system">
      <input type="checkbox" bind:checked={showBackground} /> Background
    </label>
    {#if !panelOpen}<button onclick={onShowPanel}>Details</button>{/if}
  </div>

  <div class="hint">Drag to pan · right-drag to tilt and turn · scroll to zoom · click a planet or station · space to play · Home to reset view · Esc to leave</div>
</div>

<style>
  .system-view {
    position: absolute;
    inset: 0;
    background: #000;
  }

  .scene {
    position: absolute;
    inset: 0;
    isolation: isolate;
  }

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

  .date {
    font-size: 12px;
    color: var(--text-medium);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    cursor: pointer;
  }

  .controls button {
    min-width: 2.2em;
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

  :global(.object-name) {
    color: rgba(190, 190, 190, 0.9);
    font: 13px var(--font);
    white-space: nowrap;
    text-shadow: 0 0 3px #000, 0 0 2px #000;
    pointer-events: auto;
    cursor: pointer;
  }

  :global(.object-name .leads) {
    font-size: 11px;
    color: rgba(190, 140, 255, 0.9);
    text-align: center;
  }

  :global(.hazard-label) {
    font: 11px var(--font);
    white-space: nowrap;
    opacity: 0.85;
    text-shadow: 0 0 3px #000;
  }

  :global(.belt-name) {
    color: rgba(150, 125, 90, 0.8);
    font: 11px var(--font);
    font-style: italic;
    white-space: nowrap;
    text-shadow: 0 0 3px #000;
  }

  :global(.object-name.selected) {
    color: #fff;
    font-weight: 500;
  }

  @media (max-width: 700px) {
    .hint {
      display: none;
    }
  }
</style>
