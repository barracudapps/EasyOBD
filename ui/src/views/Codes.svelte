<script lang="ts">
  import { call, errorText } from '../lib/api';
  import { app, severityLabel } from '../lib/state.svelte';
  import type { Diagnosis } from '../lib/types';
  import DiagnosisDetail from '../components/DiagnosisDetail.svelte';
  import Icon from '../components/Icon.svelte';

  let query = $state(sessionStorage.getItem('easyobd.codeQuery') ?? '');
  sessionStorage.removeItem('easyobd.codeQuery');
  let system = $state('');
  let d = $state<Diagnosis | null>(null);
  let err = $state('');

  const systems = $derived([...new Set(app.kb?.catalog.map((c) => c.system))].sort());
  const filtered = $derived(
    (app.kb?.catalog ?? []).filter(
      (c) => (!system || c.system === system) && `${c.code} ${c.title}`.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );

  async function open(code: string) {
    err = '';
    try {
      d = await call<Diagnosis>('kb_lookup', { code, make: app.profile?.make });
      app.highlightSeverity = d.severity;
      app.highlight = d.components.map((c) => c.id);
    } catch (e) {
      err = errorText(e);
    }
  }

  // Direct lookup of any typed code (even without a dedicated entry).
  const typedCode = $derived(/^[PCBU][0-3][0-9A-F]{3}$/i.test(query.trim()) ? query.trim().toUpperCase() : null);
  $effect(() => {
    if (typedCode) open(typedCode);
  });
</script>

<div class="col">
  <h1>Encyclopédie <span class="grad-text">des codes</span></h1>
  <p class="muted">Chaque fiche explique le fonctionnement, les vérifications à faire avec vos sens et les réparations possibles.</p>

  <div class="row">
    <div class="search grow"><Icon name="search" size={17} /><input class="grow" placeholder="Code ou mot-clé (P0301, lambda, turbo…)" bind:value={query} /></div>
    <select class="input" style="max-width:240px" bind:value={system}>
      <option value="">Tous les systèmes</option>
      {#each systems as s}<option>{s}</option>{/each}
    </select>
  </div>

  {#if d}
    <div class="card fade-in">
      <div class="row spread" style="margin-bottom:0.5rem">
        <button class="btn ghost sm" onclick={() => { d = null; app.highlight = []; }}><Icon name="back" size={15} /> Liste</button>
      </div>
      <DiagnosisDetail {d} />
    </div>
  {:else}
    {#if err}<div class="callout danger">{err}</div>{/if}
    <div class="list">
      {#each filtered.slice(0, 200) as c (c.code)}
        <button class="card flat hover item" onclick={() => open(c.code)}>
          <span class="code-chip">{c.code}</span>
          <span class="grow small">{c.title}</span>
          <span class="pill sev-{c.severity}">{severityLabel[c.severity]}</span>
        </button>
      {:else}
        <p class="muted">Aucun code ne correspond.</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.8rem; border-radius: 12px; border: 1px solid var(--border-2); background: var(--panel-2); color: var(--muted); }
  .search input { border: none; outline: none; background: none; color: var(--text); }
  .list { display: flex; flex-direction: column; gap: 0.4rem; }
  .item { display: flex; align-items: center; gap: 0.8rem; text-align: left; padding: 0.6rem 0.9rem; color: inherit; font: inherit; }
</style>
