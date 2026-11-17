<script lang="ts">
  import { onDestroy } from 'svelte';
  import { analyzeAudio, call, errorText } from '../lib/api';
  import { app, go, toast } from '../lib/state.svelte';
  import type { AudioReport, Evidence, LiveValue } from '../lib/types';
  import Icon from '../components/Icon.svelte';

  const TARGET_SR = 24000;
  const MAX_S = 12;

  let mode = $state<'idle' | 'recording' | 'analyzing'>('idle');
  let elapsed = $state(0);
  let level = $state(0);
  let report = $state<AudioReport | null>(null);
  let evidence = $state<Evidence[]>([]);
  let regime = $state<'idle' | '2000' | '3000' | 'unknown' | 'obd'>('idle');
  let cylinders = $state(app.profile?.cylinders ?? 4);
  let source = $state('');
  let spectrumCanvas = $state<HTMLCanvasElement>();
  let envCanvas = $state<HTMLCanvasElement>();

  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let proc: ScriptProcessorNode | null = null;
  let chunks: Float32Array[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const ranges: Record<string, [number, number]> = { idle: [550, 1150], '2000': [1600, 2500], '3000': [2500, 3600], unknown: [500, 4500] };

  async function rpmRange(): Promise<[number, number]> {
    if (regime === 'obd' && app.connection) {
      const r = await call<{ values: LiveValue[] }>('read_live');
      const rpm = r.values.find((v) => v.key === 'rpm')?.value;
      if (rpm && rpm > 300) return [rpm * 0.85, rpm * 1.15];
    }
    return ranges[regime] ?? ranges.unknown;
  }

  async function record() {
    report = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      toast("Micro inaccessible : autorisez l'accès au micro.", 'error');
      return;
    }
    ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    chunks = [];
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let peak = 0;
      for (let i = 0; i < d.length; i += 8) peak = Math.max(peak, Math.abs(d[i]));
      level = peak;
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    mode = 'recording';
    elapsed = 0;
    source = 'Micro';
    timer = setInterval(() => {
      elapsed += 0.1;
      if (elapsed >= MAX_S) stop();
    }, 100);
  }

  async function stop() {
    if (mode !== 'recording' || !ctx) return;
    if (timer) clearInterval(timer);
    proc?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    const sr = ctx.sampleRate;
    await ctx.close();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      all.set(c, o);
      o += c.length;
    }
    const buf = new AudioBuffer({ length: total, numberOfChannels: 1, sampleRate: sr });
    buf.copyToChannel(all, 0);
    await analyze(buf);
  }

  async function upload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    report = null;
    source = file.name;
    try {
      const tmp = new AudioContext();
      const buf = await tmp.decodeAudioData(await file.arrayBuffer());
      await tmp.close();
      await analyze(buf);
    } catch (err) {
      toast(`Fichier illisible : ${errorText(err)}`, 'error');
    }
  }

  /** Mono, resampled to 24 kHz, max 20 s, normalised. */
  async function prepare(buf: AudioBuffer): Promise<Float32Array> {
    const dur = Math.min(buf.duration, 20);
    const off = new OfflineAudioContext(1, Math.ceil(dur * TARGET_SR), TARGET_SR);
    const s = off.createBufferSource();
    s.buffer = buf;
    s.connect(off.destination);
    s.start();
    const out = (await off.startRendering()).getChannelData(0);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    if (peak > 0 && peak < 0.5) for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.5;
    return out;
  }

  async function analyze(buf: AudioBuffer) {
    mode = 'analyzing';
    try {
      const samples = await prepare(buf);
      const [rpm_min, rpm_max] = await rpmRange();
      const r = await analyzeAudio<{ report: AudioReport; evidence: Evidence[] }>(samples, { sample_rate: TARGET_SR, cylinders, rpm_min, rpm_max });
      report = r.report;
      evidence = r.evidence;
      queueMicrotask(draw);
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      mode = 'idle';
    }
  }

  function draw() {
    if (!report) return;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#22d3ee';
    const muted = css.getPropertyValue('--faint').trim() || '#5b667a';
    if (spectrumCanvas) {
      const c = spectrumCanvas, g = c.getContext('2d')!;
      const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
      g.clearRect(0, 0, w, h);
      const vals = report.spectrum_db;
      const max = Math.max(...vals), min = max - 70;
      const bw = w / vals.length;
      const grad = g.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, '#22d3ee');
      grad.addColorStop(1, '#c084fc');
      g.fillStyle = grad;
      vals.forEach((v, i) => {
        const y = Math.max(0, (v - min) / (max - min));
        g.fillRect(i * bw + 1, h - y * h, bw - 2, y * h);
      });
      g.fillStyle = muted;
      g.font = `${10 * devicePixelRatio}px sans-serif`;
      for (const f of [100, 1000, 5000]) {
        const i = report.spectrum_hz.findIndex((x) => x >= f);
        if (i > 0) g.fillText(f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, i * bw, h - 4);
      }
    }
    if (envCanvas) {
      const c = envCanvas, g = c.getContext('2d')!;
      const w = (c.width = c.clientWidth * devicePixelRatio), h = (c.height = c.clientHeight * devicePixelRatio);
      g.clearRect(0, 0, w, h);
      g.strokeStyle = accent;
      g.lineWidth = 1.5 * devicePixelRatio;
      g.beginPath();
      report.envelope.forEach((v, i) => {
        const x = (i / (report!.envelope.length - 1)) * w;
        const y = h - v * h * 0.9;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    }
  }

  function useInQuestionnaire() {
    app.audioEvidence = evidence;
    go('eye');
  }

  onDestroy(() => {
    if (timer) clearInterval(timer);
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close();
  });
</script>

<div class="col">
  <h1>Écouter <span class="grad-text">le moteur</span></h1>
  <p class="muted">
    Un mécanicien expérimenté reconnaît beaucoup de pannes à l'oreille. EasyOBD analyse le son directement sur votre appareil :
    il estime le régime et repère les ratés, couinements, sifflements et claquements. Rien n'est envoyé sur Internet.
  </p>

  <div class="card col">
    <div class="grid-2">
      <label class="field">Régime pendant l'enregistrement
        <select class="input" bind:value={regime}>
          <option value="idle">Ralenti (moteur chaud, sans accélérer)</option>
          <option value="2000">Environ 2 000 tr/min</option>
          <option value="3000">Environ 3 000 tr/min</option>
          <option value="unknown">Je ne sais pas</option>
          {#if app.connection}<option value="obd">Lire le régime via l'adaptateur OBD</option>{/if}
        </select>
      </label>
      <label class="field">Nombre de cylindres
        <input class="input" type="number" min="1" max="12" bind:value={cylinders} />
      </label>
    </div>

    <div class="row">
      {#if mode === 'recording'}
        <button class="btn danger" onclick={stop}><Icon name="stop" size={17} /> Arrêter ({elapsed.toFixed(1)} s)</button>
        <div class="meter grow"><span style="width:{Math.min(100, level * 140)}%"></span></div>
      {:else}
        <button class="btn primary" disabled={mode === 'analyzing'} onclick={record}><Icon name="mic" size={17} /> Enregistrer en direct</button>
        <label class="btn">
          <Icon name="upload" size={17} /> Charger un enregistrement
          <input type="file" accept="audio/*,video/*" hidden onchange={upload} />
        </label>
        {#if mode === 'analyzing'}<span class="row small muted"><span class="spinner"></span> Analyse…</span>{/if}
      {/if}
    </div>
    <ul class="small muted tips">
      <li>Moteur chaud, capot ouvert, téléphone à 30–50 cm du moteur, à l'abri du vent.</li>
      <li>Pour un sifflement de turbo ou de courroie, enregistrez aussi en montant doucement en régime.</li>
      <li>8 à 12 secondes suffisent. Évitez de parler pendant l'enregistrement.</li>
    </ul>
  </div>

  {#if report}
    <div class="card col fade-in">
      <div class="row spread">
        <h2>Résultat</h2>
        <span class="tiny faint">{source} · {report.duration_s} s</span>
      </div>
      <div class="kpis">
        <div><div class="tiny faint">RÉGIME ESTIMÉ</div><div class="big">{report.estimated_rpm ? `${report.estimated_rpm}` : '—'}<small> tr/min</small></div></div>
        <div><div class="tiny faint">RÉGULARITÉ</div><div class="big">{Math.round(report.periodicity * 100)}<small> %</small></div></div>
        <div><div class="tiny faint">INDICE DE RATÉS</div><div class="big">{report.misfire_index != null ? Math.round(report.misfire_index * 100) : '—'}<small>{report.misfire_index != null ? ' %' : ''}</small></div></div>
      </div>
      {#each report.warnings as w}<div class="callout warn small">{w}</div>{/each}

      {#each report.findings as f}
        <div class="card flat col finding">
          <div class="row spread"><strong>{f.title}</strong><span class="pill">Confiance {Math.round(f.confidence * 100)} %</span></div>
          <div class="bar"><span style="width:{f.confidence * 100}%"></span></div>
          <p class="small">{f.explanation}</p>
        </div>
      {:else}
        {#if !report.warnings.length}<div class="callout ok small">Aucune anomalie sonore marquée détectée. Le moteur semble tourner régulièrement.</div>{/if}
      {/each}

      <div class="col">
        <div class="tiny faint">SPECTRE (aigus à droite)</div>
        <canvas class="spec" bind:this={spectrumCanvas}></canvas>
        <div class="tiny faint">ENVELOPPE (rythme des explosions)</div>
        <canvas class="env" bind:this={envCanvas}></canvas>
      </div>

      <div class="row">
        <button class="btn primary" onclick={useInQuestionnaire} disabled={!evidence.length}><Icon name="eye" size={16} /> Ajouter au diagnostic à l'œil</button>
      </div>
      <p class="tiny faint">Analyse heuristique : elle oriente, elle ne remplace pas un contrôle. La qualité du micro et le bruit ambiant influencent le résultat.</p>
    </div>
  {/if}
</div>

<style>
  .meter { height: 10px; border-radius: 99px; background: var(--panel-2); overflow: hidden; }
  .meter span { display: block; height: 100%; background: var(--grad); transition: width 0.1s; }
  .tips { display: flex; flex-direction: column; gap: 0.2rem; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.6rem; }
  .kpis > div { padding: 0.75rem; border-radius: 12px; background: var(--panel-2); border: 1px solid var(--border); }
  .big { font-size: 1.6rem; font-weight: 800; }
  .big small { font-size: 0.8rem; color: var(--muted); font-weight: 600; }
  .finding { padding: 0.8rem 0.9rem; gap: 0.5rem; }
  canvas { width: 100%; border-radius: 10px; background: var(--panel-2); border: 1px solid var(--border); }
  .spec { height: 140px; }
  .env { height: 70px; }
  label.btn { cursor: pointer; }
  @media (max-width: 520px) { .kpis { grid-template-columns: 1fr; } }
</style>
