<script lang="ts">
  import { senseLabel } from '../lib/state.svelte';
  import type { SensoryCheck } from '../lib/types';
  import Icon from './Icon.svelte';

  let { checks, title = 'Vérifier avec vos sens' }: { checks: SensoryCheck[]; title?: string } = $props();
  const icon: Record<string, string> = { sight: 'eye', sound: 'ear', smell: 'nose', touch: 'hand', feel: 'steering' };
</script>

{#if checks.length}
  <div class="col">
    <h3>{title}</h3>
    <p class="small muted">Sans outil ni ordinateur : ces observations confirment ou écartent une piste. Retenez-les pour reconnaître le problème la prochaine fois.</p>
    <ul class="list-reset col">
      {#each checks as c}
        <li class="check">
          <span class="ico s-{c.sense}" title={senseLabel[c.sense]}><Icon name={icon[c.sense] ?? 'eye'} size={18} /></span>
          <div class="grow">
            <div class="tiny faint upper">{senseLabel[c.sense] ?? c.sense}</div>
            <div>{c.tip}</div>
            {#if c.means}<div class="means small">→ {c.means}</div>{/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>
{/if}

<style>
  .check { display: flex; gap: 0.75rem; padding: 0.7rem; border-radius: 12px; background: var(--panel-2); border: 1px solid var(--border); }
  .ico { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex-shrink: 0; }
  .s-sight { background: rgba(34, 211, 238, 0.14); color: #22d3ee; }
  .s-sound { background: rgba(167, 139, 250, 0.16); color: #a78bfa; }
  .s-smell { background: rgba(244, 114, 182, 0.15); color: #f472b6; }
  .s-touch { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
  .s-feel { background: rgba(34, 197, 94, 0.14); color: #22c55e; }
  .upper { text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
  .means { color: var(--accent); margin-top: 0.2rem; }
</style>
