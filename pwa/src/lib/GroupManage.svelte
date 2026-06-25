<script lang="ts">
  // Owner/moderator management of one Trainingsgruppe — the web port of the app's
  // GroupManageFragment: member roster with role/access controls + remove, the join
  // code + its settings, result retention (owner) and group deletion (owner, with a
  // typed confirmation). Plain members get a read-only roster (names + roles).
  import {
    groupMembers, groupSettings, setMemberRole, setMemberAccess, removeMember,
    regenerateJoinCode, configureJoin, setResultRetention, deleteGroup, transferOwnership,
    type Member, type GroupSettings
  } from './data'
  import { t, getLang } from './i18n.svelte'

  let { groupId, groupName, myUserId, onClose, onChanged }:
    { groupId: string; groupName: string; myUserId: string | null;
      onClose: () => void; onChanged: () => void } = $props()

  let members = $state<Member[]>([])
  let settings = $state<GroupSettings | null>(null)
  let loading = $state(true)
  let busy = $state(false)
  let err = $state('')
  let delConfirm = $state('')   // typed group name to enable deletion
  let delStep = $state(0)       // 0 none · 1 first "are you sure" · 2 type-the-name
  let transferTarget = $state<Member | null>(null)  // member being promoted to owner
  let transferConfirm = $state('')                  // typed group name to confirm transfer
  let retDays = $state('')      // retention input (empty = off)
  let askRetention = $state(false)   // confirm before enabling auto-delete (irreversible)

  // Join-code validity: a code is shown only while present AND not past its expiry;
  // otherwise we offer to generate a fresh one.
  const codeExpired = $derived(!!settings?.joinExpiresAt && Date.parse(settings.joinExpiresAt) <= Date.now())
  const haveCode = $derived(!!settings?.joinCode && !codeExpired)
  const retNum = $derived(retDays.trim() === '' ? null : (Math.max(1, parseInt(retDays, 10) || 0) || null))
  let copied = $state(false)
  async function copyCode(c: string) {
    try { await navigator.clipboard.writeText(c); copied = true; setTimeout(() => (copied = false), 1500) } catch { /* ignore */ }
  }
  function fmtDateTime(iso: string): string {
    try { return new Date(iso).toLocaleString(getLang() === 'en' ? 'en-GB' : 'de-DE',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    catch { return iso }
  }

  const myRole = $derived(members.find((m) => m.userId === myUserId)?.role ?? 'member')
  const isOwner = $derived(myRole === 'owner')
  const isManager = $derived(myRole === 'owner' || myRole === 'moderator')

  async function load() {
    loading = true; err = ''
    try {
      members = await groupMembers(groupId)
      settings = await groupSettings(groupId)
      retDays = settings?.retentionDays != null ? String(settings.retentionDays) : ''
    } catch { err = t('gm.load_failed') }
    finally { loading = false }
  }
  $effect(() => { load() })

  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } })()
  const roleLabel = (r: string) => r === 'owner' ? t('acc.owner') : r === 'moderator' ? t('gm.moderator') : t('gm.member')

  async function run(fn: () => Promise<void>) {
    if (busy) return
    busy = true; err = ''
    try { await fn(); await load() } catch { err = t('ce.action_failed') } finally { busy = false }
  }
  const changeRole = (m: Member, role: string) => run(() => setMemberRole(groupId, m.userId, role))
  const changeAccess = (m: Member, access: string) => run(() => setMemberAccess(groupId, m.userId, access))
  const kick = (m: Member) => run(() => removeMember(groupId, m.userId))
  const regen = () => run(async () => { await regenerateJoinCode(groupId) })
  // p_unlimited=true: the web keeps codes non-expiring (the app sets validity).
  const toggleEnabled = () => run(() => configureJoin(groupId, !(settings?.joinEnabled ?? true), true, settings?.joinDefaultAccess ?? 'write'))
  const setDefaultAccess = (a: string) => run(() => configureJoin(groupId, settings?.joinEnabled ?? true, true, a))
  const saveRetention = () => run(() => {
    const v = retDays.trim() === '' ? null : Math.max(1, parseInt(retDays, 10) || 0) || null
    return setResultRetention(groupId, v, v == null ? null : tz)
  })
  // Turning auto-delete OFF can't delete anything → save straight away. Enabling (or
  // keeping) a positive cutoff DOES purge older results → confirm first (irreversible).
  function onSaveRetention() { if (retNum == null) saveRetention(); else askRetention = true }
  function confirmRetention() { askRetention = false; saveRetention() }
  async function doDelete() {
    if (busy || delConfirm.trim() !== groupName.trim()) return
    busy = true; err = ''
    try { await deleteGroup(groupId); onChanged(); onClose() }
    catch { err = t('gm.delete_failed'); busy = false }
  }
  // Hand over ownership (typed-name confirm). On success the roster reloads and my own
  // role flips to moderator, so the management controls update themselves.
  async function doTransfer() {
    const target = transferTarget
    if (!target || transferConfirm.trim() !== groupName.trim()) return
    await run(() => transferOwnership(groupId, target.userId))
    transferTarget = null; transferConfirm = ''
  }
