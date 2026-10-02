<script>
  // What's changed since another version of the game: the systems added,
  // removed or changed, to jump to, and a way to see them on the map.
  let { changes, version, onShow, onSelectSystem } = $props()

  let open = $state(false)

  /** @param {'added' | 'removed' | 'changed' | 'reworded'} status */
  const systemsWith = status => [...changes.systems.values()]
    .filter(c => c.status === status)
    .sort((a, b) => a.name.localeCompare(b.name))

  let groups = $derived([
    { title: 'New systems', status: 'added', list: systemsWith('added') },
    { title: 'Removed systems', status: 'removed', list: systemsWith('removed') },
    { title: 'Changed systems', status: 'changed', list: systemsWith('changed') },
    { title: 'Descriptions rewritten only', status: 'reworded', list: systemsWith('reworded') },
  ])
  let { counts } = $derived(changes)
  let nothing = $derived(!counts.added && !counts.removed && !counts.changed && !counts.reworded && !counts.addedLinks && !counts.removedLinks)

  /** A few words on what changed in a system. @param {any} c */
  const gist = c => {
    const whats = c.changes.map((/** @type {any} */ x) => x.what.replace(/^[^:]+: /, ''))
    return [...new Set(whats)].slice(0, 3).join(', ') + (new Set(whats).size > 3 ? '…' : '')
  }
</script>

<div class="changes">
  <button onclick={() => (open = !open)} aria-expanded={open}>Since {version} ▾</button>
  {#if open}
    <div class="panel menu">
      {#if nothing}
        <p class="muted">Nothing on the map has changed since {version}.</p>
      {:else}
        <p class="summary">
          {counts.added} new, {counts.removed} removed and {counts.changed} changed systems
          (and {counts.reworded} with only descriptions rewritten);
          {counts.addedLinks} links added and {counts.removedLinks} removed.
        </p>
        <button onclick={() => { onShow(); open = false }}>Colour the map by changes</button>
        {#each groups as group (group.status)}
          {#if group.list.length}
            <h3>{group.title} <span class="muted">({group.list.length})</span></h3>
            <ul>
              {#each group.list as c (c.name)}
                <li>
                  {#if group.status === 'removed'}
                    <span class="removed">{c.name}</span>
                  {:else}
                    <button class="link" onclick={() => onSelectSystem(c.name)}>{c.name}</button>
                    {#if c.changes.length}<span class="muted">· {gist(c)}</span>{/if}
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .changes {
    position: relative;
  }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    width: min(360px, calc(100vw - 24px));
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    z-index: 10;
  }

  .menu > button {
    align-self: flex-start;
  }

  p {
    margin: 0;
  }

  h3 {
    margin: 6px 0 0;
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-medium);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    padding: 1px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-bright);
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .removed {
    color: var(--text-medium);
    text-decoration: line-through;
  }

  .muted {
    color: var(--text-medium);
  }
</style>
