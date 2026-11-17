<script lang="ts">
  import { onMount } from 'svelte';
  import { app, bootstrap, go, save, type View } from './lib/state.svelte';
  import { errorText, isNative } from './lib/api';
  import Icon from './components/Icon.svelte';
  import Viewer3D from './components/Viewer3D.svelte';
  import VehiclePicker from './components/VehiclePicker.svelte';
  import Home from './views/Home.svelte';
  import Diagnostic from './views/Diagnostic.svelte';
  import Eye from './views/Eye.svelte';
  import Audio from './views/Audio.svelte';
  import Maintenance from './views/Maintenance.svelte';
  import Training from './views/Training.svelte';
  import Codes from './views/Codes.svelte';
  import Expert from './views/Expert.svelte';

  let ready = $state(false);
  let failure = $state('');

  const nav: { id: View; label: string; icon: string }[] = [
    { id: 'home', label: 'Accueil', icon: 'home' },
    { id: 'diagnostic', label: 'Diagnostic', icon: 'scan' },
    { id: 'eye', label: "À l'œil", icon: 'eye' },
    { id: 'audio', label: 'Audio', icon: 'wave' },
    { id: 'maintenance', label: 'Entretien', icon: 'wrench' },
    { id: 'training', label: 'Formation', icon: 'school' },
    { id: 'codes', label: 'Codes', icon: 'book' },
    { id: 'expert', label: 'Expert', icon: 'chip' },
  ];
  const withStage: View[] = ['home', 'diagnostic', 'eye', 'maintenance', 'training', 'codes'];

  onMount(async () => {
    try {
      await bootstrap();
      ready = true;
    } catch (e) {
      failure = errorText(e);
    }
  });

  $effect(() => {
    document.documentElement.dataset.theme = app.theme;
    save('easyobd.theme', app.theme);
  });

  const vehicleIcon = $derived(app.profile?.type ?? 'car');
</script>

