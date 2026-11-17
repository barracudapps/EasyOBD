<script lang="ts">
  import { call } from '../lib/api';
  import { computeReminders, type Reminder } from '../lib/reminders';
  import { addJournal, app, go, type GarageVehicle } from '../lib/state.svelte';
  import type { TutorialSummary } from '../lib/types';
  import Icon from './Icon.svelte';

  let { vehicle, limit = 0, compact = false }: { vehicle: GarageVehicle; limit?: number; compact?: boolean } = $props();
  let tutorials = $state<TutorialSummary[]>([]);

  $effect(() => {
    call<TutorialSummary[]>('tutorials_for', { profile: vehicle.profile }).then((t) => (tutorials = t));
  });

  const all = $derived(computeReminders(vehicle, app.journal, tutorials));
  const shown = $derived(limit ? all.filter((r) => r.status !== 'ok').slice(0, limit) : all);
  const label: Record<string, string> = { overdue: 'En retard', soon: 'Bientôt', ok: 'À jour', unknown: 'À renseigner' };
  const cls: Record<string, string> = { overdue: 'sev-critical', soon: 'sev-medium', ok: 'sev-low', unknown: '' };

  function done(r: Reminder) {
    if (r.id === 'ct') {
      go('garage');
      return;
    }
    addJournal({ kind: 'maintenance', title: r.title, details: 'Marqué comme fait depuis les rappels' });
  }
  function open(r: Reminder) {
    if (r.tutorialId) {
      sessionStorage.setItem('easyobd.tutorial', r.tutorialId);
      go('maintenance');
    } else if (r.id === 'ct') go('inspection');
  }
</script>

<ul class="list-reset col rem" class:compact>
  {#each shown as r (r.id)}
    <li class="row r">
      <span class="pill tiny {cls[r.status]}">{label[r.status]}</span>
      <button class="grow body" onclick={() => open(r)}>
        <strong class="small">{r.title}</strong>
        <span class="tiny muted">{r.detail}</span>
      </button>
      {#if !compact && r.id !== 'ct'}
        <button class="btn ghost sm" title="Marquer comme fait aujourd'hui" onclick={() => done(r)}><Icon name="check" size={14} /> Fait</button>
      {/if}
    </li>
  {:else}
    <li class="small muted">Rien à signaler pour l'instant.</li>
  {/each}
</ul>

<style>
  .rem { gap: 0.35rem; }
  .r { gap: 0.6rem; padding: 0.45rem 0; border-bottom: 1px solid var(--border); flex-wrap: nowrap; }
  .r:last-child { border-bottom: none; }
  .body { display: flex; flex-direction: column; text-align: left; background: none; border: none; padding: 0; cursor: pointer; color: inherit; min-width: 0; }
  .pill { min-width: 86px; justify-content: center; }
</style>
