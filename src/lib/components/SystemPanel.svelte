<script>
  import { css, governmentColor, starClass, valueColor, visibilityOf } from '../utils/colors.js'

  let { galaxy, system, planets, change = null, compareVersion = null, onSelectSystem, onClose } = $props()

  const governmentName = (/** @type {string | null} */ name) =>
    (name && galaxy.governments[name]?.displayName) ?? name ?? 'None'

  /** Every named object in the system, nested moons included. @param {any[]} objects @returns {any[]} */
  const named = objects => objects.flatMap(o => [...(o.name ? [o] : []), ...named(o.children)])

  let stellarObjects = $derived(named(system.objects).map(o => ({ object: o, planet: planets.get(o.name) })))
  let unnamedCount = $derived(countAll(system.objects) - stellarObjects.length - system.stars.length)
  let links = $derived(
    galaxy.links
      .filter((/** @type {string[]} */ l) => l.includes(system.name))
      .map((/** @type {string[]} */ l) => (l[0] === system.name ? l[1] : l[0]))
      .sort(),
  )
  let wormholeLinks = $derived(
    galaxy.wormholes.flatMap((/** @type {any} */ w) =>
      w.links
        .filter((/** @type {string[]} */ l) => l[0] === system.name)
        .map((/** @type {string[]} */ l) => ({ wormhole: w, to: l[1] })),
    ),
  )
  let trade = $derived(
    galaxy.commodities
      .filter((/** @type {any} */ c) => system.trade[c.name] !== undefined)
      .map((/** @type {any} */ c) => {
        const price = system.trade[c.name]
        const value = (price - c.low) / (c.high - c.low)
        return { ...c, price, value }
      }),
  )
  let visibility = $derived(visibilityOf(system))
  /** The story events that changed this system or its planets, in the order applied. */
  let storyEvents = $derived(
    [...(galaxy.changedBy?.get(system.name) ?? [])]
      .map(name => ({ name, event: galaxy.events[name] }))
      .sort((a, b) => a.event.order - b.event.order),
  )
  /** The choice and option an event hangs on, for display. @param {any} event */
  const choiceText = event => event.choices.map((/** @type {any} */ c) => {
    const choice = galaxy.choices.find((/** @type {any} */ x) => x.key === c.choice)
    const option = choice?.options.find((/** @type {any} */ o) => o.id === c.option)
    return `${choice?.label ?? c.choice}: ${option?.label ?? c.option}`
  }).join('; ')

  /** @param {any[]} objects @returns {number} */
  function countAll(objects) {
    return objects.reduce((n, o) => n + 1 + countAll(o.children), 0)
  }

  /** Paragraphs without a display condition, else the first one. @param {any[]} paragraphs */
  function text(paragraphs) {
    const plain = paragraphs.filter(p => !p.conditional)
    return (plain.length ? plain : paragraphs.slice(0, 1)).map(p => p.text.replace(/^\t/, ''))
  }

  const services = (/** @type {any} */ p) => [
    (p.spaceport.length || p.port) && 'Spaceport',
    p.shipyards.length && 'Shipyard',
    p.outfitters.length && 'Outfitter',
  ].filter(Boolean)
</script>