<div class="shell">
  <header class="topbar">
    <button class="brand" onclick={() => go('home')}>
      <span class="logo"><Icon name="scan" size={18} /></span>
      <span class="name">Easy<span class="grad-text">OBD</span></span>
    </button>
    <div class="grow"></div>
    <button class="btn sm vehicle" onclick={() => (app.pickerOpen = true)} title="Choisir le véhicule">
      <Icon name={vehicleIcon} size={18} />
      <span class="vlabel">{app.profile ? `${app.profile.make} ${app.profile.model}` : 'Choisir mon véhicule'}</span>
    </button>
    <span class="pill conn" class:on={!!app.connection} title={app.connection?.adapter.transport}>
      <span class="led"></span>{app.connection ? (app.connection.simulated ? 'Simulation' : 'Connecté') : 'Hors ligne OBD'}
    </span>
    <button class="btn ghost sm" aria-label="Thème" onclick={() => (app.theme = app.theme === 'dark' ? 'light' : 'dark')}>
      <Icon name={app.theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  </header>

  <nav class="sidenav">
    {#each nav as n}
      <button class:active={app.view === n.id} onclick={() => go(n.id)} class:expert={n.id === 'expert'}>
        <Icon name={n.icon} size={21} /><span>{n.label}</span>
      </button>
    {/each}
    <div class="grow"></div>
    <div class="platform tiny faint">{isNative ? 'Application' : 'Version web'}</div>
  </nav>

  <main class="main" class:staged={withStage.includes(app.view)}>
    {#if failure}
      <div class="card callout danger">Impossible de charger le moteur EasyOBD : {failure}</div>
    {:else if !ready}
      <div class="row muted"><span class="spinner"></span> Chargement…</div>
    {:else}
      <section class="content fade-in">
        {#key app.view}
          {#if app.view === 'home'}<Home />
          {:else if app.view === 'diagnostic'}<Diagnostic />
          {:else if app.view === 'eye'}<Eye />
          {:else if app.view === 'audio'}<Audio />
          {:else if app.view === 'maintenance'}<Maintenance />
          {:else if app.view === 'training'}<Training />
          {:else if app.view === 'codes'}<Codes />
          {:else if app.view === 'expert'}<Expert />
          {/if}
        {/key}
      </section>
      <aside class="stage" class:hidden={!withStage.includes(app.view)}>
        <Viewer3D />
      </aside>
    {/if}
  </main>

  {#if app.pickerOpen}
    <VehiclePicker onclose={() => (app.pickerOpen = false)} />
  {/if}

  {#if app.toast}
    <div class="toast card fade-in {app.toast.kind}">{app.toast.text}</div>
  {/if}
</div>

<style>
  .shell { display: grid; grid-template-columns: 92px 1fr; grid-template-rows: 60px 1fr; min-height: 100vh; }
  .topbar { grid-column: 1 / -1; display: flex; align-items: center; gap: 0.6rem; padding: 0 1rem; position: sticky; top: 0; z-index: 20;
    background: color-mix(in srgb, var(--bg) 80%, transparent); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border); }
  .brand { display: flex; align-items: center; gap: 0.55rem; background: none; border: none; cursor: pointer; padding: 0; }
  .logo { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; background: var(--grad); color: #06121c; }
  .name { font-weight: 800; font-size: 1.15rem; letter-spacing: -0.02em; }
  .vehicle { max-width: 40vw; }
  .vlabel { overflow: hidden; text-overflow: ellipsis; }
  .conn .led { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
  .conn.on .led { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .sidenav { position: sticky; top: 60px; height: calc(100vh - 60px); display: flex; flex-direction: column; gap: 4px; padding: 10px 8px; border-right: 1px solid var(--border); }
  .sidenav button { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 4px; border-radius: 13px; border: none; background: transparent; cursor: pointer; color: var(--muted); font-size: 0.7rem; font-weight: 600; }
  .sidenav button:hover { background: var(--panel-2); color: var(--text); }
  .sidenav button.active { background: var(--panel-2); color: var(--text); box-shadow: inset 0 0 0 1px var(--border-2); }
  .sidenav button.active :global(svg) { color: var(--accent); }
  .sidenav button.expert.active :global(svg) { color: var(--critical); }
  .platform { text-align: center; }
  .main { padding: 1.25rem; display: grid; gap: 1.25rem; grid-template-columns: minmax(0, 1fr); align-items: start; }
  .main.staged { grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); }
  .stage { position: sticky; top: 80px; height: calc(100vh - 100px); }
  .stage.hidden { display: none; }
  .content { min-width: 0; }
  .toast { position: fixed; right: 16px; bottom: 16px; z-index: 50; max-width: 420px; padding: 0.8rem 1rem; }
  .toast.error { border-color: rgba(239, 68, 68, 0.6); }
  .toast.ok { border-color: rgba(34, 197, 94, 0.6); }

  @media (max-width: 1100px) {
    .main.staged { grid-template-columns: 1fr; }
    .stage { position: relative; top: 0; height: 46vh; order: -1; }
  }
  @media (max-width: 720px) {
    .shell { grid-template-columns: 1fr; grid-template-rows: 56px 1fr; padding-bottom: 70px; }
    .topbar { padding: 0 0.75rem; }
    .vlabel, .conn { display: none; }
    .sidenav { position: fixed; top: auto; bottom: 0; left: 0; right: 0; height: 66px; flex-direction: row; overflow-x: auto; z-index: 30;
      border-right: none; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 90%, transparent); backdrop-filter: blur(16px); padding: 6px; }
    .sidenav button { min-width: 64px; }
    .sidenav .grow, .platform { display: none; }
    .main { padding: 0.75rem; gap: 0.75rem; }
    .stage { height: 38vh; min-height: 260px; }
    .toast { left: 12px; right: 12px; bottom: 80px; }
  }
</style>
