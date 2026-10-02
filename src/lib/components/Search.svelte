<script>
  // Find a system by its name or the name of a planet in it, or an outfit or
  // ship to see where it's sold.
  let { galaxy, onSelectSystem, onFindItem } = $props()

  const LIMIT = 12

  let query = $state('')
  let active = $state(0)
  let open = $state(false)

  let entries = $derived([
    ...galaxy.systems.map((/** @type {any} */ s) => ({ label: s.displayName ?? s.name, system: s.name, kind: 'system' })),
    ...galaxy.planets
      .filter((/** @type {any} */ p) => p.system)
      .map((/** @type {any} */ p) => ({ label: p.displayName ?? p.name, system: p.system, kind: p.system })),
    ...itemsSold('outfit', galaxy.outfitters),
    ...itemsSold('ship', galaxy.shipyards),
  ])

  /** Every item some planet's shop sells. @param {'outfit' | 'ship'} type @param {Record<string, any>} shops */
  function itemsSold(type, shops) {
    const listed = new Set(galaxy.planets.flatMap((/** @type {any} */ p) => (type === 'ship' ? p.shipyards : p.outfitters)))
    const items = new Set([...listed].flatMap(shop => shops[shop]?.items ?? []))
    return [...items].map(item => ({ label: item, system: null, item: type, kind: type === 'ship' ? 'ship for sale' : 'outfit for sale' }))
  }

  let results = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return entries
      .filter(e => e.label.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)) || a.label.localeCompare(b.label))
      .slice(0, LIMIT)
  })

  /** @param {{ system: string | null, item?: string, label: string }} entry */
  function choose(entry) {
    if (entry.item) onFindItem(entry.item, entry.label)
    else if (entry.system) onSelectSystem(entry.system)
    query = ''
    open = false
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (e.key === 'ArrowDown') active = Math.min(active + 1, results.length - 1)
    else if (e.key === 'ArrowUp') active = Math.max(active - 1, 0)
    else if (e.key === 'Enter' && results[active]) choose(results[active])
    else if (e.key === 'Escape') {
      query = ''
      ;(/** @type {HTMLInputElement} */ (e.target)).blur()
    } else return
    e.preventDefault()
  }
</script>

<div class="search">
  <input
    type="search"
    placeholder="Find a system, planet, outfit or ship"
    bind:value={query}
    oninput={() => ((active = 0), (open = true))}
    onfocus={() => (open = true)}
    onblur={() => setTimeout(() => (open = false), 150)}
    onkeydown={onKeydown}
  />
  {#if open && results.length}
    <ul class="panel">
      {#each results as entry, i}
        <li>
          <button class:active={i === active} onmousedown={() => choose(entry)}>
            {entry.label}
            {#if entry.item}<span class="where">{entry.kind}</span>
            {:else if entry.kind !== 'system'}<span class="where">in {entry.kind}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .search {
    position: relative;
  }

  input {
    width: 270px;
  }

  ul {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 4px 0;
    list-style: none;
    z-index: 10;
  }

  li button {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    border-radius: 0;
    padding: 3px 10px;
  }

  li button.active,
  li button:hover {
    background: var(--control-hover);
    color: var(--text-bright);
  }

  .where {
    color: var(--text-medium);
    font-size: 12px;
  }
</style>
