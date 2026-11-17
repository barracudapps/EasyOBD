<script lang="ts">
  import { onDestroy } from 'svelte';
  import { call, errorText, isNative } from '../lib/api';
  import { addJournal, app, currentVehicle, selectVehicle, severityLabel, toast, updateVehicle } from '../lib/state.svelte';
  import type { AdapterCandidate, ConnectResult, ConnectionSpec, DtcItem, LiveValue } from '../lib/types';
  import Icon from '../components/Icon.svelte';
  import DiagnosisDetail from '../components/DiagnosisDetail.svelte';
  import Gauge from '../components/Gauge.svelte';

  let candidates = $state<AdapterCandidate[]>([]);
  let messages = $state<string[]>([]);
  let scanning = $state(false);
  let busy = $state('');
  let selected = $state<string | null>(app.dtcs[0]?.code ?? null);
  let tab = $state<'codes' | 'live'>('codes');
  let live = $state<LiveValue[]>([]);
  let battery = $state<number | null>(null);
  let polling = $state<ReturnType<typeof setInterval> | null>(null);
  let confirmClear = $state(false);
  let manual = $state({ kind: 'wifi' as 'wifi' | 'serial', address: '192.168.0.10:35000', baud: 38400 });

  const mediumIcon: Record<string, string> = { usb: 'usb', bluetooth: 'bluetooth', ble: 'bluetooth', wifi: 'wifi', simulator: 'sim' };
  const kindLabel: Record<string, string> = { stored: 'Confirmé', pending: 'En attente', permanent: 'Permanent' };
  const current = $derived(app.dtcs.find((d) => d.code === selected) ?? null);

  $effect(() => {
    const d = current?.diagnosis;
    if (d) {
      app.highlightSeverity = d.severity;
      app.highlight = d.components.map((c) => c.id);
    }
  });

  async function discover() {
    scanning = true;
    try {
      const r = await call<{ candidates: AdapterCandidate[]; messages: string[] }>('discover', { options: { ble_seconds: 4 } });
      candidates = r.candidates;
      messages = r.messages;
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      scanning = false;
    }
  }

  async function connect(spec: ConnectionSpec) {
    busy = 'connect';
    try {
      app.connection = await call<ConnectResult>('connect', { spec });
      toast(`Connecté : ${app.connection.adapter.protocol}`, 'ok');
      // Recognise a garage vehicle by its VIN.
      const vin = app.connection.vehicle.vin;
      const known = vin ? app.garage.find((v) => v.vin === vin) : undefined;
      if (known && known.id !== app.vehicleId && !app.connection.simulated) {
        selectVehicle(known.id);
        toast(`Véhicule reconnu : ${known.name}`, 'ok');
      }
      await readCodes();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      busy = '';
    }
  }

  async function readCodes() {
    busy = 'codes';
    try {
      app.dtcs = await call<DtcItem[]>('read_dtcs');
      selected = app.dtcs[0]?.code ?? null;
      if (!app.connection?.simulated) {
        addJournal({ kind: 'diagnostic', title: app.dtcs.length ? `${app.dtcs.length} code(s) défaut lu(s)` : 'Lecture OBD : aucun code', codes: app.dtcs.map((d) => d.code), details: app.dtcs.map((d) => `${d.code} ${d.diagnosis?.title ?? ''}`).join(' · ') });
        const v = currentVehicle();
        const vin = app.connection?.vehicle.vin;
        if (v && vin && !v.vin) updateVehicle(v.id, { vin });
      }
      if (!app.dtcs.length) {
        app.highlight = [];
        toast('Aucun code défaut enregistré.', 'ok');
      }
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      busy = '';
    }
  }

  async function clearCodes() {
    busy = 'clear';
    try {
      await call('clear_dtcs');
      confirmClear = false;
      toast('Codes effacés. Le voyant s’éteint ; le code reviendra si la panne persiste.', 'ok');
      if (!app.connection?.simulated) addJournal({ kind: 'repair', title: 'Codes défaut effacés', codes: app.dtcs.map((d) => d.code) });
      await readCodes();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      busy = '';
    }
  }

  async function disconnect() {
    stopLive();
    await call('disconnect');
    app.connection = null;
    app.dtcs = [];
    app.highlight = [];
  }

  async function pollLive() {
    try {
      const r = await call<{ values: LiveValue[]; battery_v: number | null }>('read_live');
      live = r.values;
      battery = r.battery_v;
    } catch (e) {
      stopLive();
      toast(errorText(e), 'error');
    }
  }
  function startLive() {
    tab = 'live';
    if (!polling) {
      pollLive();
      polling = setInterval(pollLive, 1200);
    }
  }
  function stopLive() {
    if (polling) clearInterval(polling);
    polling = null;
  }
  onDestroy(stopLive);

  if (isNative && !app.connection) discover();
</script>

