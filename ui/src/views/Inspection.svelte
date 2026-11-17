<script lang="ts">
  import { call, errorText } from '../lib/api';
  import { app, addJournal, go, save, senseLabel, toast, vkey } from '../lib/state.svelte';
  import type { CheckItem, ConnectResult, InspectionGuide, Precheck } from '../lib/types';
  import Icon from '../components/Icon.svelte';

  let guide = $state<InspectionGuide | null>(null);
  let done = $state<Record<string, boolean>>({});
  let myVin = $state('');
  let pre = $state<Precheck | null>(null);
  let checking = $state(false);

  const senseIcon: Record<string, string> = { sight: 'eye', sound: 'ear', smell: 'nose', touch: 'hand', feel: 'steering' };
  const key = $derived(app.profile ? `easyobd.ct.${vkey()}` : '');

  $effect(() => {
    const p = app.profile;
    if (!p) return;
    call<InspectionGuide>('inspection_guide', { profile: p })
      .then((g) => (guide = g))
      .catch((e) => toast(errorText(e), 'error'));
    try {
      done = JSON.parse(localStorage.getItem(`easyobd.ct.${vkey()}`) ?? '{}');
      myVin = localStorage.getItem(`easyobd.vin.${vkey()}`) ?? '';
    } catch {
      done = {};
    }
  });

  const all = $derived(guide?.sections.flatMap((s) => s.items) ?? []);
  const progress = $derived(all.length ? Math.round((all.filter((i) => done[i.id]).length / all.length) * 100) : 0);

  function toggle(i: CheckItem) {
    done = { ...done, [i.id]: !done[i.id] };
    save(key, done);
  }
  function show(i: CheckItem) {
    if (i.components.length) {
      app.highlightSeverity = i.severity === 'critical' ? 'critical' : i.severity === 'major' ? 'high' : 'medium';
      app.highlight = i.components;
    }
  }
  async function precheck() {
    checking = true;
    try {
      pre = await call<Precheck>('inspection_precheck');
      addJournal({ kind: 'inspection', title: pre.ready ? 'Pré-contrôle OBD : prêt' : 'Pré-contrôle OBD : à corriger', details: pre.advice.join(' '), codes: pre.dtcs.map((d) => d.code) });
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      checking = false;
    }
  }
  async function simulate() {
    app.connection = await call<ConnectResult>('connect', { spec: { kind: 'simulator', address: '' } });
    await precheck();
  }
  const sevClass: Record<string, string> = { minor: 'sev-low', major: 'sev-high', critical: 'sev-critical' };
</script>

<div class="col">
  <h1>Contrôle <span class="grad-text">technique</span></h1>

  {#if !app.profile}
    <div class="card col">
      <p>Choisissez votre véhicule pour une liste de préparation adaptée (motorisation, type) et l'emplacement de son numéro VIN.</p>
      <button class="btn primary" onclick={() => (app.pickerOpen = true)}><Icon name="car" /> Choisir mon véhicule</button>
    </div>
  {:else if guide}
    <p class="muted">{guide.vehicle}. {guide.periodicity}</p>

    <div class="card flat row">
      <Icon name="check" size={20} />
      <div class="grow"><strong>{progress} %</strong> <span class="small muted">des points vérifiés</span></div>
      <div class="bar grow"><span style="width:{progress}%"></span></div>
      <button class="btn ghost sm" onclick={() => { done = {}; save(key, done); }}>Réinitialiser</button>
    </div>

    <div class="card col">
      <div class="row spread"><h2>Pré-contrôle OBD</h2>
        {#if app.connection}
          <button class="btn primary sm" onclick={precheck} disabled={checking}>{#if checking}<span class="spinner"></span>{/if} Lancer</button>
        {:else}
          <div class="row"><button class="btn sm" onclick={() => go('diagnostic')}>Connecter un adaptateur</button><button class="btn ghost sm" onclick={simulate}>Simulateur</button></div>
        {/if}
      </div>
      <p class="small muted">Vérifie le voyant moteur, les codes défaut et l'état des autodiagnostics du calculateur, ce que le contrôleur peut lire.</p>
      {#if pre}
        <div class="callout {pre.ready ? 'ok' : 'warn'} fade-in">
          <strong>{pre.ready ? 'Prêt pour le contrôle' : 'À corriger avant le contrôle'}</strong>
          <ul>{#each pre.advice as a}<li>{a}</li>{/each}</ul>
        </div>
        {#if pre.readiness.length}
          <div class="monitors">
            {#each pre.readiness as m}
              <span class="pill {m.complete ? 'sev-low' : 'sev-medium'}"><Icon name={m.complete ? 'check' : 'clock'} size={12} /> {m.name}</span>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <div class="card col">
      <h2>Où trouver le numéro VIN ?</h2>
      <p class="small muted">Le contrôleur compare le VIN de la carte grise (rubrique E) à la plaque constructeur et au numéro frappé dans la caisse.</p>
      {#if guide.vin.make_places.length}
        <div class="tiny faint upper">Habituel chez {app.profile.make}, à confirmer sur votre modèle</div>
        <ol class="vin">{#each guide.vin.make_places as v}<li>{v}</li>{/each}</ol>
      {/if}
      <div class="tiny faint upper">Emplacements courants</div>
      <ul class="list-reset col">
        {#each guide.vin.generic as g}<li class="small"><strong>{g.place}</strong> · <span class="muted">{g.detail}</span></li>{/each}
      </ul>
      <label class="field">Mon emplacement (mémorisé sur cet appareil)
        <input class="input" bind:value={myVin} placeholder="Ex. sous la moquette, à droite du siège passager" onchange={() => { try { localStorage.setItem(`easyobd.vin.${vkey()}`, myVin); } catch {} }} />
      </label>
    </div>

    {#each guide.sections as sec}
      <div class="col">
        <h2 class="sech">{sec.title}</h2>
        {#each sec.items as i}
          <div class="ck card flat" class:ok={done[i.id]}>
            <button class="box" aria-label="Vérifié" onclick={() => toggle(i)}>{#if done[i.id]}<Icon name="check" size={14} />{/if}</button>
            <button class="body" onclick={() => show(i)}>
              <div class="row"><strong class="small">{i.label}</strong><span class="pill tiny {sevClass[i.severity]}">{guide.severity_labels[i.severity]?.split(' (')[0]}</span></div>
              {#if i.how}<div class="tiny muted row" style="gap:0.35rem;flex-wrap:nowrap"><Icon name={senseIcon[i.sense] ?? 'eye'} size={13} /><span title={senseLabel[i.sense]}>{i.how}</span></div>{/if}
            </button>
          </div>
        {/each}
      </div>
    {/each}
    <p class="tiny faint">{guide.disclaimer}</p>
  {/if}
</div>

<style>
  .upper { text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; }
  .vin { margin: 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.3rem; }
  .monitors { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .sech { font-size: 1rem; margin-top: 0.4rem; }
  .ck { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.65rem 0.8rem; }
  .ck.ok { opacity: 0.6; }
  .box { width: 24px; height: 24px; flex-shrink: 0; border-radius: 7px; border: 1px solid var(--border-2); background: var(--panel-2); display: grid; place-items: center; color: var(--ok); cursor: pointer; }
  .body { background: none; border: none; padding: 0; text-align: left; cursor: pointer; display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
</style>
