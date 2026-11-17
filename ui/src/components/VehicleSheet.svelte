<script lang="ts">
  import { call, errorText } from '../lib/api';
  import { app, sourceLabel, toast } from '../lib/state.svelte';
  import type { VehicleSheet } from '../lib/types';
  import Alternatives from './Alternatives.svelte';

  let sheet = $state<VehicleSheet | null>(null);

  $effect(() => {
    const p = app.profile;
    if (!p) return;
    call<VehicleSheet>('vehicle_sheet', { profile: p })
      .then((s) => (sheet = s))
      .catch((e) => toast(errorText(e), 'error'));
  });
</script>

{#if sheet}
  <div class="col fade-in">
    <div class="legend row tiny">
      <span class="src s-vehicle">Modèle</span> valeur de votre véhicule
      <span class="src s-make">Marque</span> habituelle pour la marque
      <span class="src s-typical">Typique</span> à vérifier dans le carnet
    </div>
    {#each sheet.sections as sec}
      <div class="card flat col sec">
        <h3>{sec.title}</h3>
        <dl>
          {#each sec.items as it}
            <div class="line">
              <dt class="muted small">{it.label}</dt>
              <dd>
                <div class="row" style="gap:0.45rem;align-items:flex-start;flex-wrap:nowrap">
                  <span class="grow">{it.value}</span>
                  <span class="src s-{it.source}" title={sourceLabel[it.source]}>{sourceLabel[it.source]}</span>
                </div>
                {#if it.note}<div class="tiny faint">{it.note}</div>{/if}
              </dd>
            </div>
          {/each}
        </dl>
      </div>
    {/each}
    {#if sheet.oil_alternatives.length}
      <div class="card flat"><Alternatives items={sheet.oil_alternatives} title="Huile moteur : alternatives" /></div>
    {/if}
    <p class="tiny faint">{sheet.disclaimer}</p>
  </div>
{/if}

<style>
  .sec { padding: 0.9rem 1rem; gap: 0.5rem; }
  dl { margin: 0; display: flex; flex-direction: column; }
  .line { display: grid; grid-template-columns: minmax(130px, 38%) 1fr; gap: 0.75rem; padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
  .line:last-child { border-bottom: none; }
  dd { margin: 0; }
  .src { font-size: 0.66rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.1rem 0.4rem; border-radius: 6px; white-space: nowrap; }
  .s-vehicle { background: rgba(34, 197, 94, 0.15); color: var(--ok); }
  .s-make { background: rgba(34, 211, 238, 0.14); color: var(--accent); }
  .s-typical { background: rgba(245, 158, 11, 0.14); color: var(--medium); }
  .legend { gap: 0.4rem; color: var(--muted); }
  @media (max-width: 520px) { .line { grid-template-columns: 1fr; gap: 0.2rem; } }
</style>
