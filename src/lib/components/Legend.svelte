<script>
  import { css, CHANGE_COLORS, EVENT_COLORS, governmentColor, SELLS_COLOR, systemsSelling, STAR_CLASS_COLORS, valueColor, VISIBILITY_COLORS } from '../utils/colors.js'

  // `center` is the map position the view is centred on; in government mode,
  // the legend lists the governments nearest it, as the game's map key does.
  let { galaxy, mode, center, compareVersion = null } = $props()

  const LIMIT = 8

  let nearby = $derived.by(() => {
    if (mode !== 'government') return []
    // Keyed by display name, as several governments share one (e.g. the Quarg variants).
    /** @type {Map<string, { government: string, distance: number }>} */
    const nearest = new Map()
    for (const s of galaxy.systems) {
      if (!s.government || s.government === 'Uninhabited') continue
      const label = galaxy.governments[s.government]?.displayName ?? s.government
      const distance = Math.hypot(s.pos[0] - center[0], s.pos[1] - center[1])
      if (distance < (nearest.get(label)?.distance ?? Infinity)) nearest.set(label, { government: s.government, distance })
    }
    return [...nearest.values()].sort((a, b) => a.distance - b.distance).slice(0, LIMIT).map(n => n.government)
  })

  let commodity = $derived(mode.startsWith('commodity:') ? galaxy.commodities.find((/** @type {any} */ c) => c.name === mode.slice(10)) : null)
</script>

<div class="panel legend">
  {#if mode === 'government'}
    {#each nearby as name (name)}
      <div class="row">
        <span class="ring" style:color={css(governmentColor(galaxy, name))}></span>
        {galaxy.governments[name]?.displayName ?? name}
      </div>
    {/each}
    <div class="row">
      <span class="ring" style:color={css(governmentColor(galaxy, 'Uninhabited'))}></span>
      Uninhabited
    </div>
  {:else if mode === 'stars'}
    {#each Object.entries(STAR_CLASS_COLORS) as [name, color]}
      <div class="row"><span class="ring" style:color={css(color)}></span>{name === 'none' ? 'No star' : name.length === 1 ? `${name} class` : name}</div>
    {/each}
  {:else if mode === 'icons'}
    <div class="row muted-row">Each system's stars, as the in-game map draws them</div>
  {:else if mode === 'visibility'}
    {#each Object.entries(VISIBILITY_COLORS) as [name, color]}
      <div class="row"><span class="ring" style:color={css(color)}></span>{name}</div>
    {/each}
  {:else if mode.startsWith('sells:')}
    {@const count = systemsSelling(galaxy, mode).size}
    <div class="row title">{mode.split(':').slice(2).join(':')}</div>
    <div class="row"><span class="ring" style:color={css(SELLS_COLOR)}></span>Sold here ({count} {count === 1 ? 'system' : 'systems'})</div>
    <div class="row"><span class="ring" style:color={css(EVENT_COLORS.unchanged)}></span>Not sold</div>
  {:else if mode === 'changes'}
    <div class="row title">Since {compareVersion}</div>
    {#each Object.entries(CHANGE_COLORS) as [name, color]}
      <div class="row"><span class="ring" style:color={css(color)}></span>{name[0].toUpperCase() + name.slice(1)}</div>
    {/each}
  {:else if mode === 'events'}
    {#each Object.entries(EVENT_COLORS) as [name, color]}
      <div class="row"><span class="ring" style:color={css(color)}></span>{name[0].toUpperCase() + name.slice(1)}</div>
    {/each}
  {:else if commodity}
    <div class="row title">{commodity.name}</div>
    <div class="gradient" style:background="linear-gradient(to right, {[-1, -0.5, 0, 0.5, 1].map(v => css(valueColor(v))).join(', ')})"></div>
    <div class="row scale"><span>{commodity.low}</span><span>{commodity.high}</span></div>
    <div class="row">
      <span class="ring" style:color={css(governmentColor(galaxy, 'Uninhabited'))}></span>
      No trade
    </div>
  {/if}
</div>

<style>
  .legend {
    position: absolute;
    left: 12px;
    bottom: 12px;
    padding: 8px 12px;
    min-width: 160px;
    font-size: 13px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    line-height: 1.6;
  }

  .muted-row {
    max-width: 180px;
    color: var(--text-medium);
  }

  .title {
    color: var(--text-bright);
  }

  .ring {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 2.5px solid currentColor;
  }

  .gradient {
    height: 8px;
    border-radius: 4px;
    margin: 4px 0 0;
  }

  .scale {
    justify-content: space-between;
    color: var(--text-medium);
    font-variant-numeric: tabular-nums;
  }
</style>
