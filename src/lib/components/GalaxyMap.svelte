<script>
  import { onMount } from 'svelte'
  import { createGalaxyScene } from '../three/createGalaxyScene.js'

  // `api` is bound by the parent to move the camera and mark the selection.
  let { galaxy, colors, options, changes, starIcons = false, paused = false, onSelect, onHover, onViewChange, api = $bindable() } = $props()

  /** @type {HTMLDivElement} */
  let container
  /** @type {ReturnType<typeof createGalaxyScene> | null} */
  let scene = $state(null)

  onMount(() => {
    scene = createGalaxyScene(container, galaxy, {
      onSelect: name => onSelect(name),
      onHover: name => onHover(name),
      onViewChange: center => onViewChange(center),
    })
    api = scene
    return () => scene?.dispose()
  })

  // Before the colours, which are per system of the galaxy given here.
  $effect(() => scene?.setGalaxy(galaxy))
  $effect(() => scene?.setColors(colors))
  $effect(() => scene?.setOptions({ ...options }))
  $effect(() => scene?.setChanges(changes))
  $effect(() => scene?.setStarIcons(starIcons))
  $effect(() => scene?.setPaused(paused))
</script>

<div class="map" bind:this={container}></div>

<style>
  .map {
    position: absolute;
    inset: 0;
    /* CSS2DRenderer gives each name a z-index; keep them below the UI. */
    isolation: isolate;
  }
</style>