<aside class="panel system-panel">
  <header>
    <span class="swatch" style:color={css(governmentColor(galaxy, system.government))}></span>
    <h2>{system.displayName ?? system.name}</h2>
    <button class="close" onclick={onClose} aria-label="Close">×</button>
  </header>

  <div class="scroll">
    <dl class="facts">
      <dt>Government</dt>
      <dd>{governmentName(system.government)}</dd>
      <dt>Position</dt>
      <dd>{system.pos[0].toFixed(0)}, {system.pos[1].toFixed(0)}</dd>
      {#if system.jumpRange}
        <dt>Jump range</dt>
        <dd>{system.jumpRange}</dd>
      {/if}
      {#if system.stars.length}
        <dt>{system.stars.length > 1 ? 'Stars' : 'Star'}</dt>
        <dd class="stars">
          {#each system.stars as star}
            {@const icon = galaxy.stars[star]?.icon}
            <span class="star" title={star}>
              {#if icon}<img src={icon.url} alt="" />{/if}
              {starClass(star)}
            </span>
          {/each}
        </dd>
      {/if}
    </dl>

    {#if visibility !== 'mapped' || system.attributes.length}
      <div class="chips">
        {#if system.hidden}<span class="chip hidden" title="Not shown on the in-game map">hidden</span>{/if}
        {#if system.shrouded}<span class="chip shrouded" title="Only seen in-game while within view range">shrouded</span>{/if}
        {#if system.inaccessible}<span class="chip inaccessible" title="Cannot be travelled to in-game">inaccessible</span>{/if}
        {#each system.attributes as attribute}<span class="chip">{attribute}</span>{/each}
      </div>
    {/if}

    {#if change}
      <section>
        <h3>Since {compareVersion}</h3>
        {#if change.status === 'added'}
          <p class="new">New in this version.</p>
        {:else}
          <dl class="changes">
            {#each change.changes as c}
              <dt>{c.what}</dt>
              <dd>
                {#if c.items}
                  {#each c.items as item}<div>{item}</div>{/each}
                {:else if c.added || c.removed}
                  {#each c.added as item}<div class="added">+ {item}</div>{/each}
                  {#each c.removed as item}<div class="removed">− {item}</div>{/each}
                {:else if c.before !== undefined}
                  <span class="muted">{c.before}</span> → {c.after}
                {/if}
              </dd>
            {/each}
          </dl>
        {/if}
      </section>
    {/if}

    <section>
      <h3>Planets and stations</h3>
      {#each stellarObjects as { object, planet } (object.name)}
        <details class="planet" open={stellarObjects.length <= 2}>
          <summary>
            <span class="planet-name">{planet?.displayName ?? object.name}</span>
            {#if planet}
              <span class="services">
                {#each services(planet) as service}<span class="service">{service}</span>{/each}
                {#if !planet.inhabited}<span class="service muted">Uninhabited</span>{/if}
              </span>
            {/if}
          </summary>
          {#if planet}
            <dl class="facts">
              {#if planet.government && planet.government !== system.government}
                <dt>Government</dt>
                <dd>{governmentName(planet.government)}</dd>
              {/if}
              {#if planet.shipyards.length}
                <dt>Shipyard</dt>
                <dd>{planet.shipyards.join(', ')}</dd>
              {/if}
              {#if planet.outfitters.length}
                <dt>Outfitter</dt>
                <dd>{planet.outfitters.join(', ')}</dd>
              {/if}
              {#if planet.port?.services.length}
                <dt>Port</dt>
                <dd>{planet.port.services.join(', ')}</dd>
              {/if}
              {#if planet.security !== null}
                <dt>Security</dt>
                <dd>{Math.round(planet.security * 100)}%</dd>
              {/if}
              {#if planet.requiredReputation}
                <dt>Reputation</dt>
                <dd>{planet.requiredReputation} required to land</dd>
              {/if}
              {#if planet.tribute}
                <dt>Tribute</dt>
                <dd>
                  {planet.tribute.value.toLocaleString()} credits/day{#if planet.tribute.fleet}, defended by {planet.tribute.fleet.count}× {planet.tribute.fleet.name}{/if}
                </dd>
              {/if}
              {#if planet.wormhole}
                <dt>Wormhole</dt>
                <dd>{planet.wormhole}</dd>
              {/if}
              {#if planet.attributes.length}
                <dt>Attributes</dt>
                <dd>{planet.attributes.join(', ')}</dd>
              {/if}
            </dl>
            {#each text(planet.description) as paragraph}<p>{paragraph}</p>{/each}
            {#if planet.spaceport.length || planet.port?.description.length}
              <h4>Spaceport</h4>
              {#each text(planet.spaceport.length ? planet.spaceport : planet.port.description) as paragraph}<p>{paragraph}</p>{/each}
            {/if}
          {:else}
            <p class="muted">No planet definition.</p>
          {/if}
        </details>
      {:else}
        <p class="muted">None you can land on.</p>
      {/each}
      {#if unnamedCount > 0}
        <p class="muted">Plus {unnamedCount} unnamed {unnamedCount === 1 ? 'body' : 'bodies'}.</p>
      {/if}
    </section>

    {#if trade.length}
      <section>
        <h3>Trade</h3>
        <table class="trade">
          <tbody>
            {#each trade as row (row.name)}
              <tr title="Galaxy range {row.low}–{row.high}">
                <td>{row.name}</td>
                <td class="price">{row.price}</td>
                <td class="bar">
                  <span style:width="{Math.max(4, row.value * 100)}%" style:background={css(valueColor(row.value * 2 - 1))}></span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    <section>
      <h3>Hyperspace links</h3>
      <div class="links">
        {#each links as name}
          <button onclick={() => onSelectSystem(name)}>{name}</button>
        {:else}
          <span class="muted">None</span>
        {/each}
      </div>
      {#if wormholeLinks.length}
        <h4>Wormholes</h4>
        <div class="links">
          {#each wormholeLinks as { wormhole, to }}
            <button
              onclick={() => onSelectSystem(to)}
              title={wormhole.displayName ?? wormhole.name}
              style:border-color={css(wormhole.color ?? [0.5, 0.2, 0.9])}>{to}</button
            >
          {/each}
        </div>
      {/if}
    </section>

    {#if storyEvents.length}
      <section>
        <h3>Story events</h3>
        <ul class="events">
          {#each storyEvents as { name, event } (name)}
            <li title={event.triggers.map((/** @type {any} */ t) => `${t.mission} (on ${t.phase})`).join('\n')}>
              {name}
              {#if event.date}<span class="muted">· {event.date}</span>{/if}
              {#if event.choices.length}<span class="muted">· {choiceText(event)}</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if system.fleets.length || system.minables.length || system.hazards.length}
      <section>
        <details>
          <summary><h3>Fleets, minables and hazards</h3></summary>
          <dl class="facts">
            {#if system.fleets.length}
              <dt>Fleets</dt>
              <dd>{system.fleets.map((/** @type {any} */ f) => f.name).join(', ')}</dd>
            {/if}
            {#if system.minables.length}
              <dt>Minables</dt>
              <dd>{system.minables.map((/** @type {any} */ m) => m.name).join(', ')}</dd>
            {/if}
            {#if system.hazards.length}
              <dt>Hazards</dt>
              <dd>{system.hazards.map((/** @type {any} */ h) => h.name).join(', ')}</dd>
            {/if}
          </dl>
        </details>
      </section>
    {/if}
  </div>
</aside>

<style>
  .changes {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 10px;
    margin: 0;
  }

  .changes dt {
    color: var(--text-medium);
  }

  .changes dd {
    margin: 0;
  }

  .new,
  .added {
    color: rgb(90 230 100);
  }

  .removed {
    color: rgb(255 110 100);
  }

  .events {
    margin: 0;
    padding-left: 18px;
  }

  .events li {
    margin: 2px 0;
  }

  .system-panel {
    position: absolute;
    top: 56px;
    right: 12px;
    bottom: 12px;
    width: min(380px, calc(100vw - 24px));
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--panel-border);
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 18px;
    font-weight: 500;
    color: var(--text-bright);
  }

  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 3px solid currentColor;
    flex: none;
  }

  .close {
    border: none;
    background: none;
    font-size: 20px;
    line-height: 1;
    padding: 0 4px;
  }

  .scroll {
    overflow-y: auto;
    padding: 4px 12px 12px;
  }

  section {
    margin-top: 14px;
  }

  h3 {
    display: inline;
    margin: 0;
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-medium);
  }

  section > h3 {
    display: block;
    margin-bottom: 6px;
  }

  h4 {
    margin: 8px 0 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-medium);
  }

  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 12px;
    margin: 8px 0;
  }

  dt {
    color: var(--text-medium);
  }

  dd {
    margin: 0;
  }

  .stars {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
  }

  .star {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .star img {
    width: 20px;
    height: 20px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    font-size: 12px;
    padding: 0 7px;
    border-radius: 9px;
    border: 1px solid var(--panel-border);
    color: var(--text-medium);
  }

  .chip.hidden {
    color: var(--hidden);
    border-color: currentColor;
  }

  .chip.shrouded {
    color: var(--shrouded);
    border-color: currentColor;
  }

  .chip.inaccessible {
    color: var(--inaccessible);
    border-color: currentColor;
  }

  .planet {
    border-top: 1px solid #262626;
    padding: 6px 0;
  }

  summary {
    cursor: pointer;
  }

  .planet-name {
    color: var(--text-bright);
  }

  .services {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-left: 6px;
    vertical-align: 1px;
  }

  .service {
    font-size: 11px;
    padding: 0 5px;
    border-radius: 3px;
    background: #2a2a2a;
    color: var(--accent);
  }

  .service.muted {
    color: var(--text-medium);
  }

  p {
    margin: 6px 0;
    color: #a6a6a6;
  }

  .muted {
    color: var(--text-medium);
  }

  .trade {
    width: 100%;
    border-collapse: collapse;
  }

  .trade td {
    padding: 1px 0;
  }

  .price {
    text-align: right;
    padding-right: 10px !important;
    font-variant-numeric: tabular-nums;
  }

  .bar {
    width: 40%;
  }

  .bar span {
    display: block;
    height: 6px;
    border-radius: 3px;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .links button {
    padding: 1px 8px;
  }
</style>
