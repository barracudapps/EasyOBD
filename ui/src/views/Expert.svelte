<script lang="ts">
  import { onMount } from 'svelte';
  import { call, errorText } from '../lib/api';
  import { app, go, toast } from '../lib/state.svelte';
  import type { ConnectResult, EcuReport, WriteRecord } from '../lib/types';
  import Icon from '../components/Icon.svelte';

  type Pack = { name: string; author?: string; vehicle?: string; params: { name: string; ecu: string; did: string; description?: string; options: { label: string; data: string }[] }[] };

  let info = $state<{ disclaimer: string; ack_phrase: string; ecus: { tx: number; name: string }[]; journal: WriteRecord[] } | null>(null);
  let checks = $state([false, false, false]);
  let ecus = $state<EcuReport[]>([]);
  let scanning = $state(false);
  let ecu = $state(0x7e0);
  let request = $state('22F190');
  let ack = $state('');
  let log = $state<{ req: string; res: string; ok: boolean }[]>([]);
  let w = $state({ did: '', data: '' });
  let pre = $state<{ ok: boolean; problems: string[]; battery_v?: number | null; rpm?: number | null } | null>(null);
  let journal = $state<WriteRecord[]>([]);
  let pack = $state<Pack | null>(null);

  onMount(async () => {
    info = await call('expert_info');
    journal = info!.journal;
  });

  const hex = (n: number, w = 3) => n.toString(16).toUpperCase().padStart(w, '0');
  const isWrite = $derived(/^(10|11|14|2E|2F|31)/i.test(request.replace(/\s/g, '')));

  async function scanAll() {
    scanning = true;
    try {
      ecus = await call<EcuReport[]>('uds_scan');
      if (!ecus.length) toast('Aucun calculateur UDS n’a répondu sur les adresses OBD standard.', 'info');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      scanning = false;
    }
  }

  async function send(req = request) {
    try {
      const r = await call<{ request: string; response: string }>('uds_raw', { ecu, request: req, ack });
      log = [{ req: `${hex(ecu)} › ${r.request}`, res: r.response, ok: true }, ...log].slice(0, 50);
    } catch (e) {
      log = [{ req: `${hex(ecu)} › ${req}`, res: errorText(e), ok: false }, ...log].slice(0, 50);
    }
  }

  async function checkPre() {
    try {
      pre = await call('uds_preconditions');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function write(did = w.did, data = w.data, ecuTx = ecu) {
    try {
      const rec = await call<WriteRecord>('uds_write', { ecu: ecuTx, did: parseInt(did, 16), data, ack });
      journal = [...journal, rec];
      toast(rec.verified ? 'Écriture effectuée et vérifiée par relecture.' : 'Écriture envoyée, mais la relecture diffère : vérifiez.', rec.verified ? 'ok' : 'error');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  async function restore(r: WriteRecord) {
    if (!r.before) return;
    await write(hex(r.did, 4), r.before.replace(/\s/g, ''), r.ecu);
  }

  async function loadPack(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const p = JSON.parse(await f.text()) as Pack;
      if (!p.name || !Array.isArray(p.params)) throw new Error('format de pack invalide');
      pack = p;
    } catch (err) {
      toast(`Pack illisible : ${errorText(err)}`, 'error');
    }
  }

  async function simulate() {
    app.connection = await call<ConnectResult>('connect', { spec: { kind: 'simulator', address: '' } });
  }
</script>

<div class="col">
  <h1>Mode <span class="danger-text">expert</span></h1>

  {#if !app.expertUnlocked}
    <div class="card col warnbox">
      <div class="row"><Icon name="shield" size={26} /><h2>Avant d'aller plus loin</h2></div>
      <p>{info?.disclaimer}</p>
      <ul class="list-reset col">
        {#each ['Je comprends que je peux endommager ou immobiliser mon véhicule.', 'J’assume seul(e) l’entière responsabilité de mes actions ; les auteurs d’EasyOBD ne sont pas responsables.', 'J’interviendrai moteur coupé, véhicule à l’arrêt, batterie chargée ou sous chargeur.'] as t, i}
          <li><label class="row ack"><input type="checkbox" bind:checked={checks[i]} /> <span class="grow">{t}</span></label></li>
        {/each}
      </ul>
      <div class="row">
        <button class="btn danger" disabled={!checks.every(Boolean)} onclick={() => (app.expertUnlocked = true)}><Icon name="unlock" size={16} /> Accéder au mode expert</button>
        <button class="btn ghost" onclick={() => go('home')}>Revenir en lieu sûr</button>
      </div>
      <p class="tiny faint">Ce que le mode expert ne fera jamais : reprogrammer un calculateur, écrire en mémoire brute, ou forcer un accès sécurisé.</p>
    </div>
  {:else if !app.connection}
    <div class="card col">
      <p>Connectez d'abord un adaptateur (onglet Diagnostic). Le mode expert nécessite un véhicule en CAN (la plupart des véhicules depuis 2008).</p>
      <div class="row">
        <button class="btn" onclick={() => go('diagnostic')}><Icon name="scan" size={16} /> Diagnostic</button>
        <button class="btn" onclick={simulate}><Icon name="sim" size={16} /> S'entraîner sur le simulateur</button>
      </div>
    </div>
  {:else}
    {#if app.connection.simulated}<div class="callout info small">Simulateur : idéal pour apprendre la console UDS sans risque.</div>{/if}

    <div class="card col">
      <div class="row spread">
        <div><h2>Tous les calculateurs</h2><p class="small muted">Identification (références, versions) et codes défaut UDS de chaque calculateur qui répond.</p></div>
        <button class="btn primary sm" onclick={scanAll} disabled={scanning}>{#if scanning}<span class="spinner"></span>{:else}<Icon name="scan" size={15} />{/if} Scanner</button>
      </div>
      {#each ecus as e}
        <div class="card flat col ecu">
          <div class="row spread"><strong>{e.name}</strong><span class="mono small muted">0x{hex(e.tx)}</span></div>
          {#if e.identification.length}
            <table class="ident small">
              <tbody>{#each e.identification as i}<tr><td class="muted">{i.name}</td><td class="mono">{i.value}</td></tr>{/each}</tbody>
            </table>
          {/if}
          {#if e.dtcs.length}
            <div class="row">{#each e.dtcs as d}<span class="pill {d.confirmed ? 'sev-high' : 'sev-medium'} mono">{d.code}-{hex(d.failure_type, 2)}{d.mil ? ' · MIL' : ''}</span>{/each}</div>
          {:else if e.error}<div class="tiny faint">{e.error}</div>{:else}<div class="tiny faint">Aucun défaut UDS.</div>{/if}
        </div>
      {/each}
    </div>

    <div class="card col">
      <h2>Console UDS</h2>
      <div class="row">
        <select class="input" style="max-width:260px" bind:value={ecu}>
          {#each info?.ecus ?? [] as e}<option value={e.tx}>0x{hex(e.tx)} · {e.name}</option>{/each}
        </select>
        <input class="input mono grow" bind:value={request} placeholder="22 F1 90" />
        <button class="btn sm" onclick={() => send()} disabled={isWrite && ack.trim().toUpperCase() !== info?.ack_phrase}>Envoyer</button>
      </div>
      <div class="row">
        {#each [['Lire VIN', '22F190'], ['Réf. pièce', '22F187'], ['Version logicielle', '22F195'], ['Défauts UDS', '1902FF'], ['Présence', '3E00'], ['Session étendue', '1003']] as [l, r]}
          <button class="btn sm ghost" onclick={() => { request = r; if (!/^10/.test(r)) send(r); }}>{l}</button>
        {/each}
      </div>
      {#if isWrite}
        <div class="callout danger small">Cette requête modifie l'état du calculateur. Tapez <strong class="mono">{info?.ack_phrase}</strong> pour l'autoriser.</div>
      {/if}
      <div class="log mono small">
        {#each log as l}<div class:err={!l.ok}><span class="faint">{l.req}</span><br />‹ {l.res}</div>{:else}<span class="faint">Les échanges s'affichent ici.</span>{/each}
      </div>
    </div>

    <div class="card col writebox">
      <h2>Modifier un paramètre</h2>
      <p class="small muted">
        Écriture d'un identifiant (DID) en session étendue. EasyOBD relit la valeur d'origine pour pouvoir la restaurer, puis vérifie la nouvelle.
        Les DID dépendent du constructeur : EasyOBD n'en fournit pas. Importez un pack dont vous connaissez la source.
      </p>
      <div class="row">
        <label class="btn sm"><Icon name="upload" size={15} /> Importer un pack (.json)<input type="file" accept="application/json,.json" hidden onchange={loadPack} /></label>
        {#if pack}<span class="small">Pack : <strong>{pack.name}</strong> {pack.author ? `par ${pack.author}` : ''} {pack.vehicle ? `· ${pack.vehicle}` : ''}</span>{/if}
      </div>
      {#if pack}
        {#each pack.params as p}
          <div class="card flat col param">
            <strong>{p.name}</strong>{#if p.description}<span class="small muted">{p.description}</span>{/if}
            <div class="row">{#each p.options as o}<button class="btn sm" onclick={() => { ecu = parseInt(p.ecu, 16); w = { did: p.did, data: o.data }; }}>{o.label}</button>{/each}</div>
          </div>
        {/each}
      {/if}
      <div class="grid-3">
        <label class="field">Calculateur<select class="input" bind:value={ecu}>{#each info?.ecus ?? [] as e}<option value={e.tx}>0x{hex(e.tx)}</option>{/each}</select></label>
        <label class="field">DID (hex)<input class="input mono" bind:value={w.did} placeholder="0100" /></label>
        <label class="field">Valeur (hex)<input class="input mono" bind:value={w.data} placeholder="05" /></label>
      </div>
      <div class="row">
        <button class="btn sm" onclick={checkPre}><Icon name="shield" size={15} /> Vérifier les conditions</button>
        {#if pre}
          {#if pre.ok}<span class="pill sev-low">OK · {pre.battery_v?.toFixed(1)} V · moteur coupé</span>
          {:else}{#each pre.problems as p}<span class="pill sev-critical">{p}</span>{/each}{/if}
        {/if}
      </div>
      <label class="field">Confirmation : tapez « {info?.ack_phrase} »<input class="input mono" bind:value={ack} autocomplete="off" /></label>
      <button class="btn danger" disabled={!w.did || !w.data || ack.trim().toUpperCase() !== info?.ack_phrase} onclick={() => write()}>
        <Icon name="alert" size={16} /> Écrire la valeur
      </button>

      {#if journal.length}
        <h3>Journal des modifications</h3>
        {#each [...journal].reverse() as r}
          <div class="row jrow small mono">
            <span>0x{hex(r.ecu)} · DID {hex(r.did, 4)}</span><span class="faint">{r.before ?? '?'} → {r.after ?? r.written}</span>
            <span class="pill {r.verified ? 'sev-low' : 'sev-high'}">{r.verified ? 'vérifié' : 'non vérifié'}</span>
            {#if r.before}<button class="btn sm ghost" onclick={() => restore(r)}>Restaurer</button>{/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .danger-text { color: var(--critical); }
  .warnbox { border-color: rgba(239, 68, 68, 0.5); background: linear-gradient(180deg, rgba(239, 68, 68, 0.08), transparent 60%), var(--panel); }
  .warnbox :global(svg) { color: var(--critical); }
  .ack { align-items: flex-start; cursor: pointer; }
  .ack input { margin-top: 0.25rem; }
  .ecu { padding: 0.8rem 0.9rem; gap: 0.5rem; }
  .ident { border-collapse: collapse; width: 100%; }
  .ident td { padding: 0.2rem 0.4rem 0.2rem 0; border-bottom: 1px solid var(--border); }
  .log { max-height: 240px; overflow: auto; padding: 0.7rem; border-radius: 10px; background: #05080e; color: #a5f3fc; display: flex; flex-direction: column; gap: 0.5rem; }
  .log .err { color: #fca5a5; }
  .writebox { border-color: rgba(239, 68, 68, 0.3); }
  .param { padding: 0.7rem 0.9rem; gap: 0.35rem; }
  .jrow { gap: 0.6rem; padding: 0.35rem 0; border-bottom: 1px solid var(--border); }
  label.btn { cursor: pointer; }
</style>
