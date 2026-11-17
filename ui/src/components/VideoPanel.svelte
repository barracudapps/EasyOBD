<script lang="ts">
  // Repair videos: pre-filled YouTube search, embedded player (privacy-enhanced youtube-nocookie.com),
  // favourites per topic, and optional in-app search with the user's own YouTube Data API key.
  import { openUrl } from '../lib/api';
  import { toast } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  let { query, topic }: { query: string; topic: string } = $props();

  type Video = { id: string; title: string; channel?: string; thumb?: string };
  const favKey = $derived(`easyobd.videos.${topic}`);
  let favs = $state<Video[]>([]);
  let current = $state<Video | null>(null);
  let link = $state('');
  let q = $state('');
  let results = $state<Video[]>([]);
  let searching = $state(false);
  let apiKey = $state(read('easyobd.ytkey') ?? '');

  function read(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  }
  function write(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  }

  $effect(() => {
    q = query;
    try {
      favs = JSON.parse(read(favKey) ?? '[]');
    } catch {
      favs = [];
    }
    current = null;
    results = [];
  });

  function parseId(url: string): string | null {
    const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/) ?? url.match(/^([\w-]{11})$/);
    return m ? m[1] : null;
  }

  function play() {
    const id = parseId(link.trim());
    if (!id) {
      toast('Lien YouTube non reconnu.', 'error');
      return;
    }
    current = { id, title: 'Vidéo' };
    link = '';
  }

  function toggleFav(v: Video) {
    favs = favs.some((f) => f.id === v.id) ? favs.filter((f) => f.id !== v.id) : [...favs, v];
    write(favKey, JSON.stringify(favs));
  }

  async function search() {
    if (!apiKey) {
      openUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`);
      return;
    }
    searching = true;
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&relevanceLanguage=fr&q=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`YouTube a répondu ${r.status} (clé invalide ou quota dépassé ?)`);
      const data = await r.json();
      results = (data.items ?? []).map((it: { id: { videoId: string }; snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string } } } }) => ({
        id: it.id.videoId,
        title: it.snippet.title.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
        channel: it.snippet.channelTitle,
        thumb: it.snippet.thumbnails.medium?.url,
      }));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      searching = false;
    }
  }
</script>

<div class="col vp">
  <div class="row">
    <input class="input grow" bind:value={q} aria-label="Recherche vidéo" />
    <button class="btn primary sm" onclick={search} disabled={searching}>
      {#if searching}<span class="spinner"></span>{:else}<Icon name="search" size={15} />{/if}
      {apiKey ? 'Chercher' : 'Chercher sur YouTube'}
    </button>
  </div>

  {#if current}
    <div class="player fade-in">
      <iframe
        src="https://www.youtube-nocookie.com/embed/{current.id}?rel=0&modestbranding=1"
        title={current.title}
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    </div>
    <div class="row spread">
      <span class="small">{current.title}</span>
      <div class="row">
        <button class="btn sm ghost" onclick={() => toggleFav(current!)}><Icon name="star" size={14} /> {favs.some((f) => f.id === current!.id) ? 'Retirer' : 'Garder'}</button>
        <button class="btn sm ghost" onclick={() => openUrl(`https://www.youtube.com/watch?v=${current!.id}`)}><Icon name="external" size={14} /></button>
        <button class="btn sm ghost" aria-label="Fermer la vidéo" onclick={() => (current = null)}><Icon name="x" size={14} /></button>
      </div>
    </div>
  {/if}

  {#if results.length}
    <div class="grid-vids">
      {#each results as v}
        <button class="vid" onclick={() => (current = v)}>
          {#if v.thumb}<img src={v.thumb} alt="" loading="lazy" />{/if}
          <span class="tiny">{v.title}</span>
          <span class="tiny faint">{v.channel}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if favs.length}
    <div class="tiny faint upper">Mes vidéos pour ce sujet</div>
    <div class="row">
      {#each favs as f}<button class="btn sm" onclick={() => (current = f)}><Icon name="star" size={13} /> {f.title.slice(0, 40)}</button>{/each}
    </div>
  {/if}

  <div class="row">
    <input class="input grow" bind:value={link} placeholder="Coller un lien YouTube pour le regarder ici" />
    <button class="btn sm" onclick={play} disabled={!link.trim()}>Lire</button>
  </div>

  <details class="tiny muted">
    <summary>Recherche dans l'application (optionnel)</summary>
    <p style="margin:0.4rem 0">
      YouTube ne permet pas d'intégrer une page de résultats. Avec votre propre clé API YouTube Data (gratuite, console Google Cloud),
      les résultats s'affichent ici. La clé reste sur cet appareil.
    </p>
    <div class="row">
      <input class="input grow mono" type="password" bind:value={apiKey} placeholder="Clé API YouTube Data v3" />
      <button class="btn sm" onclick={() => { write('easyobd.ytkey', apiKey.trim()); toast('Clé enregistrée sur cet appareil', 'ok'); }}>Enregistrer</button>
    </div>
  </details>
  <p class="tiny faint">Les vidéos sont proposées par des tiers : vérifiez qu'elles correspondent à votre modèle et appliquez les consignes de sécurité.</p>
</div>

<style>
  .vp { gap: 0.6rem; }
  .player { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: #000; }
  .player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .grid-vids { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; }
  .vid { display: flex; flex-direction: column; gap: 0.25rem; text-align: left; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 0.4rem; cursor: pointer; color: inherit; }
  .vid:hover { border-color: var(--accent); }
  .vid img { width: 100%; border-radius: 6px; aspect-ratio: 16 / 9; object-fit: cover; }
  .upper { text-transform: uppercase; letter-spacing: 0.07em; font-weight: 700; }
  summary { cursor: pointer; }
</style>
