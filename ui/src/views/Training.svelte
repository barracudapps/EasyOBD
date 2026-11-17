<script lang="ts">
  import { onMount } from 'svelte';
  import { call, errorText } from '../lib/api';
  import { app, save, senseLabel, setProfile, toast } from '../lib/state.svelte';
  import type { ConnectResult, DtcItem, LiveValue, Scenario } from '../lib/types';
  import DiagnosisDetail from '../components/DiagnosisDetail.svelte';
  import Icon from '../components/Icon.svelte';

  let scenarios = $state<Scenario[]>([]);
  let sc = $state<Scenario | null>(null);
  let phase = $state<'story' | 'scan' | 'quiz' | 'debrief'>('story');
  let dtcs = $state<DtcItem[]>([]);
  let live = $state<LiveValue[]>([]);
  let revealed = $state(0);
  let answer = $state<number | null>(null);
  let selectedCode = $state<string | null>(null);
  let scores = $state<Record<string, boolean>>(JSON.parse(localStorage.getItem('easyobd.training') ?? '{}'));

  const levels = ['', 'Débutant', 'Intermédiaire', 'Avancé'];
  const senseIcon: Record<string, string> = { sight: 'eye', sound: 'ear', smell: 'nose', touch: 'hand', feel: 'steering' };
  const current = $derived(dtcs.find((d) => d.code === selectedCode) ?? dtcs[0]);

  onMount(async () => {
    scenarios = await call<Scenario[]>('scenarios');
  });

  function start(s: Scenario) {
    sc = s;
    phase = 'story';
    dtcs = [];
    live = [];
    revealed = 0;
    answer = null;
    const p = app.profiles.find((x) => x.id === s.profile);
    if (p) setProfile(p);
    app.highlight = [];
  }

  async function scan() {
    if (!sc) return;
    try {
      app.connection = await call<ConnectResult>('connect', { spec: { kind: 'simulator', address: sc.id } });
      dtcs = await call<DtcItem[]>('read_dtcs');
      app.dtcs = dtcs;
      const r = await call<{ values: LiveValue[] }>('read_live');
      live = r.values;
      selectedCode = dtcs[0]?.code ?? null;
      phase = 'scan';
      const d = dtcs[0]?.diagnosis;
      if (d) {
        app.highlightSeverity = d.severity;
        app.highlight = d.components.map((c) => c.id);
      }
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  function choose(i: number) {
    if (answer !== null || !sc) return;
    answer = i;
    const ok = sc.question.options[i].correct;
    scores = { ...scores, [sc.id]: ok || !!scores[sc.id] };
    save('easyobd.training', scores);
  }

  const solved = $derived(Object.values(scores).filter(Boolean).length);
</script>

<div class="col">
  <h1>Mode <span class="grad-text">formation</span></h1>

  {#if !sc}
    <p class="muted">
      Des pannes réelles reproduites par le simulateur. Lisez la plainte du client, lisez les codes, observez les indices,
      puis choisissez la meilleure première action. Idéal pour s'entraîner avant une intervention.
    </p>
    <div class="card flat row">
      <Icon name="trophy" size={22} /><div class="grow"><strong>{solved} / {scenarios.length}</strong> <span class="muted small">scénarios réussis</span></div>
      <div class="bar grow"><span style="width:{scenarios.length ? (solved / scenarios.length) * 100 : 0}%"></span></div>
    </div>
    <div class="grid-2">
      {#each scenarios as s}
        <button class="card hover scard" onclick={() => start(s)}>
          <div class="row spread"><span class="pill">{levels[s.level]}</span>{#if scores[s.id]}<span class="pill sev-low"><Icon name="check" size={12} /> Réussi</span>{/if}</div>
          <h3>{s.title}</h3>
          <p class="small muted">{s.story}</p>
        </button>
      {/each}
    </div>
  {:else}
    <div class="row"><button class="btn ghost sm" onclick={() => { sc = null; app.highlight = []; }}><Icon name="back" size={15} /> Scénarios</button>
      <span class="pill">{levels[sc.level]}</span></div>
    <h2>{sc.title}</h2>
    <div class="card story"><Icon name="info" size={18} /><p class="grow"><em>{sc.story}</em></p></div>

    {#if phase === 'story'}
      <div class="card col">
        <p>Étape 1 : branchez l'adaptateur (simulé) sur le véhicule et lisez les codes.</p>
        <button class="btn primary" onclick={scan}><Icon name="scan" size={17} /> Brancher et lire les codes</button>
      </div>
    {:else}
      <div class="card col">
        <h3>Codes lus</h3>
        {#if !dtcs.length}<div class="callout info small">Aucun code défaut : la panne n'est pas visible par le calculateur. Fiez-vous à vos sens.</div>{/if}
        <div class="row">
          {#each dtcs as d}
            <button class="btn sm" class:sel={current?.code === d.code} onclick={() => { selectedCode = d.code; if (d.diagnosis) { app.highlightSeverity = d.diagnosis.severity; app.highlight = d.diagnosis.components.map((c) => c.id); } }}>
              <span class="mono">{d.code}</span> <span class="tiny muted">{d.kind === 'pending' ? 'en attente' : ''}</span>
            </button>
          {/each}
        </div>
        {#if live.length}
          <div class="lives">
            {#each live.filter((v) => ['rpm', 'coolant', 'stft', 'ltft', 'voltage', 'maf'].includes(v.key)) as v}
              <div class="live"><span class="tiny faint">{v.label}</span><strong>{v.value} {v.unit}</strong></div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="card col">
        <h3>Indices sur le véhicule</h3>
        {#each sc.clues.slice(0, revealed) as c}
          <div class="clue fade-in"><Icon name={senseIcon[c.sense]} size={18} /><div><div class="tiny faint">{senseLabel[c.sense]}</div>{c.text}</div></div>
        {/each}
        {#if revealed < sc.clues.length}
          <button class="btn sm" onclick={() => (revealed += 1)}><Icon name="search" size={15} /> Inspecter ({sc.clues.length - revealed} indice{sc.clues.length - revealed > 1 ? 's' : ''})</button>
        {:else if phase === 'scan'}
          <button class="btn primary sm" onclick={() => (phase = 'quiz')}>Je pense avoir trouvé <Icon name="chevron" size={15} /></button>
        {/if}
      </div>

      {#if phase === 'quiz' || phase === 'debrief'}
        <div class="card col fade-in">
          <h3>{sc.question.text}</h3>
          {#each sc.question.options as o, i}
            <button class="answer" class:right={answer !== null && o.correct} class:wrong={answer === i && !o.correct} onclick={() => choose(i)} disabled={answer !== null}>
              <span>{o.text}</span>
              {#if answer !== null && (answer === i || o.correct)}<span class="small fb">{o.feedback}</span>{/if}
            </button>
          {/each}
          {#if answer !== null}
            <div class="callout {sc.question.options[answer].correct ? 'ok' : 'warn'}">
              <strong>{sc.question.options[answer].correct ? 'Bien joué !' : 'Pas tout à fait.'}</strong> {sc.debrief}
            </div>
          {/if}
        </div>
      {/if}

      {#if current?.diagnosis}
        <details class="card">
          <summary><strong>Fiche du code {current.code}</strong> <span class="small muted">(aide)</span></summary>
          <div style="margin-top:0.8rem"><DiagnosisDetail d={current.diagnosis} /></div>
        </details>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .scard { text-align: left; display: flex; flex-direction: column; gap: 0.45rem; color: inherit; font: inherit; }
  .story { display: flex; gap: 0.75rem; align-items: flex-start; }
  .sel { border-color: var(--accent); }
  .lives { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; }
  .live { display: flex; flex-direction: column; padding: 0.55rem 0.7rem; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--border); }
  .clue { display: flex; gap: 0.7rem; padding: 0.65rem; border-radius: 12px; background: var(--panel-2); border: 1px solid var(--border); }
  .answer { display: flex; flex-direction: column; gap: 0.3rem; text-align: left; padding: 0.8rem 1rem; border-radius: 12px; border: 1px solid var(--border-2); background: var(--panel-2); cursor: pointer; }
  .answer:hover:not(:disabled) { border-color: var(--accent); }
  .answer:disabled { cursor: default; }
  .answer.right { border-color: var(--ok); background: rgba(34, 197, 94, 0.1); }
  .answer.wrong { border-color: var(--critical); background: rgba(239, 68, 68, 0.1); }
  .fb { color: var(--muted); }
  details summary { cursor: pointer; }
</style>
