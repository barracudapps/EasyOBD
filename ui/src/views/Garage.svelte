<script lang="ts">
  import {
    addJournal, app, deleteJournal, deleteVehicle, exportGarage, fmt, go, importGarage, selectVehicle, toast, updateVehicle,
    type GarageVehicle, type JournalKind,
  } from '../lib/state.svelte';
  import Icon from '../components/Icon.svelte';

  let confirmDelete = $state<string | null>(null);
  let filter = $state<JournalKind | ''>('');
  let note = $state({ kind: 'repair' as JournalKind, title: '', details: '', mileage: '', cost: '' });
  let adding = $state(false);

  const current = $derived(app.garage.find((v) => v.id === app.vehicleId) ?? null);
  const entries = $derived(
    app.journal
      .filter((j) => j.vehicleId === app.vehicleId && (!filter || j.kind === filter))
      .sort((a, b) => b.date - a.date),
  );
  const spent = $derived(app.journal.filter((j) => j.vehicleId === app.vehicleId).reduce((s, j) => s + (j.cost ?? 0), 0));

  const kindLabel: Record<JournalKind, string> = { diagnostic: 'Diagnostic', maintenance: 'Entretien', repair: 'Réparation', inspection: 'Contrôle technique', note: 'Note' };
  const kindIcon: Record<JournalKind, string> = { diagnostic: 'scan', maintenance: 'wrench', repair: 'wrench', inspection: 'shield', note: 'book' };
  const typeIcon = (t: string) => (t === 'motorcycle' ? 'motorcycle' : t === 'truck' ? 'truck' : t === 'van' ? 'van' : 'car');
  const fuelLabel: Record<string, string> = { petrol: 'Essence', diesel: 'Diesel', hybrid: 'Hybride', electric: 'Électrique' };

  function lastEntry(v: GarageVehicle) {
    return app.journal.filter((j) => j.vehicleId === v.id).sort((a, b) => b.date - a.date)[0];
  }

  function newVehicle() {
    // Opens the picker in "add" mode: the next picked model creates a new garage vehicle.
    app.vehicleId = null;
    app.profile = null;
    app.pickerOpen = true;
  }

  function saveNote() {
    if (!note.title.trim()) {
      toast('Donnez un titre à l’intervention.', 'error');
      return;
    }
    const mileage = note.mileage ? Number(note.mileage) : undefined;
    addJournal({ kind: note.kind, title: note.title.trim(), details: note.details.trim() || undefined, mileage, cost: note.cost ? Number(note.cost) : undefined });
    if (current && mileage && mileage > (current.mileage ?? 0)) updateVehicle(current.id, { mileage });
    note = { kind: 'repair', title: '', details: '', mileage: '', cost: '' };
    adding = false;
  }

  function download() {
    const blob = new Blob([exportGarage()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `easyobd-garage-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const n = importGarage(await f.text());
      toast(`${n} véhicule(s) importé(s)`, 'ok');
    } catch (err) {
      toast(`Import impossible : ${(err as Error).message}`, 'error');
    }
  }
</script>

<div class="col">
  <div class="row spread">
    <div>
      <h1>Mon <span class="grad-text">garage</span></h1>
      <p class="muted">Tous vos véhicules et leur historique : diagnostics, entretiens, réparations, contrôles. Stocké uniquement sur cet appareil.</p>
    </div>
    <button class="btn primary" onclick={newVehicle}><Icon name="car" size={17} /> Ajouter un véhicule</button>
  </div>

  {#if !app.garage.length}
    <div class="card col empty">
      <Icon name="car" size={36} />
      <p>Votre garage est vide. Ajoutez votre premier véhicule : voiture, utilitaire, moto ou poids lourd.</p>
      <button class="btn primary" onclick={newVehicle}>Ajouter un véhicule</button>
    </div>
  {:else}
    <div class="vehicles">
      {#each app.garage as v (v.id)}
        {@const last = lastEntry(v)}
        <div class="card flat vcard" class:selected={v.id === app.vehicleId}>
          <button class="vmain" onclick={() => selectVehicle(v.id)}>
            <span class="vicon"><Icon name={typeIcon(v.profile.type)} size={22} /></span>
            <div class="grow">
              <strong>{v.name}</strong>
              <div class="tiny muted">{v.profile.make} {v.profile.model} · {v.profile.engine}</div>
              <div class="row tiny" style="gap:0.35rem;margin-top:0.25rem">
                <span class="pill tiny">{fuelLabel[v.profile.fuel] ?? v.profile.fuel}</span>
                {#if v.plate}<span class="pill tiny mono">{v.plate}</span>{/if}
                {#if v.mileage}<span class="pill tiny">{v.mileage.toLocaleString('fr-FR')} km</span>{/if}
              </div>
              {#if last}<div class="tiny faint" style="margin-top:0.25rem">Dernier : {last.title} · {new Date(last.date).toLocaleDateString('fr-FR')}</div>{/if}
            </div>
          </button>
          {#if v.id === app.vehicleId}<span class="pill tiny sev-low cur">Actif</span>{/if}
        </div>
      {/each}
    </div>

    {#if current}
      <div class="card col fade-in">
        <div class="row spread">
          <h2>{current.name}</h2>
          <div class="row">
            <button class="btn sm" onclick={() => (app.pickerOpen = true)}>Changer le modèle</button>
            {#if confirmDelete === current.id}
              <span class="small">Supprimer ce véhicule et son historique ?</span>
              <button class="btn danger sm" onclick={() => { deleteVehicle(current.id); confirmDelete = null; }}>Supprimer</button>
              <button class="btn ghost sm" onclick={() => (confirmDelete = null)}>Annuler</button>
            {:else}
              <button class="btn ghost sm" aria-label="Supprimer" onclick={() => (confirmDelete = current.id)}><Icon name="trash" size={15} /></button>
            {/if}
          </div>
        </div>
        <div class="grid-3">
          <label class="field">Surnom<input class="input" value={current.name} onchange={(e) => updateVehicle(current.id, { name: (e.target as HTMLInputElement).value })} /></label>
          <label class="field">Immatriculation<input class="input mono" value={current.plate ?? ''} placeholder="AB-123-CD" onchange={(e) => updateVehicle(current.id, { plate: (e.target as HTMLInputElement).value.toUpperCase() })} /></label>
          <label class="field">Kilométrage<input class="input" type="number" min="0" value={current.mileage ?? ''} onchange={(e) => updateVehicle(current.id, { mileage: Number((e.target as HTMLInputElement).value) || undefined })} /></label>
          <label class="field">VIN<input class="input mono" value={current.vin ?? ''} placeholder="Lu automatiquement via OBD" onchange={(e) => updateVehicle(current.id, { vin: (e.target as HTMLInputElement).value.toUpperCase() })} /></label>
        </div>
        <label class="field">Notes<textarea class="input" rows="2" value={current.notes ?? ''} placeholder="Particularités, pièces montées, références…" onchange={(e) => updateVehicle(current.id, { notes: (e.target as HTMLTextAreaElement).value })}></textarea></label>
        <div class="row">
          <button class="btn sm" onclick={() => go('diagnostic')}><Icon name="scan" size={15} /> Diagnostic</button>
          <button class="btn sm" onclick={() => go('maintenance')}><Icon name="wrench" size={15} /> Entretien</button>
          <button class="btn sm" onclick={() => go('inspection')}><Icon name="shield" size={15} /> Contrôle technique</button>
        </div>
      </div>

      <div class="card col">
        <div class="row spread">
          <h2>Carnet du véhicule</h2>
          <div class="row">
            {#if spent}<span class="pill">Dépensé : {fmt.eur(spent)}</span>{/if}
            <select class="input" style="width:auto" bind:value={filter}>
              <option value="">Tout</option>
              {#each Object.entries(kindLabel) as [k, l]}<option value={k}>{l}</option>{/each}
            </select>
            <button class="btn sm primary" onclick={() => (adding = !adding)}><Icon name="book" size={15} /> Ajouter</button>
          </div>
        </div>
        {#if adding}
          <div class="card flat col fade-in">
            <div class="grid-3">
              <label class="field">Type<select class="input" bind:value={note.kind}>{#each Object.entries(kindLabel) as [k, l]}<option value={k}>{l}</option>{/each}</select></label>
              <label class="field">Kilométrage<input class="input" type="number" bind:value={note.mileage} placeholder={String(current.mileage ?? '')} /></label>
              <label class="field">Coût (€)<input class="input" type="number" bind:value={note.cost} /></label>
            </div>
            <label class="field">Titre<input class="input" bind:value={note.title} placeholder="Ex. Remplacement du cylindre récepteur d'embrayage" /></label>
            <label class="field">Détails<textarea class="input" rows="2" bind:value={note.details} placeholder="Pièces, références, couple, remarques…"></textarea></label>
            <div class="row"><button class="btn primary sm" onclick={saveNote}>Enregistrer</button><button class="btn ghost sm" onclick={() => (adding = false)}>Annuler</button></div>
          </div>
        {/if}
        <ol class="timeline list-reset">
          {#each entries as j (j.id)}
            <li class="entry k-{j.kind}">
              <span class="dot"><Icon name={kindIcon[j.kind]} size={14} /></span>
              <div class="grow">
                <div class="row spread">
                  <strong class="small">{j.title}</strong>
                  <button class="btn ghost sm" aria-label="Supprimer l'entrée" onclick={() => deleteJournal(j.id)}><Icon name="x" size={13} /></button>
                </div>
                <div class="tiny faint">{new Date(j.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })} · {kindLabel[j.kind]}{j.mileage ? ` · ${j.mileage.toLocaleString('fr-FR')} km` : ''}{j.cost ? ` · ${fmt.eur(j.cost)}` : ''}</div>
                {#if j.codes?.length}<div class="row" style="gap:0.3rem;margin-top:0.25rem">{#each j.codes as c}<span class="pill tiny mono">{c}</span>{/each}</div>{/if}
                {#if j.details}<p class="tiny muted" style="margin-top:0.25rem">{j.details}</p>{/if}
              </div>
            </li>
          {:else}
            <p class="small muted">Aucune entrée. Les lectures OBD, entretiens terminés et pré-contrôles s'ajoutent automatiquement ; vous pouvez aussi noter vos réparations.</p>
          {/each}
        </ol>
      </div>
    {/if}

    <div class="row">
      <button class="btn sm" onclick={download}><Icon name="upload" size={15} /> Exporter (sauvegarde)</button>
      <label class="btn sm"><Icon name="refresh" size={15} /> Importer<input type="file" accept="application/json,.json" hidden onchange={upload} /></label>
      <span class="tiny faint">La sauvegarde contient véhicules et carnets (pas les photos).</span>
    </div>
  {/if}
</div>

<style>
  .empty { align-items: center; text-align: center; padding: 2rem; color: var(--muted); }
  .vehicles { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.6rem; }
  .vcard { position: relative; padding: 0; }
  .vmain { display: flex; gap: 0.75rem; align-items: flex-start; width: 100%; text-align: left; padding: 0.85rem 1rem; background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
  .vicon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--panel-2); color: var(--accent); flex-shrink: 0; }
  .cur { position: absolute; top: 0.6rem; right: 0.6rem; }
  .timeline { display: flex; flex-direction: column; gap: 0.2rem; border-left: 2px solid var(--border); margin-left: 0.6rem; padding-left: 0.9rem; }
  .entry { display: flex; gap: 0.6rem; position: relative; padding: 0.45rem 0; }
  .dot { position: absolute; left: -1.6rem; top: 0.5rem; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--panel-solid); border: 1px solid var(--border-2); color: var(--c, var(--accent)); }
  .k-diagnostic { --c: #22d3ee; } .k-maintenance { --c: #22c55e; } .k-repair { --c: #f59e0b; } .k-inspection { --c: #a78bfa; } .k-note { --c: #94a3b8; }
  label.btn { cursor: pointer; }
</style>
