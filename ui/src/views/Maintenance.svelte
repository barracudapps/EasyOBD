<script lang="ts">
  import { call, errorText, openUrl } from '../lib/api';
  import { addJournal, app, currentVehicle, fmt, save, toast, vkey } from '../lib/state.svelte';
  import type { ShoppingList, Tutorial, TutorialSummary } from '../lib/types';
  import Icon from '../components/Icon.svelte';
  import SenseChecks from '../components/SenseChecks.svelte';
  import Alternatives from '../components/Alternatives.svelte';
  import VehicleSheet from '../components/VehicleSheet.svelte';
  import VideoPanel from '../components/VideoPanel.svelte';
  import Photos from '../components/Photos.svelte';
  import type { Alternative } from '../lib/types';

  let list = $state<TutorialSummary[]>([]);
  let tut = $state<Tutorial | null>(null);
  let shopping = $state<ShoppingList | null>(null);
  let tab = $state<'why' | 'shop' | 'steps' | 'video'>('steps');
  let step = $state(0);
  let bought = $state<Record<string, boolean>>({});
  let alternatives = $state<Alternative[][]>([]);
  let openAlt = $state<number | null>(null);
  let section = $state<'tutorials' | 'sheet'>('tutorials');

  $effect(() => {
    const p = app.profile;
    tut = null;
    app.highlight = [];
    if (!p) return;
    call<TutorialSummary[]>('tutorials_for', { profile: p })
      .then((l) => {
        list = l;
        const wanted = sessionStorage.getItem('easyobd.tutorial');
        sessionStorage.removeItem('easyobd.tutorial');
        if (wanted && l.some((t) => t.id === wanted)) open(wanted);
      })
      .catch((e) => toast(errorText(e), 'error'));
  });

  // Tutorial requested from elsewhere (3D part card) while this view is already open.
  $effect(() => {
    const want = app.request?.tutorial;
    if (want && list.some((t) => t.id === want)) {
      app.request = null;
      section = 'tutorials';
      open(want);
    }
  });

  async function open(id: string) {
    try {
      const r = await call<{ tutorial: Tutorial; shopping: ShoppingList; alternatives: Alternative[][] }>('tutorial', { id, profile: app.profile });
      tut = r.tutorial;
      shopping = r.shopping;
      alternatives = r.alternatives ?? [];
      openAlt = null;
      step = 0;
      tab = 'steps';
      try {
        bought = JSON.parse(localStorage.getItem(`easyobd.bought.${vkey()}.${id}`) ?? '{}');
      } catch {
        bought = {};
      }
      showStep();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  function showStep() {
    if (!tut) return;
    app.highlightSeverity = 'info';
    app.highlight = tut.steps[step]?.components ?? tut.components;
  }

  function toggleBought(name: string) {
    bought = { ...bought, [name]: !bought[name] };
    if (tut) save(`easyobd.bought.${vkey()}.${tut.id}`, bought);
  }

  function copyList() {
    if (!shopping) return;
    const txt = [`Liste de courses – ${tut?.title} – ${shopping.vehicle}`, ...shopping.items.map((i) => `- ${i.qty} ${i.unit} ${i.name}${i.optional ? ' (optionnel)' : ''} : ${fmt.eur(i.price_min, i.price_max)}`), `Total : ${fmt.eur(shopping.total_min, shopping.total_max)}`].join('\n');
    navigator.clipboard?.writeText(txt).then(() => toast('Liste copiée', 'ok'));
  }
</script>

<div class="col">
  <h1>Entretien <span class="grad-text">guidé</span></h1>

  {#if !app.profile}
    <div class="card col">
      <p>Choisissez votre véhicule (voiture, utilitaire, moto ou poids lourd) pour obtenir les tutoriels qui le concernent et une liste de courses avec les bonnes quantités.</p>
      <button class="btn primary" onclick={() => (app.pickerOpen = true)}><Icon name="car" /> Choisir mon véhicule</button>
    </div>
  {:else if !tut}
    <div class="row spread">
      <p class="muted"><strong>{app.profile.make} {app.profile.model}</strong> · {app.profile.engine}</p>
      <button class="btn ghost sm" onclick={() => (app.pickerOpen = true)}>Changer</button>
    </div>
    <div class="tabs">
      <button class:active={section === 'tutorials'} onclick={() => (section = 'tutorials')}><Icon name="wrench" size={15} /> Tutoriels ({list.length})</button>
      <button class:active={section === 'sheet'} onclick={() => (section = 'sheet')}><Icon name="book" size={15} /> Fiche technique</button>
    </div>
    {#if section === 'sheet'}
      <VehicleSheet />
    {:else}
    <p class="tiny faint">{app.maintenanceDisclaimer}</p>
    <div class="grid-2">
      {#each list as t}
        <button class="card hover tcard" onclick={() => open(t.id)}>
          <h3>{t.title}</h3>
          <p class="small muted">{t.interval}</p>
          <div class="row small muted">
            <span class="dots">{#each [1, 2, 3, 4, 5] as k}<i class:on={k <= t.difficulty}></i>{/each}</span>
            <span class="row" style="gap:4px"><Icon name="clock" size={14} /> {fmt.time(t.time_min, t.time_max)}</span>
          </div>
        </button>
      {/each}
    </div>
    {/if}
  {:else}
    <div class="row">
      <button class="btn ghost sm" onclick={() => { tut = null; app.highlight = []; }}><Icon name="back" size={15} /> Tutoriels</button>
    </div>
    <div class="col">
      <h2>{tut.title}</h2>
      <div class="row small muted">
        <span class="dots">{#each [1, 2, 3, 4, 5] as k}<i class:on={k <= tut.difficulty}></i>{/each}</span>
        <span class="row" style="gap:4px"><Icon name="clock" size={14} /> {fmt.time(tut.time_min, tut.time_max)}</span>
        {#if shopping}<span class="row" style="gap:4px"><Icon name="euro" size={14} /> {fmt.eur(shopping.total_min, shopping.total_max)} de pièces</span>{/if}
        <span>{tut.interval}</span>
      </div>
    </div>

    {#each tut.vehicle_notes as n}<div class="callout info small row"><Icon name="info" size={16} /><span class="grow">{n}</span></div>{/each}
    <div class="tabs">
      <button class:active={tab === 'steps'} onclick={() => { tab = 'steps'; showStep(); }}><Icon name="wrench" size={15} /> Étapes</button>
      <button class:active={tab === 'shop'} onclick={() => (tab = 'shop')}><Icon name="cart" size={15} /> Liste de courses</button>
      <button class:active={tab === 'why'} onclick={() => { tab = 'why'; app.highlight = tut!.components; }}><Icon name="school" size={15} /> Pourquoi ?</button>
      <button class:active={tab === 'video'} onclick={() => (tab = 'video')}><Icon name="sim" size={15} /> Vidéos</button>
    </div>

    {#if tab === 'steps'}
      {@const s = tut.steps[step]}
      <div class="card col fade-in">
        <div class="stepper">
          {#each tut.steps as _, i}
            <button class="sdot" class:on={i === step} class:done={i < step} aria-label="Étape {i + 1}" onclick={() => { step = i; showStep(); }}>{i + 1}</button>
          {/each}
        </div>
        <div class="row tiny faint">ÉTAPE {step + 1} / {tut.steps.length}
          {#if s.source}<span class="pill tiny srcpill"><Icon name="book" size={12} /> {s.source}</span>{/if}</div>
        <h3>{s.title}</h3>
        <p>{s.text}</p>
        {#if s.warning}<div class="callout danger small row"><Icon name="alert" size={16} /> <span class="grow">{s.warning}</span></div>{/if}
        {#if s.tip}<div class="callout info small row"><Icon name="info" size={16} /> <span class="grow">{s.tip}</span></div>{/if}
        <Photos components={s.components} userKey={`step.${vkey()}.${tut.id}.${step}`} />
        <p class="tiny faint">Les pièces concernées sont mises en évidence dans la vue 3D. Ajoutez vos photos (sens de montage, repères) : elles restent sur cet appareil.</p>
        <div class="row spread">
          <button class="btn sm" disabled={step === 0} onclick={() => { step -= 1; showStep(); }}><Icon name="back" size={15} /> Précédente</button>
          {#if step < tut.steps.length - 1}
            <button class="btn primary sm" onclick={() => { step += 1; showStep(); }}>Suivante <Icon name="chevron" size={15} /></button>
          {:else}
            <button class="btn primary sm" onclick={() => { addJournal({ kind: 'maintenance', title: tut!.title, cost: shopping ? Math.round((shopping.total_min + shopping.total_max) / 2) : undefined }); toast(currentVehicle() ? 'Bravo ! Intervention ajoutée au carnet du véhicule (Mon garage).' : 'Bravo, entretien terminé !', 'ok'); }}><Icon name="check" size={15} /> Terminé</button>
          {/if}
        </div>
      </div>
      {#if tut.safety.length}
        <div class="callout warn small"><strong>Sécurité</strong><ul>{#each tut.safety as x}<li>{x}</li>{/each}</ul></div>
      {/if}
      {#if tut.tools.length}
        <div class="col"><h3>Outils</h3><div class="row">{#each tut.tools as t}<span class="pill">{t}</span>{/each}</div></div>
      {/if}
    {:else if tab === 'shop' && shopping}
      <div class="card col fade-in">
        <div class="row spread"><h3>Pour {shopping.vehicle}</h3><button class="btn sm" onclick={copyList}>Copier la liste</button></div>
        {#each shopping.items as i, idx}
          <div class="item" class:done={bought[i.name]}>
            <button class="check" aria-label="Acheté" onclick={() => toggleBought(i.name)}>{#if bought[i.name]}<Icon name="check" size={14} />{/if}</button>
            <div class="info">
              <div class="iname">{i.name} {#if i.optional}<span class="pill tiny">optionnel</span>{/if}</div>
              <div class="imeta small">
                <span class="qty">{i.qty} {i.unit}</span>
                <span class="price">{fmt.eur(i.price_min, i.price_max)}</span>
                {#if !i.qty_known}<span class="pill tiny sev-medium" title="Contenance non renseignée pour ce modèle : vérifiez le carnet d'entretien">quantité à vérifier</span>{/if}
              </div>
            </div>
            <div class="shops">
              {#each i.links as l}
                <button class="chip-shop" style="--shop:{l.color ?? 'var(--accent)'}" onclick={() => openUrl(l.url)}>{l.name}<Icon name="external" size={11} /></button>
              {/each}
              {#if alternatives[idx]?.length}
                <button class="chip-alt" class:on={openAlt === idx} onclick={() => (openAlt = openAlt === idx ? null : idx)}><Icon name="euro" size={12} /> Moins cher ?</button>
              {/if}
            </div>
            {#if openAlt === idx}<div class="altwrap"><Alternatives items={alternatives[idx]} /></div>{/if}
          </div>
        {/each}
        <div class="totals">
          <div><div class="tiny faint">PIÈCES (HORS OPTIONS)</div><div class="big">{fmt.eur(shopping.total_min, shopping.total_max)}</div></div>
          <div><div class="tiny faint">VOUS ÉCONOMISEZ (MAIN-D'ŒUVRE)</div><div class="big">{fmt.eur(shopping.labor_min, shopping.labor_max)}</div></div>
        </div>
        <p class="tiny faint">Les recherches incluent la marque et le modèle. Vérifiez toujours la compatibilité avec votre immatriculation sur le site.</p>
      </div>
    {:else if tab === 'video'}
      <div class="card fade-in"><VideoPanel query={`${tut.title} ${app.profile.make} ${app.profile.model}`} topic={`${tut.id}.${app.profile.id}`} /></div>
    {:else}
      <div class="card col fade-in">
        <h3>Pourquoi cet entretien ?</h3>
        <p>{tut.why}</p>
        <SenseChecks checks={tut.sensory_checks} title="Repérer quand c'est nécessaire" />
      </div>
    {/if}
  {/if}
</div>

<style>
  .tcard { text-align: left; display: flex; flex-direction: column; gap: 0.4rem; color: inherit; font: inherit; }
  .stepper { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  .sdot { width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--border-2); background: var(--panel-2); cursor: pointer; font-weight: 700; font-size: 0.8rem; }
  .sdot.done { border-color: var(--accent); color: var(--accent); }
  .sdot.on { background: var(--grad); color: #06121c; border: none; }
  .item { display: grid; grid-template-columns: 26px 1fr; column-gap: 0.75rem; row-gap: 0.45rem; padding: 0.8rem 0; border-bottom: 1px solid var(--border); align-items: start; }
  .item .info, .item .shops, .item .altwrap { grid-column: 2; }
  .item.done .info { opacity: 0.5; text-decoration: line-through; }
  .iname { font-weight: 650; line-height: 1.35; }
  .imeta { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; color: var(--muted); margin-top: 0.15rem; }
  .imeta .qty { color: var(--text); font-weight: 600; }
  .shops { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip-shop, .chip-alt { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.28rem 0.6rem; border-radius: 8px; font-size: 0.78rem; font-weight: 600; cursor: pointer; background: transparent; color: var(--text);
    border: 1px solid color-mix(in srgb, var(--shop, var(--accent)) 45%, transparent); }
  .chip-shop:hover { background: color-mix(in srgb, var(--shop) 15%, transparent); border-color: var(--shop); }
  .chip-alt { border-color: var(--border-2); color: var(--muted); }
  .chip-alt:hover, .chip-alt.on { color: var(--accent); border-color: var(--accent); }
  .check { margin-top: 0.1rem; width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--border-2); background: var(--panel-2); display: grid; place-items: center; cursor: pointer; color: var(--ok); }
  .altwrap { flex-basis: 100%; }
  .srcpill { color: var(--accent); }
  .totals { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .totals > div { padding: 0.75rem; border-radius: 12px; background: var(--panel-2); border: 1px solid var(--border); }
  .big { font-size: 1.35rem; font-weight: 800; }
</style>
