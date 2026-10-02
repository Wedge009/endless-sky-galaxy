<script>
  // Whether to apply the story's mission events, and the outcome of each
  // story choice. Events with no choice are assumed to have happened, as if
  // the player had played every storyline through.
  let { galaxy, enabled = $bindable(), choices = $bindable(), appliedCount } = $props()

  let open = $state(false)

  const chosen = (/** @type {any} */ c) => choices[c.key] ?? c.default
  /** Whether a choice arises at all, given the choices it's nested under. */
  const arises = (/** @type {any} */ c) => c.under.every((/** @type {any} */ u) =>
    chosen(galaxy.choices.find((/** @type {any} */ p) => p.key === u.choice)) === u.option)

  /** @param {string} key @param {string} option */
  function pick(key, option) {
    choices = { ...choices, [key]: option }
  }

  let changed = $derived(galaxy.choices.some((/** @type {any} */ c) => chosen(c) !== c.default))
</script>

<div class="story">
  <button onclick={() => (open = !open)} aria-expanded={open}>Story ▾</button>
  {#if open}
    <div class="panel menu">
      <label class="toggle">
        <input type="checkbox" bind:checked={enabled} />
        Apply story events
        {#if enabled}<span class="muted">({appliedCount})</span>{/if}
      </label>
      <p class="muted note">
        {#if enabled}
          As if every storyline were played through. Where the story branches, pick the outcome:
        {:else}
          Showing the galaxy as a new game starts, before any story event.
        {/if}
      </p>
      {#if enabled}
        {#each galaxy.choices as c (c.key)}
          <fieldset class:indent={c.under.length} disabled={!arises(c)}>
            <legend title={c.key}>{c.label ?? c.key}</legend>
            {#each c.options as o (o.id)}
              <label title="{o.events.length} event{o.events.length === 1 ? '' : 's'}{o.events.length ? ': ' + o.events.join(', ') : ''}">
                <input type="radio" name={c.key} checked={chosen(c) === o.id} onchange={() => pick(c.key, o.id)} />
                {o.label ?? o.id}
              </label>
            {/each}
          </fieldset>
        {/each}
        <button class="reset" onclick={() => (choices = {})} disabled={!changed}>Default outcomes</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .story {
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
    width: max-content;
    max-width: min(360px, calc(100vw - 24px));
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    z-index: 10;
  }

  label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .note {
    margin: 0 0 2px;
    font-size: 12px;
  }

  fieldset {
    margin: 0;
    padding: 4px 0 2px;
    border: none;
    border-top: 1px solid var(--panel-border);
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
  }

  fieldset:disabled {
    opacity: 0.45;
  }

  fieldset.indent {
    padding-left: 16px;
  }

  legend {
    padding: 4px 0 0;
    float: left;
    width: 100%;
    color: var(--text-bright);
  }

  .muted {
    color: var(--text-medium);
  }

  .reset {
    margin-top: 4px;
    align-self: flex-start;
  }
</style>
