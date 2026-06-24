<script lang="ts">
  import { t } from './i18n.svelte'
  // Bottom-sheet chip picker — web port of the app's ChoicePicker. Single-select
  // (maxSelection=1) picks & closes on a tap; multi-select toggles chips and a
  // "Fertig" button confirms (exceeding the cap drops the oldest). The current
  // selection is pre-checked, but in multi-select the FIRST tap restarts the
  // selection (so a tap means "the team is now this", not "add to it"). Entries
  // with a count show it, are bold and sorted to the front. New entries can be
  // added behind a "+".
  let { title, items, selected = [], maxSelection = 1, counts = {}, allowAdd = true,
        suffixes = {}, onPicked, onAdd, onEdit, onClose }:
    { title: string; items: string[]; selected?: string[]; maxSelection?: number
      counts?: Record<string, number>; allowAdd?: boolean; suffixes?: Record<string, string>
      onPicked: (names: string[]) => void; onAdd?: (name: string) => void
      onEdit?: (item: string) => void; onClose: () => void } = $props()

  let pool = $state<string[]>([...items])
  let checked = $state<string[]>(selected.filter((s) => items.includes(s)))
  let fresh = true                          // first tap restarts the (multi) selection
  let adding = $state(false)
  let newName = $state('')

  // Alphabetical, with active-on-the-day entries pulled to the front.
  const display = $derived([...pool]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .sort((a, b) => (((counts[b] ?? 0) > 0 ? 1 : 0) - ((counts[a] ?? 0) > 0 ? 1 : 0))))

  function tap(item: string) {
    if (maxSelection === 1) { onPicked([item]); onClose(); return }
    if (fresh) { checked = [item]; fresh = false; return }
    if (checked.includes(item)) checked = checked.filter((c) => c !== item)
    else { checked = [...checked, item]; if (checked.length > maxSelection) checked = checked.slice(1) }
  }
  function commitAdd() {
    const t = newName.trim()
    adding = false; newName = ''
    if (!t) return
    if (!pool.includes(t)) pool = [...pool, t]
    onAdd?.(t)
    if (maxSelection === 1) { onPicked([t]); onClose(); return }
    if (fresh) { checked = []; fresh = false }
    if (!checked.includes(t)) { checked = [...checked, t]; if (checked.length > maxSelection) checked = checked.slice(1) }
  }
</script>

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
  <div class="sheet">
    <div class="head">
      <strong>{title}</strong>
      {#if maxSelection > 1}<button class="ghost small" onclick={() => { onPicked(checked); onClose() }}>{t('common.done')}</button>{/if}
    </div>
    <div class="chips">
      {#each display as item (item)}
        <span class="chipwrap">
          <button class="chip" class:on={checked.includes(item)} class:hot={(counts[item] ?? 0) > 0} onclick={() => tap(item)}>
            {item}{#if (counts[item] ?? 0) > 0} ({counts[item]}){/if}{#if suffixes[item]}<span class="sfx">{suffixes[item]}</span>{/if}
          </button>
          {#if onEdit}<button class="edit" aria-label="Bearbeiten" onclick={() => onEdit(item)}>✎</button>{/if}
        </span>
      {/each}
      {#if allowAdd}
        {#if adding}
          <!-- svelte-ignore a11y_autofocus -->
          <input class="addin" bind:value={newName} placeholder={t('common.add')} autofocus
                 onkeydown={(e) => { if (e.key === 'Enter') commitAdd() }} onblur={commitAdd} />
        {:else}
          <button class="chip add" onclick={() => (adding = true)} aria-label="Hinzufügen">＋</button>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 960; background: rgba(0,0,0,.45);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; max-height: 80vh; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); gap: 12px; overflow-y: auto; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .head strong { font-size: 16px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chipwrap { display: inline-flex; align-items: center; gap: 2px; }
  .sfx { color: var(--on-surface-variant); font-weight: 400; font-size: 12px; margin-left: 4px; }
  .edit { background: transparent; border: 1px solid var(--outline); border-radius: 999px;
    width: 30px; height: 30px; font-size: 13px; color: var(--on-surface-variant); cursor: pointer; padding: 0; }
  .chip { background: var(--surface); border: 1px solid var(--outline); border-radius: 999px;
    padding: 9px 14px; font-size: 14px; color: var(--on-surface); cursor: pointer; }
  .chip.hot { font-weight: 800; }
  .chip.on { background: color-mix(in srgb, var(--team-a) 18%, transparent);
    border-color: var(--team-a); color: var(--team-a); font-weight: 700; }
  .chip.add { font-weight: 800; color: var(--team-a); }
  .addin { border: 1px solid var(--team-a); border-radius: 999px; padding: 9px 14px;
    font-size: 14px; background: var(--bg); color: var(--on-surface); min-width: 140px; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 8px; padding: 6px 11px; font-size: 13px; font-weight: 700; cursor: pointer; }
</style>
