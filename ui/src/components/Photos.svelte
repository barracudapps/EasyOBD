<script lang="ts">
  // Reference photos for the given components + the user's own photos for this context.
  import { onDestroy, untrack } from 'svelte';
  import { addUserPhoto, deleteUserPhoto, photoUrl, referencePhotos, userPhotos, type RefPhoto, type UserPhoto } from '../lib/photos';
  import { toast } from '../lib/state.svelte';
  import Icon from './Icon.svelte';

  let { components = [], userKey, compact = false }: { components?: string[]; userKey?: string; compact?: boolean } = $props();

  let refs = $state<RefPhoto[]>([]);
  let mine = $state<(UserPhoto & { url: string })[]>([]);
  let zoom = $state<{ url: string; caption: string } | null>(null);
  let busy = $state(false);

  function revoke() {
    mine.forEach((m) => URL.revokeObjectURL(m.url));
  }

  async function loadMine() {
    revoke();
    mine = userKey ? (await userPhotos(userKey)).map((p) => ({ ...p, url: URL.createObjectURL(p.blob) })) : [];
  }

  $effect(() => {
    const ids = [...components];
    const key = userKey;
    // untrack: loading reads/writes `mine`, which must not re-trigger this effect (infinite loop).
    untrack(() => {
      void key;
      referencePhotos(ids).then((r) => (refs = r));
      loadMine();
    });
  });
  onDestroy(revoke);

  async function add(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !userKey) return;
    busy = true;
    try {
      await addUserPhoto(userKey, file);
      await loadMine();
      toast('Photo enregistrée sur cet appareil', 'ok');
    } catch (err) {
      toast(`Photo non enregistrée : ${(err as Error).message}`, 'error');
    } finally {
      busy = false;
    }
  }

  async function remove(id: string) {
    await deleteUserPhoto(id);
    await loadMine();
  }
</script>

{#if refs.length || userKey}
  <div class="photos" class:compact>
    {#each refs as p}
      <figure>
        <button class="thumb" onclick={() => (zoom = { url: photoUrl(p), caption: `${p.alt} — ${p.credit}, ${p.license}` })}>
          <img src={photoUrl(p)} alt={p.alt} loading="lazy" />
        </button>
        {#if !compact}<figcaption class="tiny faint"><a href={p.source} target="_blank" rel="noopener">{p.credit}</a> · {p.license}</figcaption>{/if}
      </figure>
    {/each}
    {#each mine as m}
      <figure>
        <button class="thumb mine" onclick={() => (zoom = { url: m.url, caption: 'Ma photo' })}><img src={m.url} alt="Prise par moi" /></button>
        {#if !compact}<button class="del tiny" onclick={() => remove(m.id)} aria-label="Supprimer la photo"><Icon name="trash" size={12} /></button>{/if}
      </figure>
    {/each}
    {#if userKey}
      <label class="thumb add" title="Ajouter ma photo (stockée sur cet appareil)">
        {#if busy}<span class="spinner"></span>{:else}<Icon name="upload" size={18} /><span class="tiny">Ma photo</span>{/if}
        <input type="file" accept="image/*" capture="environment" hidden onchange={add} />
      </label>
    {/if}
  </div>
{/if}

{#if zoom}
  <div class="lightbox" role="presentation" onclick={() => (zoom = null)}>
    <img src={zoom.url} alt={zoom.caption} />
    <div class="small cap">{zoom.caption}</div>
  </div>
{/if}

<style>
  .photos { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  figure { margin: 0; display: flex; flex-direction: column; gap: 0.2rem; position: relative; max-width: 132px; }
  .thumb { width: 132px; height: 96px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border-2); background: var(--panel-2); padding: 0; cursor: zoom-in; display: grid; place-items: center; }
  .compact .thumb { width: 84px; height: 62px; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .thumb.mine { border-color: color-mix(in srgb, var(--accent) 50%, transparent); }
  .add { cursor: pointer; flex-direction: column; gap: 0.2rem; color: var(--muted); border-style: dashed; display: flex; align-items: center; justify-content: center; }
  .add:hover { color: var(--accent); border-color: var(--accent); }
  .del { position: absolute; top: 4px; right: 4px; border: none; border-radius: 6px; background: rgba(0, 0, 0, 0.6); color: #fff; padding: 3px; cursor: pointer; }
  figcaption a { color: inherit; }
  .lightbox { position: fixed; inset: 0; z-index: 80; background: rgba(2, 6, 15, 0.88); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; padding: 1rem; cursor: zoom-out; }
  .lightbox img { max-width: 100%; max-height: 82vh; border-radius: 12px; }
  .cap { color: #cbd5e1; text-align: center; }
</style>
