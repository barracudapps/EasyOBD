<script lang="ts">
  import { compatLabel } from '../lib/state.svelte';
  import type { Alternative } from '../lib/types';

  let { items, title = 'Alternatives moins chères' }: { items: Alternative[]; title?: string } = $props();
</script>

{#if items.length}
  <div class="alts">
    <div class="tiny faint upper">{title}</div>
    {#each items as a}
      <div class="alt c-{a.compatibility}">
        <div class="row spread">
          <strong class="small">{a.label}</strong>
          <div class="row" style="gap:0.35rem">
            {#if a.saving}<span class="pill tiny">−{a.saving}</span>{/if}
            <span class="pill tiny badge">{compatLabel[a.compatibility]}</span>
          </div>
        </div>
        {#if a.note}<p class="tiny muted">{a.note}</p>{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .alts { display: flex; flex-direction: column; gap: 0.4rem; margin-top: 0.5rem; }
  .upper { text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; }
  .alt { padding: 0.55rem 0.7rem; border-radius: 10px; border: 1px solid var(--border); border-left: 3px solid var(--c); background: var(--panel-2); display: flex; flex-direction: column; gap: 0.25rem; }
  .badge { color: var(--c); border-color: color-mix(in srgb, var(--c) 50%, transparent); }
  .c-equivalent { --c: var(--ok); }
  .c-compatible { --c: var(--accent); }
  .c-discouraged { --c: var(--medium); }
  .c-forbidden { --c: var(--critical); }
</style>
