<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { call, errorText, isNative } from '../lib/api';
  import { addJournal, app, currentVehicle, go, selectVehicle, severityLabel, toast, updateVehicle, disconnect as endSession } from '../lib/state.svelte';
  import type { AdapterCandidate, ConnectResult, ConnectionSpec, DtcItem, J1939Lamps, J1939Result, LiveValue } from '../lib/types';
  import Icon from '../components/Icon.svelte';
  import DiagnosisDetail from '../components/DiagnosisDetail.svelte';
  import Gauge from '../components/Gauge.svelte';
  import { webBluetoothSupported, webSerialSupported } from '../lib/webobd';

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
  /** Heavy vehicle: SAE J1939 instead of OBD-II (default for trucks). */
  let j1939 = $state(app.profile?.type === 'truck' || app.profile?.type === 'tractor');
  let lamps = $state<J1939Lamps | null>(null);
  const isJ1939 = $derived(!!app.connection?.j1939);
  /** EOBD became mandatory in the EU in 2001 (petrol) and 2004 (diesel); quadricycles are not covered. */
  const obdNote = $derived.by(() => {
    const p = app.profile;
    if (!p || !['car', 'van'].includes(p.type)) return null;
    if (['Aixam', 'Ligier', 'Microcar', 'Chatenet'].includes(p.make) && p.fuel !== 'electric')
      return { level: 'warn', text: "Voiture sans permis (quadricycle léger) : elle n'est pas soumise à l'EOBD. La prise de diagnostic, quand elle existe, utilise souvent le protocole du constructeur : un adaptateur OBD-II peut ne rien lire. Le diagnostic à l'œil, l'écoute moteur et les tutoriels restent utilisables." };
    if (!p.years) return null;
    const limit = p.fuel === 'diesel' ? 2004 : 2001;
    if (p.years[1] < limit)
      return { level: 'warn', text: `Ce véhicule est antérieur à l'EOBD (obligatoire depuis ${limit} en ${p.fuel === 'diesel' ? 'diesel' : 'essence'}) : il n'a en général ni prise OBD normalisée ni codes lisibles par un adaptateur ELM327. Utilisez le diagnostic à l'œil, l'écoute moteur et les tutoriels ; la lecture électronique demande l'outil et le connecteur d'origine du constructeur.` };
    if (p.years[0] < limit)
      return { level: 'info', text: `Compatibilité OBD selon l'année : les exemplaires mis en circulation avant ${limit} (${p.fuel === 'diesel' ? 'diesel' : 'essence'}) ne sont en général pas compatibles EOBD.` };
    return null;
  });
  const fold = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  /** Vehicle shown in the connection card: the selected model when it matches what the car reports. */
  const vehicleLabel = $derived.by(() => {
    const v = app.connection?.vehicle;
    const p = app.profile;
    const year = v?.model_year ?? '';
    const same = p && (app.connection?.simulated || isJ1939 || !v?.make || fold(v.make).startsWith(fold(p.make)) || fold(p.make).startsWith(fold(v.make)));
    if (p && same) return `${p.make} ${p.model} ${year}`.trim();
    return `${v?.make ?? 'Marque inconnue'} ${year}`.trim();
  });
  let manual = $state({ kind: 'wifi' as 'wifi' | 'serial', address: '192.168.0.10:35000', baud: 38400 });

  const mediumIcon: Record<string, string> = { usb: 'usb', bluetooth: 'bluetooth', ble: 'bluetooth', wifi: 'wifi', simulator: 'sim' };
  const kindLabel: Record<string, string> = { stored: 'Confirmé', pending: 'En attente', permanent: 'Permanent', active: 'Actif' };
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
      const p = app.profile;
      // Simulator: the demo vehicle takes the identity of the selected one.
      const ident = spec.kind === 'simulator' && p ? { make: p.make, vehicle_type: p.type, year: p.years ? Math.min(p.years[1], new Date().getFullYear()) : null } : {};
      app.connection = await call<ConnectResult>('connect', { spec, j1939, ...ident });
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
      if (app.connection?.j1939) {
        const r = await call<J1939Result>('read_j1939', { make: app.profile?.make ?? null });
        app.dtcs = r.items;
        lamps = r.lamps;
      } else {
        app.dtcs = await call<DtcItem[]>('read_dtcs');
      }
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
    await endSession();
  }
  // Session closed from elsewhere (header pill, Expert page): stop polling and clear local state.
  $effect(() => {
    if (!app.connection) {
      untrack(() => {
        stopLive();
        lamps = null;
      });
    }
  });

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
      <h1>Diagnostic <span class="grad-text">{isJ1939 || (!app.connection && j1939) ? 'J1939' : 'OBD-II'}</span></h1>
      <p class="muted">Branchez l'adaptateur sur la prise OBD (sous le volant), mettez le contact, puis connectez-vous.</p>
    </div>
  </div>

  {#if obdNote}
    <div class="callout {obdNote.level} small row">
      <Icon name="info" size={16} />
      <span class="grow">{obdNote.text}</span>
      {#if obdNote.level === 'warn'}<button class="btn sm" onclick={() => go('eye')}><Icon name="eye" size={14} /> Diagnostic à l'œil</button>{/if}
    </div>
  {/if}

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
        {#if webSerialSupported || webBluetoothSupported}
          <div class="webhw">
            {#if webBluetoothSupported}
              <button class="card flat hover adapter" disabled={!!busy} onclick={() => connect({ kind: 'webble', address: '' })}>
                <span class="aicon"><Icon name="bluetooth" size={22} /></span>
                <div class="grow"><strong>Adaptateur Bluetooth LE</strong><div class="small muted">Vgate iCar BLE, OBDLink CX, Veepeak BLE… Choisissez l'appareil dans la fenêtre du navigateur.</div></div>
              </button>
            {/if}
            {#if webSerialSupported}
              <button class="card flat hover adapter" disabled={!!busy} onclick={() => connect({ kind: 'webserial', address: '', baud: manual.baud })}>
                <span class="aicon"><Icon name="usb" size={22} /></span>
                <div class="grow"><strong>Adaptateur USB / série</strong><div class="small muted">ELM327 USB, OBDLink SX/EX, ou Bluetooth classique appairé (ordinateur). Débit : {manual.baud} bauds.</div></div>
              </button>
            {/if}
          </div>
          <p class="tiny faint">Accès matériel du navigateur (Chrome, Edge, Chrome Android). Les adaptateurs Wi-Fi et le mode expert nécessitent l'application installée.</p>
        {:else}
          <div class="callout info small">
            Ce navigateur n'a pas accès aux adaptateurs : utilisez Chrome ou Edge (ordinateur, Android), l'application installée,
            ou le simulateur pour découvrir EasyOBD.
          </div>
        {/if}
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

      <label class="j1939 card flat">
        <input type="checkbox" bind:checked={j1939} />
        <span class="grow">
          <strong>Poids lourd / tracteur : protocole J1939</strong>
          <span class="small muted block">Camions, bus, tracteurs (ISOBUS), engins de chantier. Codes SPN / FMI lus sur la prise 9 broches (Deutsch) ou la prise 16 broches poids lourd. Adaptateur compatible J1939 requis (OBDLink, ELM327 v1.4b+ authentique, câble 9 broches).</span>
        </span>
      </label>

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
        <div><div class="tiny faint">VÉHICULE</div><strong>{vehicleLabel}</strong>
          <div class="tiny muted mono">{app.connection.vehicle.vin ?? 'VIN non communiqué'}{app.connection.simulated && app.connection.vehicle.vin ? ' (démo)' : ''}</div></div>
        <div><div class="tiny faint">PROTOCOLE</div><strong class="small">{app.connection.adapter.protocol}</strong>
          <div class="tiny muted">{app.connection.adapter.elm_version} · {app.connection.adapter.transport}</div></div>
        <div><div class="tiny faint">ÉTAT</div>
          <div class="row">
            {#if isJ1939}
              {#if lamps?.red_stop}<span class="pill sev-critical">Témoin rouge STOP</span>{/if}
              {#if lamps?.amber_warning}<span class="pill sev-medium">Témoin ambre</span>{/if}
              {#if lamps?.mil}<span class="pill sev-high">Voyant dépollution</span>{/if}
              {#if lamps?.protect}<span class="pill sev-medium">Témoin protection</span>{/if}
              {#if lamps && !lamps.red_stop && !lamps.amber_warning && !lamps.mil && !lamps.protect}<span class="pill sev-low">Aucun témoin</span>{/if}
            {:else}
            <span class="pill {app.connection.monitor?.mil_on ? 'sev-high' : 'sev-low'}">Voyant moteur {app.connection.monitor?.mil_on ? 'allumé' : 'éteint'}</span>
            {/if}
            {#if (battery ?? app.connection.battery_v) != null}<span class="pill"><Icon name="battery" size={13} /> {(battery ?? app.connection.battery_v)?.toFixed(1)} V</span>{/if}
          </div></div>
      </div>
      <div class="row" style="margin-top:0.9rem">
        <button class="btn sm" onclick={readCodes} disabled={!!busy}><Icon name="refresh" size={15} /> Relire les codes</button>
        {#if !isJ1939}
        <button class="btn sm" onclick={() => (polling ? stopLive() : startLive())}><Icon name="gauge" size={15} /> {polling ? 'Arrêter le direct' : 'Données en direct'}</button>
        {/if}
        {#if confirmClear}
          <span class="small">Effacer les codes et éteindre le voyant ?</span>
          <button class="btn danger sm" onclick={clearCodes}>Confirmer</button>
          <button class="btn ghost sm" onclick={() => (confirmClear = false)}>Annuler</button>
        {:else}
          <button class="btn sm" onclick={() => (confirmClear = true)} disabled={!app.dtcs.length || isJ1939} title={isJ1939 ? "Sur poids lourd, l'effacement se fait avec l'outil du constructeur après réparation" : ''}><Icon name="trash" size={15} /> Effacer</button>
        {/if}
        <div class="grow"></div>
        <button class="btn ghost sm" onclick={() => window.print()} title="Imprimer ou enregistrer en PDF"><Icon name="book" size={15} /> Rapport</button>
        <button class="btn ghost sm" onclick={disconnect}>Déconnecter</button>
      </div>
    </div>

    <div class="tabs">
      <button class:active={tab === 'codes'} onclick={() => (tab = 'codes')}>Codes défaut ({app.dtcs.length})</button>
      {#if !isJ1939}<button class:active={tab === 'live'} onclick={startLive}>Données en direct</button>{/if}
    </div>

    {#if tab === 'codes'}
      {#if !app.dtcs.length}
        <div class="card callout ok">Aucun code défaut. Si un symptôme persiste, essayez le diagnostic « À l'œil » ou l'analyse audio.</div>
      {:else}
        <div class="codes">
          {#each app.dtcs as item}
            <button class="card flat hover dtc sev-bar-{item.diagnosis?.severity ?? 'medium'}" class:selected={selected === item.code} onclick={() => (selected = item.code)}>
              <div class="row spread"><span class="code-chip" class:spn={item.code.startsWith('SPN')}>{item.code}</span><span class="pill tiny">{kindLabel[item.kind]}</span></div>
              <div class="small">{item.diagnosis?.title ?? 'Code inconnu'}</div>
              {#if item.source}<div class="tiny faint">{item.source}{item.occurrences ? ` · ${item.occurrences} occurrence${item.occurrences > 1 ? 's' : ''}` : ''}</div>{/if}
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
  .webhw { display: grid; gap: 0.5rem; }
  .code-chip.spn { font-size: 0.85rem; }
  .j1939 { display: flex; gap: 0.7rem; align-items: flex-start; padding: 0.7rem 0.9rem; cursor: pointer; }
  .j1939 input { margin-top: 0.25rem; accent-color: var(--accent); }
  .block { display: block; }
  .webhw .adapter { text-align: left; color: inherit; font: inherit; }
</style>
