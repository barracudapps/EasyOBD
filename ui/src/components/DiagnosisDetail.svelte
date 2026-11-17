<script lang="ts">
  import { openUrl } from '../lib/api';
  import { app, fmt, severityLabel } from '../lib/state.svelte';
  import type { Diagnosis } from '../lib/types';
  import Icon from './Icon.svelte';
  import SenseChecks from './SenseChecks.svelte';
  import VideoPanel from './VideoPanel.svelte';
  import Photos from './Photos.svelte';

  let { d }: { d: Diagnosis } = $props();
  let tab = $state<'learn' | 'causes' | 'fix'>('learn');
  let openSolution = $state(0);
  let videoFor = $state<number | null>(null);

  $effect(() => {
    void d.code;
    tab = 'learn';
    openSolution = 0;
  });
</script>

<article class="col detail">
  <header class="col head sev-bar-{d.severity}">
    <div class="row">
      <span class="code-chip">{d.code}</span>
      <span class="pill sev-{d.severity}"><Icon name="alert" size={13} /> Gravité {severityLabel[d.severity].toLowerCase()}</span>
      <span class="pill">{d.system}</span>
      {#if d.manufacturer_specific}<span class="pill">Code constructeur</span>{/if}
    </div>
    <h2>{d.title}</h2>
    <p class="muted">{d.description}</p>
    <div class="callout {d.severity === 'critical' ? 'danger' : d.severity === 'high' ? 'warn' : 'info'} row">
      <Icon name="steering" size={18} /><span class="grow"><strong>Puis-je rouler ?</strong> {d.drivable}</span>
    </div>
  </header>

  {#if d.match_kind === 'generic'}
    <div class="callout">
      Pas encore de fiche détaillée pour ce code : seule la famille est connue. Essayez le diagnostic « À l'œil » pour affiner.
    </div>
  {:else}
    <div class="tabs">
      <button class:active={tab === 'learn'} onclick={() => (tab = 'learn')}><Icon name="school" size={15} /> Comprendre</button>
      <button class:active={tab === 'causes'} onclick={() => (tab = 'causes')}><Icon name="search" size={15} /> Causes</button>
      <button class:active={tab === 'fix'} onclick={() => (tab = 'fix')}><Icon name="wrench" size={15} /> Solutions ({d.solutions.length})</button>
    </div>

    {#if tab === 'learn'}
      <div class="col fade-in">
        {#if d.how_it_works}
          <div class="card flat col">
            <h3>Comment ça marche</h3>
            <p>{d.how_it_works}</p>
            <Photos components={d.components.map((c) => c.id)} />
            {#if d.components.length}
              <div class="row">
                {#each d.components as c}
                  <button class="pill comp" onclick={() => { app.highlightSeverity = 'info'; app.highlight = [c.id]; }}>{c.name}</button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
        <SenseChecks checks={d.sensory_checks} />
        {#if d.symptoms.length}
          <div class="col">
            <h3>Symptômes typiques</h3>
            <div class="row">{#each d.symptoms as s}<span class="pill">{s}</span>{/each}</div>
          </div>
        {/if}
      </div>
    {:else if tab === 'causes'}
      <ul class="list-reset col fade-in">
        {#each d.causes as c, i}
          <li class="card flat cause">
            <div class="row spread"><span>{i + 1}. {c.text}</span><strong class="small">{c.likelihood} %</strong></div>
            <div class="bar"><span style="width:{c.likelihood}%"></span></div>
          </li>
        {/each}
        <p class="tiny faint">Probabilités indicatives, issues des cas les plus fréquents. Commencez par la cause la plus probable ET la moins chère à vérifier.</p>
      </ul>
    {:else}
      <div class="col fade-in">
        {#each d.solutions as s, i}
          <div class="card flat sol" class:open={openSolution === i}>
            <button class="sol-head" onclick={() => (openSolution = openSolution === i ? -1 : i)}>
              <div class="grow col" style="gap:0.35rem">
                <strong>{s.title}</strong>
                <div class="row small muted">
                  <span class="row" style="gap:4px"><Icon name="gauge" size={15} />
                    <span class="dots">{#each [1, 2, 3, 4, 5] as k}<i class:on={k <= s.difficulty}></i>{/each}</span>
                    {s.difficulty_label}</span>
                  <span class="row" style="gap:4px"><Icon name="clock" size={15} />{fmt.time(s.time_min, s.time_max)}</span>
                  <span class="row" style="gap:4px"><Icon name="euro" size={15} />{s.parts.length ? fmt.eur(s.cost.parts_min, s.cost.parts_max) : '—'}</span>
                </div>
              </div>
              <Icon name="chevron" size={18} />
            </button>
            {#if openSolution === i}
              <div class="col fade-in sol-body">
                {#if s.description}<p class="muted">{s.description}</p>{/if}
                <div class="costs">
                  <div class="cost">
                    <div class="tiny faint">FAIRE SOI-MÊME</div>
                    <div class="big">{fmt.eur(s.cost.parts_min, s.cost.parts_max)}</div>
                    <div class="tiny muted">pièces</div>
                  </div>
                  <div class="cost">
                    <div class="tiny faint">AU GARAGE (ESTIMATION)</div>
                    <div class="big">{fmt.eur(s.cost.garage_min, s.cost.garage_max)}</div>
                    <div class="tiny muted">dont main-d'œuvre {fmt.eur(s.cost.labor_min, s.cost.labor_max)} ({app.kb?.labor_rate_eur_h} €/h)</div>
                  </div>
                </div>
                {#if s.parts.length}
                  <h3>Pièces</h3>
                  {#each s.parts as p}
                    <div class="part">
                      <div class="grow">
                        <div>{p.qty > 1 ? `${p.qty} × ` : ''}{p.name}</div>
                        <div class="small muted">{fmt.eur(p.price_min, p.price_max)}</div>
                      </div>
                      <div class="shops">
                        {#each p.links as l}
                          <button class="chip-shop" style="--shop:{l.color ?? 'var(--accent)'}" onclick={() => openUrl(l.url)}>
                            {l.name}<Icon name="external" size={11} />
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/each}
                  <p class="tiny faint">Prix indicatifs (pièces adaptables, hors promotions). Vérifiez la compatibilité avec votre immatriculation sur le site marchand.</p>
                {/if}
                {#if s.tools.length}
                  <div><h3>Outils</h3><div class="row" style="margin-top:0.4rem">{#each s.tools as t}<span class="pill">{t}</span>{/each}</div></div>
                {/if}
                <div>
                  <button class="btn sm" onclick={() => (videoFor = videoFor === i ? null : i)}><Icon name="sim" size={14} /> Vidéos de réparation</button>
                  {#if videoFor === i}
                    <div style="margin-top:0.6rem"><VideoPanel query={`${s.title} ${app.profile ? `${app.profile.make} ${app.profile.model}` : d.code}`} topic={`${d.code}.${i}`} /></div>
                  {/if}
                </div>
                {#if s.steps.length}
                  <div>
                    <h3>Étapes</h3>
                    <ol class="steps">{#each s.steps as st}<li>{st}</li>{/each}</ol>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</article>

<style>
  .head { padding-left: 0.9rem; border-left: 3px solid var(--sev, var(--accent)); }
  .comp { cursor: pointer; }
  .comp:hover { border-color: var(--accent); }
  .cause { padding: 0.75rem 0.9rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .sol { padding: 0; overflow: hidden; }
  .sol.open { border-color: var(--border-2); }
  .sol-head { width: 100%; display: flex; align-items: center; gap: 0.75rem; padding: 0.9rem 1rem; background: none; border: none; cursor: pointer; text-align: left; }
  .sol.open .sol-head :global(svg:last-child) { transform: rotate(90deg); }
  .sol-body { padding: 0 1rem 1rem; }
  .costs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .cost { padding: 0.75rem; border-radius: 12px; background: var(--panel-2); border: 1px solid var(--border); }
  .cost .big { font-size: 1.35rem; font-weight: 800; }
  .part { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.65rem 0; border-bottom: 1px solid var(--border); }
  .part .grow > div:first-child { font-weight: 600; }
  .shops { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip-shop { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.28rem 0.6rem; border-radius: 8px; font-size: 0.78rem; font-weight: 600; cursor: pointer; background: transparent; color: var(--text);
    border: 1px solid color-mix(in srgb, var(--shop) 45%, transparent); }
  .chip-shop:hover { background: color-mix(in srgb, var(--shop) 15%, transparent); border-color: var(--shop); }
  .steps { margin: 0.4rem 0 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.3rem; }
  @media (max-width: 520px) { .costs { grid-template-columns: 1fr; } }
</style>
