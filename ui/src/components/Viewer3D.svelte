<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { VehicleScene } from '../lib/three/scene';
  import { app, componentName, sceneVehicle } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  let host: HTMLDivElement;
  let scene: VehicleScene | null = null;
  let picked = $state<string | null>(null);
  let xray = $state(false);
  let webgl = $state(true);

  onMount(() => {
    try {
      scene = new VehicleScene(host);
    } catch {
      webgl = false;
      return;
    }
    scene.setNameResolver(componentName);
    scene.onPick = (id) => (picked = id);
    scene.setVehicle(sceneVehicle());
  });
  onDestroy(() => scene?.dispose());

  // Rebuild when the vehicle changes.
  $effect(() => {
    const v = sceneVehicle();
    void app.kb;
    scene?.setVehicle(v);
  });
  $effect(() => {
    const ids = [...app.highlight];
    const sev = app.highlightSeverity;
    scene?.highlight(ids, sev);
    picked = null;
  });
</script>

<div class="viewer">
  <div class="host" bind:this={host}></div>
  {#if !webgl}
    <div class="nogl muted small">La 3D n'est pas disponible sur cet appareil (WebGL désactivé).</div>
  {/if}
  <div class="tools">
    <button class="btn sm" class:active={xray} title="Voir à travers la carrosserie" onclick={() => { xray = !xray; scene?.setXray(xray); }}>
      <Icon name="layers" size={16} /> Transparence
    </button>
    <button class="btn sm" title="Vue d'ensemble" onclick={() => { app.highlight = []; }}>
      <Icon name="cube" size={16} /> Vue globale
    </button>
  </div>
  {#if app.highlight.length}
    <div class="legend small">
      <span class="dot" style="--c: var(--{app.highlightSeverity === 'info' ? 'accent' : app.highlightSeverity})"></span>
      {app.highlight.length} élément{app.highlight.length > 1 ? 's' : ''} mis en évidence
    </div>
  {:else}
    <div class="legend small faint">Glissez pour tourner · pincez pour zoomer · touchez une pièce</div>
  {/if}
  {#if picked}
    <div class="picked card fade-in">
      <div class="row spread">
        <strong>{componentName(picked)}</strong>
        <button class="btn ghost sm" aria-label="Fermer" onclick={() => (picked = null)}><Icon name="x" size={14} /></button>
      </div>
      <button class="btn sm" onclick={() => { app.highlightSeverity = 'info'; app.highlight = [picked!]; }}>Isoler cette pièce</button>
    </div>
  {/if}
</div>

<style>
  .viewer { position: relative; width: 100%; height: 100%; min-height: 280px; border-radius: var(--radius); overflow: hidden;
    background: radial-gradient(ellipse at 50% 30%, rgba(34, 211, 238, 0.08), transparent 65%), var(--bg-2); border: 1px solid var(--border); }
  .host { position: absolute; inset: 0; }
  .host :global(canvas) { display: block; touch-action: none; }
  .tools { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; }
  .tools .btn { backdrop-filter: blur(10px); background: color-mix(in srgb, var(--panel-solid) 70%, transparent); }
  .tools .btn.active { border-color: var(--accent); color: var(--accent); }
  .legend { position: absolute; left: 12px; bottom: 10px; display: flex; align-items: center; gap: 6px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); }
  .picked { position: absolute; left: 10px; top: 10px; max-width: 260px; padding: 0.7rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .nogl { position: absolute; inset: 0; display: grid; place-items: center; padding: 1rem; text-align: center; }
</style>
