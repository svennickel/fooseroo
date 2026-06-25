<script lang="ts">
  // Web port of the app's editTimeRequest / edit-outcome dialog: tap a recorded
  // entry to change its person, change its category, or delete it. "Person ändern"
  // rewrites the row (id includes the name); "Kategorie ändern" is in-place
  // (id excludes the mode); both stay byte-compatible with CloudTrainingSync.
  import { changeTrainingPerson, retagTraining, deleteTraining, type EditableEntry } from './trainingstore'
  import { loadTrainingModes, saveTrainingModes, addPlayersToPool, type Ctx } from './data'
  import { t } from './i18n.svelte'
  import ChoicePicker from './ChoicePicker.svelte'

  let { ctx, entry, pool, kindLabel, onClose, onChanged }:
    { ctx: Ctx; entry: EditableEntry; pool: string[]
      kindLabel: (k: string) => string; onClose: () => void; onChanged: () => void } = $props()

  let modes = $state<string[]>([])
  let poolState = $state<string[]>([...pool])
  let picking = $state<'person' | 'mode' | null>(null)
  let confirming = $state(false)
  let busy = $state(false)
  $effect(() => { loadTrainingModes(ctx, entry.kind).then((m) => { modes = m }).catch(() => {}) })

  const valueLabel = entry.kind === 'outcome'
    ? (entry.success ? t('training.hit') : t('training.miss'))
    : `${((entry.elapsedMs ?? 0) / 1000).toFixed(1)}s${entry.kind === 'measure_success' ? (entry.success ? ' ✓' : ' ✗') : ''}`

  async function run(fn: () => Promise<void>) {
    if (busy) return
    busy = true
    try { await fn(); onChanged(); onClose() } catch { busy = false }
  }
  async function pickPerson(name: string) {
    if (!poolState.includes(name)) { poolState = [...poolState, name]; try { poolState = await addPlayersToPool(ctx, [name]) } catch { /* keep */ } }
    run(() => changeTrainingPerson(ctx, entry, name))
  }
  async function pickMode(mode: string) {
    if (!modes.includes(mode)) { modes = [...modes, mode]; try { await saveTrainingModes(ctx, entry.kind, modes) } catch { /* keep */ } }
    run(() => retagTraining(ctx, entry, mode))
  }
</script>

<div class="overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose() }}>
  <div class="sheet">
    <div class="head"><strong>{entry.name || '—'} · {kindLabel(entry.kind)}</strong>
      <span class="val">{valueLabel}</span></div>
    {#if entry.mode}<p class="cat">{t('row.cat_prefix', entry.mode)}</p>{/if}

    <button class="act" onclick={() => (picking = 'person')} disabled={busy}>{t('row.change_person')}</button>
    <button class="act" onclick={() => (picking = 'mode')} disabled={busy}>{t('row.change_cat')}</button>
    <button class="act danger" onclick={() => (confirming = true)} disabled={busy}>{t('row.delete')}</button>
    <button class="ghost" onclick={onClose}>{t('common.cancel')}</button>

    {#if confirming}
      <div class="confirm">
        <p>{t('row.confirm_delete')}</p>
        <div class="cbtns">
          <button class="ghost small" onclick={() => (confirming = false)}>{t('common.cancel')}</button>
          <button class="solid danger" onclick={() => run(() => deleteTraining(ctx, entry))}>{t('common.delete')}</button>
        </div>
      </div>
    {/if}

    {#if picking === 'person'}
      <ChoicePicker title={t('training.person')} items={poolState} selected={entry.name ? [entry.name] : []} maxSelection={1}
        onAdd={() => {}} onPicked={(n) => { if (n[0]) pickPerson(n[0]) }} onClose={() => (picking = null)} />
    {:else if picking === 'mode'}
      <ChoicePicker title={t('training.category')} items={modes} selected={entry.mode ? [entry.mode] : []} maxSelection={1}
        onAdd={() => {}} onPicked={(n) => { if (n[0]) pickMode(n[0]) }} onClose={() => (picking = null)} />
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0 0 var(--navh, 56px) 0; z-index: 950; background: rgba(0,0,0,.5);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; background: var(--bg); border-radius: 18px 18px 0 0;
    display: flex; flex-direction: column; gap: 8px;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .head strong { font-size: 16px; }
  .val { font-weight: 800; white-space: nowrap; }
  .cat { margin: -2px 0 4px; font-size: 13px; color: var(--on-surface-variant); }
  .act { text-align: left; background: var(--surface); border: 1px solid var(--outline); border-radius: 12px;
    padding: 14px; font-size: 15px; font-weight: 600; color: var(--on-surface); cursor: pointer; }
  .act.danger { color: var(--bad); }
  .act:disabled { opacity: .5; cursor: default; }
  .ghost { background: transparent; color: var(--team-a); border: 0; padding: 12px; font-size: 15px;
    font-weight: 700; cursor: pointer; }
  .confirm { background: var(--surface); border: 1px solid var(--outline); border-radius: 12px; padding: 12px; }
  .confirm p { margin: 0 0 8px; font-size: 14px; }
  .cbtns { display: flex; gap: 8px; justify-content: flex-end; }
  .ghost.small { border: 1px solid var(--outline); border-radius: 8px; padding: 7px 12px; font-size: 13px; }
  .solid.danger { background: var(--bad); color: #fff; border: 0; border-radius: 8px; padding: 7px 14px;
    font-size: 13px; font-weight: 700; cursor: pointer; }
</style>