<div class="col">
  <div class="row spread">
    <div>
      <h1>Diagnostic <span class="grad-text">OBD-II</span></h1>
      <p class="muted">Branchez l'adaptateur sur la prise OBD (sous le volant), mettez le contact, puis connectez-vous.</p>
    </div>
  </div>

  {#if !app.connection}
    <div class="card col">
      <div class="row spread">
        <h2>Adaptateurs</h2>
        {#if isNative}
          <button class="btn sm" onclick={discover} disabled={scanning}>
            {#if scanning}<span class="spinner"></span> Recherche…{:else}<Icon name="refresh" size={16} /> Rechercher{/if}
          </button>
        {/if}
      </div>
      {#if !isNative}
        <div class="callout info small">
          Version web : pas d'accès direct au matériel. Utilisez le simulateur pour découvrir l'application,
          ou l'application installée (Windows, macOS, Linux, Android, iOS) pour les adaptateurs USB, Bluetooth, BLE et Wi-Fi.
        </div>
      {/if}
      <ul class="list-reset col">
        {#each candidates.length ? candidates : [{ spec: { kind: 'simulator', address: '' }, label: 'Simulateur (véhicule de démonstration)', medium: 'simulator', verified: true, chip: 'ELM327 v1.5 (virtuel)', clone_suspected: false, note: null } as AdapterCandidate] as c}
          <li class="adapter card flat">
            <span class="aicon"><Icon name={mediumIcon[c.medium]} size={22} /></span>
            <div class="grow">
              <div class="row"><strong>{c.label}</strong>
                {#if c.verified && c.medium !== 'simulator'}<span class="pill sev-low"><Icon name="check" size={12} /> Répond</span>{/if}
                {#if c.clone_suspected}<span class="pill sev-medium">Clone probable</span>{/if}
              </div>
              <div class="small muted">{c.chip ?? (c.verified ? '' : 'Non vérifié : la connexion le confirmera')}</div>
              {#if c.note}<div class="tiny faint">{c.note}</div>{/if}
            </div>
            <button class="btn primary sm" disabled={!!busy} onclick={() => connect(c.spec)}>
              {#if busy === 'connect'}<span class="spinner"></span>{/if} Connecter
            </button>
          </li>
        {/each}
      </ul>
      {#each messages as m}<p class="tiny faint">{m}</p>{/each}

      {#if isNative}
        <details>
          <summary class="small muted">Connexion manuelle</summary>
          <div class="row" style="margin-top:0.6rem">
            <select class="input" style="max-width:140px" bind:value={manual.kind}>
              <option value="wifi">Wi-Fi</option><option value="serial">USB / série</option>
            </select>
            <input class="input grow" bind:value={manual.address} placeholder={manual.kind === 'wifi' ? '192.168.0.10:35000' : '/dev/cu.usbserial-XXXX ou COM3'} />
            {#if manual.kind === 'serial'}<input class="input" style="max-width:110px" type="number" bind:value={manual.baud} />{/if}
            <button class="btn sm" onclick={() => connect({ kind: manual.kind, address: manual.address, baud: manual.baud })}>Connecter</button>
          </div>
        </details>
      {/if}
    </div>

    <div class="card flat col small">
      <h3>Quel adaptateur choisir ?</h3>
      <div class="grid-3">
        <div><strong>Bluetooth LE</strong><p class="muted">Compatible iPhone, Android et ordinateurs (Vgate iCar Pro BLE, OBDLink CX, Veepeak BLE…).</p></div>
        <div><strong>Wi-Fi</strong><p class="muted">Universel : connectez l'appareil au Wi-Fi du dongle, puis « Rechercher ».</p></div>
        <div><strong>USB / Bluetooth classique</strong><p class="muted">Ordinateurs : le plus fiable (puces FTDI, OBDLink SX/EX). Bluetooth classique : appairez d'abord.</p></div>
      </div>
    </div>
  {:else}
    <div class="print-only">
      <h1>Rapport de diagnostic EasyOBD</h1>
      <p>{new Date().toLocaleString('fr-FR')} · {app.profile ? `${app.profile.make} ${app.profile.model} ${app.profile.engine}` : ''}</p>
    </div>
    <div class="card conn">
      <div class="grid-3">
        <div><div class="tiny faint">VÉHICULE</div><strong>{app.connection.vehicle.make ?? 'Marque inconnue'} {app.connection.vehicle.model_year ?? ''}</strong>
          <div class="tiny muted mono">{app.connection.vehicle.vin ?? 'VIN non communiqué'}</div></div>
        <div><div class="tiny faint">PROTOCOLE</div><strong class="small">{app.connection.adapter.protocol}</strong>
          <div class="tiny muted">{app.connection.adapter.elm_version} · {app.connection.adapter.transport}</div></div>
        <div><div class="tiny faint">ÉTAT</div>
          <div class="row">
            <span class="pill {app.connection.monitor?.mil_on ? 'sev-high' : 'sev-low'}">Voyant moteur {app.connection.monitor?.mil_on ? 'allumé' : 'éteint'}</span>
            {#if (battery ?? app.connection.battery_v) != null}<span class="pill"><Icon name="battery" size={13} /> {(battery ?? app.connection.battery_v)?.toFixed(1)} V</span>{/if}
          </div></div>
      </div>
      <div class="row" style="margin-top:0.9rem">
        <button class="btn sm" onclick={readCodes} disabled={!!busy}><Icon name="refresh" size={15} /> Relire les codes</button>
        <button class="btn sm" onclick={() => (polling ? stopLive() : startLive())}><Icon name="gauge" size={15} /> {polling ? 'Arrêter le direct' : 'Données en direct'}</button>
        {#if confirmClear}
          <span class="small">Effacer les codes et éteindre le voyant ?</span>
          <button class="btn danger sm" onclick={clearCodes}>Confirmer</button>
          <button class="btn ghost sm" onclick={() => (confirmClear = false)}>Annuler</button>
        {:else}
          <button class="btn sm" onclick={() => (confirmClear = true)} disabled={!app.dtcs.length}><Icon name="trash" size={15} /> Effacer</button>
        {/if}
        <div class="grow"></div>
        <button class="btn ghost sm" onclick={() => window.print()} title="Imprimer ou enregistrer en PDF"><Icon name="book" size={15} /> Rapport</button>
        <button class="btn ghost sm" onclick={disconnect}>Déconnecter</button>
      </div>
    </div>

    <div class="tabs">
      <button class:active={tab === 'codes'} onclick={() => (tab = 'codes')}>Codes défaut ({app.dtcs.length})</button>
      <button class:active={tab === 'live'} onclick={startLive}>Données en direct</button>
    </div>

    {#if tab === 'codes'}
      {#if !app.dtcs.length}
        <div class="card callout ok">Aucun code défaut. Si un symptôme persiste, essayez le diagnostic « À l'œil » ou l'analyse audio.</div>
      {:else}
        <div class="codes">
          {#each app.dtcs as item}
            <button class="card flat hover dtc sev-bar-{item.diagnosis?.severity ?? 'medium'}" class:selected={selected === item.code} onclick={() => (selected = item.code)}>
              <div class="row spread"><span class="code-chip">{item.code}</span><span class="pill tiny">{kindLabel[item.kind]}</span></div>
              <div class="small">{item.diagnosis?.title ?? 'Code inconnu'}</div>
              {#if item.diagnosis}<span class="pill sev-{item.diagnosis.severity}">{severityLabel[item.diagnosis.severity]}</span>{/if}
            </button>
          {/each}
        </div>
        {#if current?.diagnosis}
          <div class="card no-print"><DiagnosisDetail d={current.diagnosis} /></div>
        {/if}
        <div class="print-only">
          {#each app.dtcs as item}
            {#if item.diagnosis}
              <div class="card" style="margin-bottom:0.6rem">
                <h3>{item.code} · {item.diagnosis.title}</h3>
                <p>{item.diagnosis.description}</p>
                <p><strong>Puis-je rouler ?</strong> {item.diagnosis.drivable}</p>
                <p><strong>Causes probables :</strong> {item.diagnosis.causes.map((c) => `${c.text} (${c.likelihood} %)`).join(' ; ')}</p>
                <p><strong>Solutions :</strong> {item.diagnosis.solutions.map((s) => `${s.title} (${s.difficulty_label}, ${Math.round(s.cost.parts_min)}–${Math.round(s.cost.parts_max)} € de pièces)`).join(' ; ')}</p>
              </div>
            {/if}
          {/each}
          <p class="tiny">Rapport indicatif généré par EasyOBD : il ne remplace pas un diagnostic professionnel.</p>
        </div>
      {/if}
    {:else}
      <div class="gauges">
        {#each live as v (v.key)}<Gauge {v} />{:else}<div class="row muted"><span class="spinner"></span> Lecture…</div>{/each}
      </div>
      <p class="tiny faint">Repères : liquide de refroidissement 85–100 °C moteur chaud · corrections de richesse entre −10 % et +10 % · tension 13,8–14,7 V moteur tournant.</p>
    {/if}
  {/if}
</div>

<style>
  .adapter { display: flex; align-items: center; gap: 0.8rem; padding: 0.75rem 0.9rem; }
  .aicon { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: var(--panel-2); color: var(--accent); flex-shrink: 0; }
  .codes { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0.6rem; }
  .dtc { display: flex; flex-direction: column; gap: 0.45rem; text-align: left; border-left: 3px solid var(--sev); color: inherit; font: inherit; }
  .gauges { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.6rem; }
  details summary { cursor: pointer; }
</style>
