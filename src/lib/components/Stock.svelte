<script>
  // What a planet's outfitters or shipyards sell, merged and grouped by
  // category in the order the game lists them (categories.txt). Clicking an
  // item shows where else it's sold.
  let { galaxy, kind, shops, onFindItem } = $props()

  const isShips = $derived(kind === 'ship')
  let groups = $derived.by(() => {
    const table = isShips ? galaxy.shipyards : galaxy.outfitters
    const categories = isShips ? galaxy.categories.ships : galaxy.categories.outfits
    const order = isShips ? galaxy.categories.order.ships : galaxy.categories.order.outfits
    /** @type {Map<string, string[]>} */
    const byCategory = new Map()
    for (const shop of shops)
      for (const item of table[shop]?.items ?? []) {
        const category = categories[item] ?? 'Other'
        const list = byCategory.get(category) ?? []
        if (!list.includes(item)) byCategory.set(category, [...list, item])
      }
    const rank = (/** @type {string} */ c) => (order.includes(c) ? order.indexOf(c) : order.length)
    return [...byCategory]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([category, items]) => ({ category, items: items.sort() }))
  })
  let count = $derived(groups.reduce((n, g) => n + g.items.length, 0))
</script>

<details class="stock">
  <summary>
    {count} {isShips ? (count === 1 ? 'ship' : 'ships') : count === 1 ? 'outfit' : 'outfits'}
    <span class="muted">· {shops.join(', ')}</span>
  </summary>
  {#each groups as { category, items } (category)}
    <div class="category">{category}</div>
    <div class="items">
      {#each items as item (item)}
        <button onclick={() => onFindItem(kind, item)} title="Where else is it sold?">{item}</button>
      {/each}
    </div>
  {:else}
    <p class="muted">Nothing in stock.</p>
  {/each}
</details>

<style>
  summary {
    cursor: pointer;
  }

  .category {
    margin-top: 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-medium);
  }

  .items {
    display: flex;
    flex-wrap: wrap;
    gap: 0 10px;
  }

  .items button {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-bright);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .items button:hover {
    text-decoration: underline;
  }

  .muted {
    color: var(--text-medium);
  }

  p {
    margin: 4px 0 0;
  }
</style>
