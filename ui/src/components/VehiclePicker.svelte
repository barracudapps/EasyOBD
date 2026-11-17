<script lang="ts">
  import { app, setProfile, toast } from '../lib/state.svelte';
  import type { VehicleProfile } from '../lib/types';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let type = $state(app.profile?.type ?? 'car');
  let query = $state('');
  let custom = $state<VehicleProfile>(
    app.profile?.id === 'custom'
      ? { ...app.profile }
      : { id: 'custom', type: 'car', make: '', model: '', engine: '', fuel: 'petrol', cylinders: 4, oil_capacity_l: null, oil_spec: '' },
  );
  let showCustom = $state(app.profile?.id === 'custom');
  let make = $state('');
  let fuel = $state('');

  const makes = $derived([...new Set(app.profiles.filter((p) => p.type === type).map((p) => p.make))].sort((a, b) => a.localeCompare(b, 'fr')));
  const list = $derived(
    app.profiles.filter(
      (p) =>
        p.type === type &&
        (!make || p.make === make) &&
        (!fuel || p.fuel === fuel) &&
        `${p.make} ${p.model} ${p.engine}`.toLowerCase().includes(query.toLowerCase()),
    ),
  );
  const fuelLabel: Record<string, string> = { petrol: 'Essence', diesel: 'Diesel', hybrid: 'Hybride', electric: 'Électrique' };

  function pick(p: VehicleProfile) {
    setProfile(p);
    toast(`Véhicule : ${p.make} ${p.model}`, 'ok');
    onclose();
  }

  function saveCustom() {
    if (!custom.make || !custom.model) {
      toast('Indiquez au moins la marque et le modèle.', 'error');
      return;
    }
    pick({ ...custom, type });
  }

  const fuels = [
    ['petrol', 'Essence'],
    ['diesel', 'Diesel'],
    ['hybrid', 'Hybride'],
    ['electric', 'Électrique'],
  ];
</script>

<div class="overlay" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal card fade-in" role="dialog" aria-modal="true" aria-label="Choisir le véhicule">
    <div class="row spread">
      <h2>Mon véhicule</h2>
      <button class="btn ghost sm" aria-label="Fermer" onclick={onclose}><Icon name="x" /></button>
    </div>
    <p class="muted small">
      Le véhicule adapte la 3D, les quantités de la liste de courses et les recherches de pièces. Tout est stocké sur votre appareil.
    </p>

    <div class="types">
      {#each app.vehicleTypes as t}
        <button class="card flat hover type" class:selected={type === t.id} onclick={() => { type = t.id; make = ''; }}>
          <Icon name={t.icon} size={26} /><span>{t.name}</span>
        </button>
      {/each}
    </div>

    <div class="tabs">
      <button class:active={!showCustom} onclick={() => (showCustom = false)}>Modèles connus</button>
      <button class:active={showCustom} onclick={() => (showCustom = true)}>Saisie manuelle</button>
    </div>

    {#if !showCustom}
      <div class="filters">
        <input class="input" placeholder="Rechercher (modèle, moteur)…" bind:value={query} />
        <select class="input" bind:value={make}>
          <option value="">Toutes les marques ({makes.length})</option>
          {#each makes as mk}<option>{mk}</option>{/each}
        </select>
        <select class="input" bind:value={fuel}>
          <option value="">Toutes énergies</option>
          {#each Object.entries(fuelLabel) as [v, l]}<option value={v}>{l}</option>{/each}
        </select>
      </div>
      <div class="tiny faint">{list.length} modèle{list.length > 1 ? 's' : ''}</div>
      <div class="plist">
        {#each list as p}
          <button class="card flat hover prow" class:selected={app.profile?.id === p.id} onclick={() => pick(p)}>
            <div class="grow">
              <strong>{p.make} {p.model}</strong>
              <div class="small muted">{p.engine}{p.years ? ` · ${p.years[0]}–${p.years[1]}` : ''}</div>
              <span class="pill tiny f-{p.fuel}">{fuelLabel[p.fuel] ?? p.fuel}</span>
            </div>
            <div class="small faint right">
              {#if p.fuel !== 'electric'}{p.oil_capacity_l ? `${p.oil_capacity_l} L` : ''}<br />{p.oil_spec ?? ''}{/if}
            </div>
          </button>
        {:else}
          <p class="muted small">Aucun modèle pré-renseigné : utilisez la saisie manuelle.</p>
        {/each}
      </div>
    {:else}
      <div class="grid-2">
        <label class="field">Marque<input class="input" bind:value={custom.make} placeholder="Renault" /></label>
        <label class="field">Modèle<input class="input" bind:value={custom.model} placeholder="Mégane IV" /></label>
        <label class="field">Motorisation<input class="input" bind:value={custom.engine} placeholder="1.3 TCe 140" /></label>
        <label class="field">Carburant
          <select class="input" bind:value={custom.fuel}>
            {#each fuels as [v, l]}<option value={v}>{l}</option>{/each}
          </select>
        </label>
        <label class="field">Cylindres<input class="input" type="number" min="1" max="16" bind:value={custom.cylinders} /></label>
        <label class="field">Contenance huile (L)<input class="input" type="number" step="0.1" bind:value={custom.oil_capacity_l} /></label>
        <label class="field">Norme d'huile<input class="input" bind:value={custom.oil_spec} placeholder="5W30 C3" /></label>
      </div>
      <p class="tiny faint">Contenance et norme : carnet d'entretien ou notice du véhicule.</p>
      <button class="btn primary" onclick={saveCustom}><Icon name="check" /> Utiliser ce véhicule</button>
    {/if}
    {#if app.profile}
      <button class="btn ghost sm" onclick={() => { setProfile(null); onclose(); }}>Oublier le véhicule</button>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 60; background: rgba(2, 6, 15, 0.6); display: grid; place-items: center; padding: 1rem; }
  .modal { width: min(640px, 100%); max-height: 90vh; overflow: auto; display: flex; flex-direction: column; gap: 0.9rem; background: var(--panel-solid); }
  .types { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; }
  .type { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; padding: 0.7rem 0.3rem; font-size: 0.82rem; font-weight: 600; }
  .filters { display: grid; grid-template-columns: 1fr 180px 150px; gap: 0.5rem; }
  .f-electric { color: #22d3ee; } .f-hybrid { color: #22c55e; } .f-diesel { color: #f59e0b; }
  @media (max-width: 560px) { .filters { grid-template-columns: 1fr; } }
  .plist { display: flex; flex-direction: column; gap: 0.45rem; max-height: 40vh; overflow: auto; }
  .prow { display: flex; align-items: center; gap: 0.75rem; text-align: left; padding: 0.7rem 0.9rem; }
  .right { text-align: right; }
  button.card { color: inherit; font: inherit; }
</style>