</script>

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
  <div class="sheet">
    <div class="head">
      <strong>{groupName} · {t('acc.manage')}</strong>
      <button class="ghost small" onclick={onClose}>{t('common.close')}</button>
    </div>

    {#if loading}
      <p class="hint">{t('common.loading')}</p>
    {:else}
      <div class="scroll">
        {#if err}<p class="err">{err}</p>{/if}

        <!-- Join code (managers) -->
        {#if isManager && settings}
          <div class="sec">
            <div class="slabel">{t('gm.join_code')}</div>
            {#if haveCode}
              <div class="coderow">
                <code class="code">{settings.joinCode}</code>
                <button class="iconbtn" onclick={() => copyCode(settings?.joinCode ?? '')} aria-label={t('gm.copy')} title={t('gm.copy')}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
                </button>
                {#if copied}<span class="copied">{t('gm.copied')}</span>{/if}
                <button class="ghost small" onclick={regen} disabled={busy}>{t('gm.regen')}</button>
              </div>
              {#if settings.joinExpiresAt}
                <p class="hint">{t('gm.code_valid_until', fmtDateTime(settings.joinExpiresAt))}</p>
              {/if}
            {:else}
              <p class="hint warn">{t('gm.code_invalid')}</p>
              <button class="ghost small" onclick={regen} disabled={busy}>{t('gm.code_generate')}</button>
            {/if}
            <label class="chk">
              <span class="chktxt">{t('gm.join_enabled')}</span>
              <span class="sw"><input type="checkbox" checked={settings.joinEnabled} onchange={toggleEnabled} disabled={busy} /><span class="slider"></span></span>
            </label>
            <div class="arow">
              <span>{t('gm.default_access')}</span>
              <select value={settings.joinDefaultAccess} onchange={(e) => setDefaultAccess((e.currentTarget as HTMLSelectElement).value)} disabled={busy}>
                <option value="write">{t('gm.write')}</option>
                <option value="read">{t('gm.read')}</option>
              </select>
            </div>
          </div>
        {/if}

        <!-- Members -->
        <div class="sec">
          <div class="slabel">{t('gm.members', members.length)}</div>
          {#each members as m (m.userId)}
            <div class="mrow">
              <div class="minfo">
                <div class="mname">{m.name || t('gm.no_name')}{#if m.userId === myUserId} <span class="you">{t('gm.you')}</span>{/if}</div>
                {#if m.email}<div class="memail">{m.email}</div>{/if}
              </div>
              {#if isManager && m.role !== 'owner' && m.userId !== myUserId}
                <div class="mctl">
                  <select value={m.role} onchange={(e) => changeRole(m, (e.currentTarget as HTMLSelectElement).value)} disabled={busy}>
                    <option value="member">{t('gm.member')}</option>
                    <option value="moderator">{t('gm.moderator')}</option>
                  </select>
                  <select value={m.access} onchange={(e) => changeAccess(m, (e.currentTarget as HTMLSelectElement).value)} disabled={busy}>
                    <option value="write">{t('gm.write')}</option>
                    <option value="read">{t('gm.read')}</option>
                  </select>
                  <button class="ghost small" onclick={() => kick(m)} disabled={busy}>{t('gm.remove')}</button>
                  {#if isOwner}<button class="ghost small" onclick={() => { transferTarget = m; transferConfirm = '' }} disabled={busy}>{t('gm.make_owner')}</button>{/if}
                </div>
              {:else}
                <span class="rtag">{roleLabel(m.role)}</span>
              {/if}
            </div>
          {/each}
          {#if transferTarget}
            <div class="confirmbox">
              <p class="hint warn">{t('gm.transfer_confirm', transferTarget.name || t('gm.no_name'))}</p>
              <input class="num wide" bind:value={transferConfirm} placeholder={groupName} />
              <div class="arow">
                <button class="danger small" onclick={doTransfer} disabled={busy || transferConfirm.trim() !== groupName.trim()}>{t('gm.transfer_final')}</button>
                <button class="ghost small" onclick={() => { transferTarget = null; transferConfirm = '' }} disabled={busy}>{t('common.cancel')}</button>
              </div>
            </div>
          {/if}
        </div>

        <!-- Retention (owner) -->
        {#if isOwner}
          <div class="sec">
            <div class="slabel">{t('gm.retention_title')}</div>
            <p class="hint">{t('gm.retention_hint')}</p>
            <div class="arow">
              <input class="num" inputmode="numeric" bind:value={retDays} placeholder={t('gm.off')} disabled={askRetention} />
              <button class="ghost small" onclick={onSaveRetention} disabled={busy || askRetention}>{t('common.save')}</button>
            </div>
            {#if askRetention && retNum != null}
              <p class="hint warn">{t('gm.retention_confirm', retNum)}</p>
              <div class="arow">
                <button class="danger small" onclick={confirmRetention} disabled={busy}>{t('gm.retention_save')}</button>
                <button class="ghost small" onclick={() => (askRetention = false)} disabled={busy}>{t('common.cancel')}</button>
              </div>
            {/if}
          </div>

          <!-- Danger zone -->
          <div class="sec danger">
            <div class="slabel">{t('gm.danger_zone')}</div>
            {#if delStep === 0}
              <button class="danger small" onclick={() => { delStep = 1; delConfirm = '' }}>{t('gm.delete_group')}</button>
            {:else if delStep === 1}
              <p class="hint warn">{t('gm.delete_confirm1')}</p>
              <div class="arow">
                <button class="danger small" onclick={() => (delStep = 2)}>{t('gm.delete_continue')}</button>
                <button class="ghost small" onclick={() => (delStep = 0)}>{t('common.cancel')}</button>
              </div>
            {:else}
              <p class="hint">{t('gm.delete_warn_pre')}<strong>{groupName}</strong>{t('gm.delete_warn_post')}</p>
              <input class="num wide" bind:value={delConfirm} placeholder={groupName} />
              <div class="arow">
                <button class="danger small" onclick={doDelete} disabled={busy || delConfirm.trim() !== groupName.trim()}>{t('gm.delete_final')}</button>
                <button class="ghost small" onclick={() => { delStep = 0; delConfirm = '' }}>{t('common.cancel')}</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0 0 var(--navh, 56px) 0; z-index: 950; background: rgba(0,0,0,.45);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; max-height: 90vh; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); gap: 10px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .head strong { font-size: 16px; }
  .scroll { overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .sec { background: var(--surface); border: 1px solid var(--outline); border-radius: 14px;
    padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  .sec.danger { border-color: var(--bad); }
  .slabel { font-weight: 800; font-size: 13px; color: var(--on-surface-variant);
    text-transform: uppercase; letter-spacing: .04em; }
  .coderow { display: flex; align-items: center; gap: 10px; }
  .code { font-size: 20px; font-weight: 800; letter-spacing: .12em; color: var(--team-a); }
  .iconbtn { background: transparent; border: 0; cursor: pointer; color: var(--on-surface-variant);
    width: 34px; height: 34px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; }
  .iconbtn:active { background: var(--surface-variant); }
  .iconbtn svg { width: 20px; height: 20px; }
  .copied { font-size: 12px; font-weight: 700; color: var(--ok); }
  .chk { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; }
  /* iOS-style toggle switch (instead of a raw checkbox) */
  .sw { position: relative; width: 46px; height: 28px; flex: 0 0 auto; }
  .sw input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .sw .slider { position: absolute; inset: 0; background: var(--outline); border-radius: 999px; transition: background .2s; }
  .sw .slider::before { content: ''; position: absolute; width: 24px; height: 24px; left: 2px; top: 2px;
    background: #fff; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .2s; }
  .sw input:checked + .slider { background: var(--ok); }
  .sw input:checked + .slider::before { transform: translateX(18px); }
  .sw input:disabled + .slider { opacity: .5; }
  .arow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; }
  .mrow { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    border-top: 1px solid var(--outline); padding-top: 8px; }
  .mrow:first-of-type { border-top: 0; padding-top: 0; }
  .minfo { min-width: 0; }
  .mname { font-weight: 600; font-size: 14px; }
  .you { color: var(--on-surface-variant); font-weight: 400; }
  .memail { color: var(--on-surface-variant); font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .mctl { display: flex; align-items: center; gap: 6px; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
  .rtag { font-size: 12px; font-weight: 600; background: var(--surface-variant);
    color: var(--on-surface-variant); padding: 2px 8px; border-radius: 8px; flex-shrink: 0; }
  select, input { padding: 7px 10px; border-radius: 8px; border: 1px solid var(--outline);
    background: var(--bg); color: var(--on-surface); font-size: 13px; }
  .num { width: 90px; } .num.wide { width: 100%; box-sizing: border-box; }
  .hint { color: var(--on-surface-variant); font-size: 12px; margin: 0; }
  .hint.warn { color: var(--warn); font-weight: 600; }
  .confirmbox { border-top: 1px solid var(--outline); padding-top: 10px;
    display: flex; flex-direction: column; gap: 8px; }
  .err { color: var(--bad); font-size: 13px; margin: 0; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 8px; padding: 6px 11px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .danger.small { background: transparent; color: var(--bad); border: 1px solid var(--bad);
    border-radius: 8px; padding: 6px 11px; font-size: 13px; font-weight: 700; cursor: pointer; align-self: flex-start; }
  .ghost.small:disabled, .danger.small:disabled { opacity: .5; cursor: default; }
</style>
