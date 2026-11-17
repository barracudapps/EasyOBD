<script lang="ts">
  import { app, go, type View } from '../lib/state.svelte';
  import Icon from '../components/Icon.svelte';
  import Reminders from '../components/Reminders.svelte';
  import { currentVehicle } from '../lib/state.svelte';
  const vehicle = $derived(app.vehicleId ? currentVehicle() : null);

  let code = $state('');
  app.highlight = [];

  const actions: { view: View; icon: string; title: string; text: string; tone: string }[] = [
    { view: 'diagnostic', icon: 'scan', title: 'Lire les codes', text: 'Adaptateur USB, Bluetooth, BLE ou Wi-Fi : codes, données en direct, explication en 3D.', tone: 'cyan' },
    { view: 'eye', icon: 'eye', title: "Diagnostic à l'œil", text: 'Sans outil : fumée, bruits, odeurs, voyants… le questionnaire oriente vers la cause.', tone: 'violet' },
    { view: 'audio', icon: 'wave', title: 'Écouter le moteur', text: "Enregistrez le moteur : régime, ratés, sifflements, claquements. Analyse sur l'appareil.", tone: 'pink' },
    { view: 'maintenance', icon: 'wrench', title: 'Entretien guidé', text: 'Tutoriels illustrés en 3D et liste de courses adaptée à votre véhicule.', tone: 'amber' },
    { view: 'inspection', icon: 'shield', title: 'Préparer le contrôle technique', text: 'Liste adaptée au véhicule, emplacement du VIN, pré-contrôle OBD.', tone: 'blue' },
    { view: 'training', icon: 'school', title: 'Formation', text: "Pannes simulées réalistes pour s'entraîner avant d'intervenir.", tone: 'green' },
    { view: 'codes', icon: 'book', title: 'Encyclopédie des codes', text: 'Chaque code expliqué : fonctionnement, vérifications par les sens, solutions.', tone: 'blue' },
  ];

  function lookup(e: Event) {
    e.preventDefault();
    if (code.trim()) {
      sessionStorage.setItem('easyobd.codeQuery', code.trim());
      go('codes');
    }
  }
</script>

<div class="col home">
  <section class="hero">
    <div class="tiny faint upper">Diagnostic automobile, moto et poids lourd</div>
    <h1>Comprendre votre véhicule,<br /><span class="grad-text">pas seulement le lire.</span></h1>
    <p class="muted lead">
      EasyOBD traduit les codes défaut en explications claires. Il montre la pièce en 3D, estime le coût et le temps
      de réparation, et vous apprend à reconnaître la panne la prochaine fois, même sans ordinateur.
    </p>
    <form class="search" onsubmit={lookup}>
      <Icon name="search" size={18} />
      <input class="grow" placeholder="Un code à expliquer ? Ex. P0420" bind:value={code} />
      <button class="btn primary sm" type="submit">Expliquer</button>
    </form>
  </section>

  {#if vehicle}
    <div class="card col mycar">
      <div class="row spread">
        <div class="row"><Icon name="car" size={20} /><div><strong>{vehicle.name}</strong><div class="tiny muted">{vehicle.profile.make} {vehicle.profile.model} · {vehicle.profile.engine}{vehicle.mileage ? ` · ${vehicle.mileage.toLocaleString('fr-FR')} km` : ''}</div></div></div>
        <button class="btn sm" onclick={() => go('garage')}>Mon garage</button>
      </div>
      <Reminders {vehicle} limit={3} compact />
    </div>
  {/if}

  <div class="grid-2">
    {#each actions as a}
      <button class="card hover action t-{a.tone}" onclick={() => go(a.view)}>
        <span class="aicon"><Icon name={a.icon} size={22} /></span>
        <div class="col" style="gap:0.25rem">
          <h3>{a.title}</h3>
          <p class="small muted">{a.text}</p>
        </div>
      </button>
    {/each}
  </div>

  <div class="card flat row stats">
    <div><strong>{app.kb?.catalog.length ?? 0}</strong><span class="tiny muted">codes détaillés</span></div>
    <div><strong>{Object.keys(app.kb?.components ?? {}).length}</strong><span class="tiny muted">pièces en 3D</span></div>
    <div><strong>{app.profiles.length}</strong><span class="tiny muted">profils véhicules</span></div>
    <div><strong>100 %</strong><span class="tiny muted">hors ligne</span></div>
  </div>

  <button class="card flat hover expert row" onclick={() => go('expert')}>
    <Icon name="chip" size={22} />
    <div class="grow">
      <strong>Mode expert</strong>
      <div class="small muted">Scan de tous les calculateurs, identification, console UDS et paramétrage, avec garde-fous.</div>
    </div>
    <Icon name="chevron" />
  </button>
</div>

<style>
  .home { gap: 1.25rem; }
  .hero { display: flex; flex-direction: column; gap: 0.9rem; padding: 0.5rem 0 0.5rem; }
  .upper { text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700; }
  .lead { font-size: 1.05rem; max-width: 46ch; }
  .search { display: flex; align-items: center; gap: 0.6rem; padding: 0.45rem 0.45rem 0.45rem 0.9rem; border-radius: 14px;
    background: var(--panel); border: 1px solid var(--border-2); max-width: 520px; color: var(--muted); }
  .search input { border: none; background: none; outline: none; font-size: 1rem; color: var(--text); }
  .action { display: flex; gap: 0.9rem; text-align: left; color: inherit; font: inherit; align-items: flex-start; }
  .aicon { width: 44px; height: 44px; border-radius: 13px; display: grid; place-items: center; flex-shrink: 0; background: var(--tone-bg); color: var(--tone); }
  .t-cyan { --tone: #22d3ee; --tone-bg: rgba(34, 211, 238, 0.13); }
  .t-violet { --tone: #a78bfa; --tone-bg: rgba(167, 139, 250, 0.14); }
  .t-pink { --tone: #f472b6; --tone-bg: rgba(244, 114, 182, 0.13); }
  .t-amber { --tone: #f59e0b; --tone-bg: rgba(245, 158, 11, 0.13); }
  .t-green { --tone: #22c55e; --tone-bg: rgba(34, 197, 94, 0.13); }
  .t-blue { --tone: #60a5fa; --tone-bg: rgba(96, 165, 250, 0.13); }
  .mycar { border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }
  .stats { justify-content: space-around; text-align: center; }
  .stats div { display: flex; flex-direction: column; }
  .stats strong { font-size: 1.4rem; }
  .expert { text-align: left; color: inherit; font: inherit; border-color: rgba(239, 68, 68, 0.3); }
</style>
