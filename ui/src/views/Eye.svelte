<script lang="ts">
  import { onMount } from 'svelte';
  import { call, errorText } from '../lib/api';
  import { app, go, senseLabel, severityLabel, toast } from '../lib/state.svelte';
  import type { Question, RankedHypothesis } from '../lib/types';
  import Icon from '../components/Icon.svelte';

  let intro = $state('');
  let questions = $state<Question[]>([]);
  let answers = $state<Record<string, string[]>>({});
  let step = $state(0);
  let results = $state<RankedHypothesis[]>([]);
  let notes = $state<string[]>([]);
  let focus = $state<string | null>(null);

  const senseIcon: Record<string, string> = { sight: 'eye', sound: 'ear', smell: 'nose', touch: 'hand', feel: 'steering' };
  function visible(x: Question) {
    const m = (c: { question: string; options: string[] } | null | undefined) => !!c && (answers[c.question] ?? []).some((o) => c.options.includes(o));
    return (!x.show_if || m(x.show_if)) && !m(x.hide_if);
  }
  const shown = $derived(questions.filter(visible));
  const done = $derived(step >= shown.length);
  const q = $derived(shown[step]);

  onMount(async () => {
    try {
      const g = await call<{ intro: string; questions: Question[] }>('symptoms_guide');
      intro = g.intro;
      questions = g.questions;
      const fuel = app.profile?.fuel;
      if (fuel && g.questions.some((x) => x.id === 'fuel')) {
        answers = { fuel: [fuel] };
        step = 1;
      }
      evaluate();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  });

  async function evaluate() {
    const r = await call<{ hypotheses: RankedHypothesis[]; notes: string[] }>('symptoms_evaluate', { answers, extra: app.audioEvidence });
    results = r.hypotheses;
    notes = r.notes;
    const top = focus ? results.find((h) => h.id === focus) : results[0];
    if (top) {
      app.highlightSeverity = top.severity;
      app.highlight = top.components;
    } else app.highlight = [];
  }

  function toggle(qid: string, oid: string, multi: boolean) {
    const cur = answers[qid] ?? [];
    let next: string[];
    if (!multi) next = [oid];
    else if (['none', 'nothing', 'always'].includes(oid)) next = cur.includes(oid) ? [] : [oid];
    else next = cur.includes(oid) ? cur.filter((x) => x !== oid) : [...cur.filter((x) => !['none', 'nothing', 'always'].includes(x)), oid];
    answers = { ...answers, [qid]: next };
    evaluate();
    if (!multi) setTimeout(() => (step += 1), 180);
  }

  function restart() {
    answers = {};
    step = 0;
    focus = null;
    evaluate();
  }

  function showHyp(h: RankedHypothesis) {
    focus = h.id;
    app.highlightSeverity = h.severity;
    app.highlight = h.components;
  }

  function openCode(code: string) {
    sessionStorage.setItem('easyobd.codeQuery', code);
    go('codes');
  }
  function openTutorial(id: string) {
    sessionStorage.setItem('easyobd.tutorial', id);
    go('maintenance');
  }
</script>

<div class="col">
  <h1>Diagnostic <span class="grad-text">à l'œil</span></h1>
  <p class="muted">{intro}</p>
  {#if app.audioEvidence.length}
    <div class="callout info small row"><Icon name="wave" size={16} /> L'analyse audio est prise en compte ({app.audioEvidence.length} indice{app.audioEvidence.length > 1 ? 's' : ''}).
      <button class="btn ghost sm" onclick={() => { app.audioEvidence = []; evaluate(); }}>Retirer</button></div>
  {/if}

  <div class="progress row">
    {#each shown as qq, i}
      <button class="pstep" class:done={answers[qq.id]?.length} class:current={i === step} aria-label={qq.text} onclick={() => (step = i)}>
        <Icon name={senseIcon[qq.sense]} size={14} />
      </button>
    {/each}
    <button class="pstep" class:current={done} aria-label="Résultats" onclick={() => (step = shown.length)}><Icon name="star" size={14} /></button>
  </div>

  {#if q && !done}
    <div class="card col fade-in">
      <div class="row tiny faint upper"><Icon name={senseIcon[q.sense]} size={15} /> {senseLabel[q.sense]} · question {step + 1}/{shown.length}</div>
      <h2>{q.text}</h2>
      {#if q.help}<p class="small muted">{q.help}</p>{/if}
      <div class="options">
        {#each q.options as o}
          <button class="opt" class:on={answers[q.id]?.includes(o.id)} onclick={() => toggle(q.id, o.id, q.multi)}>
            {#if q.multi}<span class="box">{#if answers[q.id]?.includes(o.id)}<Icon name="check" size={13} />{/if}</span>{/if}
            {o.label}
          </button>
        {/each}
      </div>
      <div class="row spread">
        <button class="btn ghost sm" disabled={step === 0} onclick={() => (step -= 1)}><Icon name="back" size={15} /> Précédent</button>
        <span class="tiny faint">{q.multi ? 'Plusieurs choix possibles' : ''}</span>
        <button class="btn sm" onclick={() => (step += 1)}>{answers[q.id]?.length ? 'Suivant' : 'Je ne sais pas'} <Icon name="chevron" size={15} /></button>
      </div>
    </div>
  {/if}

  {#each notes as n}<div class="callout ok small">{n}</div>{/each}

  <div class="col">
    <div class="row spread">
      <h2>{done ? 'Pistes les plus probables' : 'Pistes en cours'}</h2>
      <button class="btn ghost sm" onclick={restart}><Icon name="refresh" size={15} /> Recommencer</button>
    </div>
    {#each results as h, i (h.id)}
      <div class="card flat hyp sev-bar-{h.severity}" class:selected={focus ? focus === h.id : i === 0}>
        <button class="hyp-head" onclick={() => showHyp(h)}>
          <div class="grow col" style="gap:0.3rem">
            <div class="row"><strong>{h.title}</strong><span class="pill sev-{h.severity}">{severityLabel[h.severity]}</span><span class="pill">Indices {h.strength}s</span></div>
            <div class="bar"><span style="width:{h.relative}%"></span></div>
          </div>
        </button>
        {#if (focus ? focus === h.id : i === 0) && done}
          <div class="col fade-in small">
            <p>{h.explanation}</p>
            <div><span class="faint">Indices : </span>{h.evidence.join(' · ')}</div>
            {#if h.next_checks.length}
              <div><strong>À vérifier ensuite</strong><ul>{#each h.next_checks as c}<li>{c}</li>{/each}</ul></div>
            {/if}
            <div class="row">
              {#each h.codes as c}<button class="btn sm" onclick={() => openCode(c.code)}><span class="mono">{c.code}</span></button>{/each}
              {#if h.tutorial}<button class="btn sm" onclick={() => openTutorial(h.tutorial!)}><Icon name="wrench" size={14} /> Tutoriel</button>{/if}
              {#if ['misfire_ignition', 'accessory_belt', 'turbo_worn', 'reducer_noise', 'wheel_bearing', 'brake_wear'].includes(h.id)}
                <button class="btn sm" onclick={() => go('audio')}><Icon name="wave" size={14} /> Confirmer à l'oreille</button>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <p class="muted small">Répondez aux questions : les hypothèses apparaissent au fur et à mesure.</p>
    {/each}
    {#if done && results.length}
      <p class="tiny faint">Orientation pédagogique, pas un diagnostic certain. Une lecture des codes (adaptateur OBD) ou un contrôle par un professionnel confirmera la cause.</p>
    {/if}
  </div>
</div>

<style>
  .upper { text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; }
  .progress { gap: 0.3rem; }
  .pstep { width: 32px; height: 32px; border-radius: 10px; border: 1px solid var(--border-2); background: var(--panel-2); display: grid; place-items: center; cursor: pointer; color: var(--muted); }
  .pstep.done { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .pstep.current { background: var(--grad); color: #06121c; border: none; }
  .options { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .opt { display: inline-flex; align-items: center; gap: 0.5rem; text-align: left; padding: 0.6rem 0.9rem; border-radius: 12px; border: 1px solid var(--border-2); background: var(--panel-2); cursor: pointer; }
  .opt:hover { border-color: var(--accent); }
  .opt.on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .box { width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--border-2); display: grid; place-items: center; color: var(--accent); }
  .hyp { padding: 0.8rem 1rem; display: flex; flex-direction: column; gap: 0.6rem; border-left: 3px solid var(--sev); }
  .hyp-head { background: none; border: none; padding: 0; text-align: left; cursor: pointer; width: 100%; }
</style>
