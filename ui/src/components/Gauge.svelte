<script lang="ts">
  import type { LiveValue } from '../lib/types';
  let { v }: { v: LiveValue } = $props();
  const R = 38;
  const C = Math.PI * R * 1.5; // 270° arc
  const frac = $derived(Math.min(1, Math.max(0, (v.value - v.min) / (v.max - v.min || 1))));
  const warn = $derived(
    (v.key === 'coolant' && (v.value > 105 || v.value < 70)) ||
      ((v.key === 'stft' || v.key === 'ltft') && Math.abs(v.value) > 10) ||
      (v.key === 'voltage' && (v.value < 13.2 || v.value > 15)),
  );
</script>

<div class="gauge card flat" class:warn>
  <svg viewBox="0 0 100 92" aria-hidden="true">
    <defs>
      <linearGradient id="gg" x1="0" x2="1">
        <stop offset="0" stop-color="#22d3ee" /><stop offset="1" stop-color="#a78bfa" />
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r={R} fill="none" stroke="var(--panel-2)" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="{C} 999" transform="rotate(135 50 50)" />
    <circle cx="50" cy="50" r={R} fill="none" stroke={warn ? 'var(--high)' : 'url(#gg)'} stroke-width="8" stroke-linecap="round"
      stroke-dasharray="{C * frac} 999" transform="rotate(135 50 50)" style="transition: stroke-dasharray 0.6s" />
    <text x="50" y="52" text-anchor="middle" class="val">{v.value}</text>
    <text x="50" y="68" text-anchor="middle" class="unit">{v.unit}</text>
  </svg>
  <div class="label small">{v.label}</div>
</div>

<style>
  .gauge { padding: 0.6rem; text-align: center; }
  .gauge.warn { border-color: rgba(249, 115, 22, 0.55); }
  svg { width: 100%; max-width: 130px; }
  .val { font-size: 17px; font-weight: 800; fill: var(--text); }
  .unit { font-size: 9px; fill: var(--muted); }
  .label { color: var(--muted); margin-top: -0.4rem; }
</style>
