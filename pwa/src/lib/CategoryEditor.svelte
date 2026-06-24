<script lang="ts">
  // Match-category editor (web port of the app's category editor): add, rename
  // (also moves the matches), reorder, delete (reassigning its matches to another
  // category). Persists to app_config via saveCategories + reassignCategory.
  import { saveCategories, reassignCategory, type Ctx } from './data'
  import { t } from './i18n.svelte'

  let { ctx, categories, defaultCategory, onClose, onChanged }:
    { ctx: Ctx; categories: string[]; defaultCategory: string
      onClose: () => void; onChanged: () => void } = $props()

  let list = $state<string[]>([...categories])
  let adding = $state('')
  let editIdx = $state<number | null>(null)
  let editVal = $state('')
  let delIdx = $state<number | null>(null)   // index pending delete (asks for a target)
  let delTarget = $state('')
  let busy = $state(false)
  let err = $state('')

  async function run(fn: () => Promise<void>) {
    if (busy) return
    busy = true; err = ''
    try { await fn(); onChanged() } catch { err = t('ce.action_failed') } finally { busy = false }
  }

  function add() {
    const v = adding.trim()
    if (!v || list.includes(v)) { adding = ''; return }
    const next = [...list, v]; list = next; adding = ''
    run(() => saveCategories(ctx, next))
  }
  function startRename(i: number) { editIdx = i; editVal = list[i] }
  function saveRename(i: number) {
    const v = editVal.trim(); const from = list[i]
    if (!v || v === from) { editIdx = null; return }
    if (list.includes(v)) { err = t('ce.exists'); return }
    const next = list.map((c, k) => (k === i ? v : c)); list = next; editIdx = null
    // Move matches to the new name, then persist the renamed list.
    run(async () => { await reassignCategory(ctx, from, v); await saveCategories(ctx, next) })
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const next = [...list]; ;[next[i], next[j]] = [next[j], next[i]]; list = next
    run(() => saveCategories(ctx, next))
  }
  function askDelete(i: number) {
    delIdx = i
    delTarget = list.find((_, k) => k !== i) ?? defaultCategory
  }
  function confirmDelete() {
    if (delIdx == null) return
    const cat = list[delIdx]; const target = delTarget
    const next = list.filter((_, k) => k !== delIdx); list = next; delIdx = null
    // Reassign this category's matches to the target, then persist the shorter list.
    run(async () => { await reassignCategory(ctx, cat, target); await saveCategories(ctx, next) })
  }
</script>

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }} role="presentation">
  <div class="sheet">
    <div class="head"><strong>{t('ce.head')}</strong><button class="ghost small" onclick={onClose}>{t('common.close')}</button></div>
    {#if err}<p class="err">{err}</p>{/if}
    <div class="scroll">
      {#each list as c, i (c + i)}
        <div class="row">
          {#if editIdx === i}
            <input bind:value={editVal} onkeydown={(e) => { if (e.key === 'Enter') saveRename(i) }} />
            <button class="ghost small" onclick={() => saveRename(i)} disabled={busy}>OK</button>
            <button class="ghost small" onclick={() => (editIdx = null)}>×</button>
          {:else if delIdx === i}
            <span class="nm">{t('ce.delete_to', c)}</span>
            <select bind:value={delTarget}>
              {#each list.filter((_, k) => k !== i) as cat}<option value={cat}>{cat}</option>{/each}
            </select>
            <button class="danger small" onclick={confirmDelete} disabled={busy}>{t('common.delete')}</button>
            <button class="ghost small" onclick={() => (delIdx = null)}>×</button>
          {:else}
            <span class="nm">{c}</span>
            <div class="ctl">
              <button class="ic" onclick={() => move(i, -1)} disabled={busy || i === 0} aria-label={t('a11y.up')}>▲</button>
              <button class="ic" onclick={() => move(i, 1)} disabled={busy || i === list.length - 1} aria-label={t('a11y.down')}>▼</button>
              <button class="ghost small" onclick={() => startRename(i)} disabled={busy}>{t('ce.rename')}</button>
              {#if list.length > 1}<button class="ic del" onclick={() => askDelete(i)} disabled={busy} aria-label={t('common.delete')}>🗑</button>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="addrow">
      <input bind:value={adding} placeholder={t('ce.new_ph')} onkeydown={(e) => { if (e.key === 'Enter') add() }} />
      <button class="primary" onclick={add} disabled={busy || !adding.trim()}>{t('common.add')}</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 960; background: rgba(0,0,0,.45);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; max-height: 88vh; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column; gap: 10px;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .head strong { font-size: 17px; }
  .scroll { overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 8px; background: var(--surface);
    border: 1px solid var(--outline); border-radius: 12px; padding: 8px 12px; }
  .nm { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ctl { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .addrow { display: flex; gap: 8px; }
  input { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--outline);
    background: var(--surface); color: var(--on-surface); font-size: 15px; }
  select { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--outline);
    background: var(--surface); color: var(--on-surface); font-size: 14px; }
  .err { color: var(--bad); font-size: 13px; margin: 0; }
  .ic { background: transparent; border: 1px solid var(--outline); border-radius: 8px;
    padding: 6px 9px; font-size: 12px; color: var(--on-surface-variant); cursor: pointer; }
  .ic.del { border-color: var(--bad); color: var(--bad); }
  .ic:disabled { opacity: .4; cursor: default; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .danger.small { background: transparent; color: var(--bad); border: 1px solid var(--bad);
    border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .primary { background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 10px;
    padding: 10px 14px; font-size: 14px; font-weight: 700; cursor: pointer; }
  .primary:disabled, .ghost.small:disabled, .danger.small:disabled { opacity: .5; cursor: default; }
</style>
