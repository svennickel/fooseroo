<script lang="ts">
  // "Konto & Sync" dialog, mirroring the app. Backup & Sync: inline email-OTP when
  // signed out, e-mail + sign-out when signed in. Trainingsgruppe: join-by-code PLUS
  // per-group management like the app — set my display name + leave (with a
  // confirmation). Full owner admin (members/roles/rename/delete) stays in the app.
  import { requestCode, verifyCode } from './auth'
  import { supabase } from './supabase'
  import { myGroupName, setGroupDisplayName, leaveGroup, createGroup, type Group } from './data'
  import { t } from './i18n.svelte'
  import GroupManage from './GroupManage.svelte'

  let manageGroup = $state<Group | null>(null)

  let { signedIn, userEmail, groups, myUserId, onClose, onJoin, onGroupsChanged }:
    { signedIn: boolean; userEmail: string | null; groups: Group[]; myUserId: string | null;
      onClose: () => void; onJoin: () => void; onGroupsChanged: () => void } = $props()

  let step = $state<'idle' | 'email' | 'code'>('idle')
  let email = $state('')
  let code = $state('')
  let busy = $state(false)
  let err = $state('')
  let confirmOut = $state(false)
  let showBenefits = $state(false)   // "Was bringt mir das?" expander

  // Per-group UI state, keyed by group id.
  let names = $state<Record<string, string | null>>({})   // my display name in each group
  let editing = $state<string | null>(null)               // group whose name is being edited
  let nameDraft = $state('')
  let gMsg = $state<Record<string, string>>({})            // soft per-group hint/error
  let leaveAsk = $state<string | null>(null)               // group pending leave confirmation
  let gBusy = $state<string | null>(null)                  // group with an in-flight action
  let creating = $state(false)                             // create-group form open
  let newName = $state('')
  let createErr = $state('')
  async function doCreate() {
    const v = newName.trim()
    if (!v || gBusy) return
    gBusy = 'create'; createErr = ''
    try {
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { return null } })()
      await createGroup(v, tz)
      newName = ''; creating = false; onGroupsChanged()
    } catch (e) {
      createErr = String((e as Error)?.message ?? '').includes('group_limit') ? t('acc.create_limit') : t('acc.create_failed')
    } finally { gBusy = null }
  }

  $effect(() => {
    for (const g of groups) if (!(g.id in names)) myGroupName(g.id).then((n) => { names = { ...names, [g.id]: n } })
  })

  function startEdit(g: Group) { editing = g.id; nameDraft = names[g.id] ?? ''; gMsg = { ...gMsg, [g.id]: '' } }
  async function saveName(g: Group) {
    const v = nameDraft.trim()
    if (!v || gBusy) return
    gBusy = g.id
    try {
      const { duplicate } = await setGroupDisplayName(g.id, v)
      names = { ...names, [g.id]: v }; editing = null
      gMsg = { ...gMsg, [g.id]: duplicate ? t('acc.name_dup') : '' }
    } catch { gMsg = { ...gMsg, [g.id]: t('acc.save_failed') } }
    finally { gBusy = null }
  }
  async function doLeave(g: Group) {
    if (gBusy) return
    gBusy = g.id
    try { await leaveGroup(g.id); leaveAsk = null; onGroupsChanged() }
    catch { gMsg = { ...gMsg, [g.id]: t('acc.leave_failed') } }
    finally { gBusy = null }
  }

  async function send() {
    if (busy || !email.includes('@')) return
    busy = true; err = ''
    try { await requestCode(email.trim()); step = 'code' }
    catch (e) { err = (e as Error).message } finally { busy = false }
  }
  async function verify() {
    if (busy || !code.trim()) return
    busy = true; err = ''
    try { await verifyCode(email.trim(), code); onClose() }
    catch (e) { err = (e as Error).message } finally { busy = false }
  }
  async function doSignOut(global: boolean) {
    try { await supabase.auth.signOut({ scope: global ? 'global' : 'local' }) } catch { /* ignore */ }
    onClose()
  }
</script>

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
  <div class="sheet">
    <div class="head">
      <strong>{t('acc.title')}</strong>
      <button class="ghost small" onclick={onClose}>{t('common.close')}</button>
    </div>
    <p class="intro">{t('acc.intro')}</p>

    <!-- Value of the cloud features, unified (backup · sync · group sharing). -->
    <button class="benefits-toggle" onclick={() => (showBenefits = !showBenefits)} aria-expanded={showBenefits}>
      {t('acc.benefits_toggle')} <span class="bcaret">{showBenefits ? '▴' : '▾'}</span>
    </button>
    {#if showBenefits}
      <ul class="benefits">
        <li><span class="bi">🔒</span><div><strong>{t('acc.benefit_backup_t')}</strong><span>{t('acc.benefit_backup_d')}</span></div></li>
        <li><span class="bi">🔄</span><div><strong>{t('acc.benefit_sync_t')}</strong><span>{t('acc.benefit_sync_d')}</span></div></li>
        <li><span class="bi">👥</span><div><strong>{t('acc.benefit_group_t')}</strong><span>{t('acc.benefit_group_d')}</span></div></li>
      </ul>
    {/if}

    <div class="scroll">
      <!-- Backup & Sync -->
      <div class="acard" class:active={signedIn}>
        <div class="ctitle">☁️&nbsp; {t('acc.backup')} {#if signedIn}<span class="check">✓</span>{/if}</div>
        <div class="cdesc">{t('acc.backup_desc')}</div>
        {#if signedIn}
          <div class="acct">{t('acc.signed_in_as')} <strong>{userEmail}</strong></div>
          {#if !confirmOut}
            <button class="ghost small" onclick={() => (confirmOut = true)}>{t('menu.signout')}</button>
          {:else}
            <p class="hint">{t('acc.signout_q')}</p>
            <div class="btnrow">
              <button class="ghost small" onclick={() => doSignOut(false)}>{t('acc.this_device')}</button>
              <button class="ghost small" onclick={() => doSignOut(true)}>{t('acc.all_devices')}</button>
              <button class="ghost small" onclick={() => (confirmOut = false)}>{t('common.cancel')}</button>
            </div>
          {/if}
        {:else if step === 'idle'}
          <button class="primary" onclick={() => (step = 'email')}>{t('acc.signin_create')}</button>
        {:else if step === 'email'}
          <input type="email" inputmode="email" autocomplete="email"
                 autocapitalize="none" autocorrect="off" spellcheck="false" bind:value={email}
                 placeholder={t('auth.email_ph')}
                 onkeydown={(e) => { if (e.key === 'Enter' && email.includes('@')) send() }} />
          <button class="primary" onclick={send} disabled={busy || !email.includes('@')}>{t('acc.send_code')}</button>
        {:else}
          <p class="hint">{t('acc.code_hint')}</p>
          <input inputmode="numeric" autocomplete="one-time-code" bind:value={code} placeholder={t('auth.code_ph')}
                 onkeydown={(e) => { if (e.key === 'Enter') verify() }} />
          <button class="primary" onclick={verify} disabled={busy || !code.trim()}>{t('acc.confirm')}</button>
          <button class="ghost small" onclick={() => { step = 'email'; code = '' }}>{t('auth.other_email')}</button>
        {/if}
        {#if err}<p class="err">{err}</p>{/if}
      </div>

      <!-- Trainingsgruppe -->
      <div class="acard">
        <div class="ctitle">👥&nbsp; {t('acc.group')}</div>
        <div class="cdesc">{t('acc.group_desc')}</div>
        {#if signedIn && groups.length}
          {#each groups as g (g.id)}
            <div class="grow">
              <div class="gname">{g.name}{#if g.ownerId && g.ownerId === myUserId}<span class="gtag">{t('acc.owner')}</span>{/if}</div>
              <button class="ghost small" onclick={() => (manageGroup = g)}>{t('acc.manage')}</button>
              {#if editing === g.id}
                <div class="btnrow">
                  <input class="ginput" bind:value={nameDraft} maxlength="40" placeholder={t('acc.display_name_ph')}
                         onkeydown={(e) => { if (e.key === 'Enter') saveName(g) }} />
                  <button class="primary" onclick={() => saveName(g)} disabled={gBusy === g.id || !nameDraft.trim()}>{t('common.save')}</button>
                  <button class="ghost small" onclick={() => (editing = null)}>{t('common.cancel')}</button>
                </div>
              {:else}
                <button class="ghost small" onclick={() => startEdit(g)}>
                  {names[g.id] ? t('acc.my_name_is', names[g.id]!) : t('acc.set_name')}
                </button>
              {/if}
              {#if g.ownerId && g.ownerId === myUserId}
                <p class="hint">{t('acc.owner_hint')}</p>
              {:else if leaveAsk === g.id}
                <p class="hint">{t('acc.leave_q', g.name)}</p>
                <div class="btnrow">
                  <button class="danger small" onclick={() => doLeave(g)} disabled={gBusy === g.id}>{t('acc.leave')}</button>
                  <button class="ghost small" onclick={() => (leaveAsk = null)}>{t('common.cancel')}</button>
                </div>
              {:else}
                <button class="ghost small leave" onclick={() => { leaveAsk = g.id }}>{t('acc.leave_group')}</button>
              {/if}
              {#if gMsg[g.id]}<p class="hint warn">{gMsg[g.id]}</p>{/if}
            </div>
          {/each}
        {/if}
        {#if signedIn}
          {#if !creating}
            <div class="btnrow">
              <button class="primary" onclick={() => { creating = true; newName = ''; createErr = '' }}>{t('acc.create_group')}</button>
              <button class="ghost small" onclick={() => { onClose(); onJoin() }}>{t('join.title')}</button>
            </div>
          {:else}
            <input bind:value={newName} maxlength="40" placeholder={t('acc.create_name_ph')}
                   autocapitalize="sentences" onkeydown={(e) => { if (e.key === 'Enter') doCreate() }} />
            <p class="hint pricing">{t('acc.create_pricing')}</p>
            {#if createErr}<p class="err">{createErr}</p>{/if}
            <div class="btnrow">
              <button class="primary" onclick={doCreate} disabled={gBusy === 'create' || !newName.trim()}>{t('acc.create_btn')}</button>
              <button class="ghost small" onclick={() => { creating = false; createErr = '' }}>{t('common.cancel')}</button>
            </div>
          {/if}
        {:else}
          <button class="ghost small" onclick={() => { onClose(); onJoin() }}>{t('join.title')}</button>
        {/if}
      </div>
    </div>
  </div>
</div>

{#if manageGroup}
  <GroupManage groupId={manageGroup.id} groupName={manageGroup.name} {myUserId}
               onClose={() => (manageGroup = null)}
               onChanged={() => { onGroupsChanged(); manageGroup = null }} />
{/if}

<style>
  .overlay { position: fixed; inset: 0 0 var(--navh, 56px) 0; z-index: 900; background: rgba(0,0,0,.45);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; max-height: 88vh; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); gap: 8px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .head strong { font-size: 17px; }
  .intro { color: var(--on-surface-variant); font-size: 13px; margin: 0; }
  .benefits-toggle { align-self: flex-start; background: transparent; border: 0; cursor: pointer;
    color: var(--team-a); font-size: 13px; font-weight: 700; padding: 2px 0; display: inline-flex; gap: 4px; }
  .bcaret { color: var(--on-surface-variant); }
  .benefits { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px;
    background: var(--surface); border: 1px solid var(--outline); border-radius: 12px; padding: 12px 14px; }
  .benefits li { display: flex; gap: 10px; align-items: flex-start; }
  .benefits .bi { font-size: 18px; line-height: 1.2; flex: 0 0 auto; }
  .benefits div { display: flex; flex-direction: column; gap: 1px; }
  .benefits strong { font-size: 14px; }
  .benefits span { font-size: 12px; color: var(--on-surface-variant); }
  .hint.pricing { background: var(--surface-variant); border-radius: 10px; padding: 10px 12px; line-height: 1.4; }
  .scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; display: flex;
    flex-direction: column; gap: 12px; margin-top: 6px; }
  .acard { background: var(--surface); border: 1px solid var(--outline); border-radius: 14px;
    padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .acard.active { border-color: var(--team-a); border-width: 2px; }
  .ctitle { font-weight: 800; font-size: 16px; display: flex; align-items: center; }
  .check { color: var(--team-a); margin-left: 8px; }
  .cdesc { color: var(--on-surface-variant); font-size: 13px; }
  .acct { font-size: 14px; }
  .btnrow { display: flex; gap: 8px; flex-wrap: wrap; }
  .hint { color: var(--on-surface-variant); font-size: 12px; margin: 2px 0 0; }
  .err { color: var(--bad); font-size: 13px; margin: 4px 0 0; }
  input { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--outline);
    background: var(--surface); color: var(--on-surface); font-size: 16px; }
  .primary { background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 10px;
    padding: 12px 14px; font-size: 15px; font-weight: 700; cursor: pointer; align-self: flex-start; }
  .primary:disabled { opacity: .5; cursor: default; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 10px; padding: 7px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
    align-self: flex-start; }
  .danger.small { background: transparent; color: var(--bad); border: 1px solid var(--bad);
    border-radius: 10px; padding: 7px 12px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .danger.small:disabled { opacity: .5; cursor: default; }
  /* Per-group management row */
  .grow { border-top: 1px solid var(--outline); padding-top: 10px; margin-top: 2px;
    display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .gname { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; }
  .gtag { font-size: 11px; font-weight: 600; background: var(--surface-variant);
    color: var(--on-surface-variant); padding: 1px 7px; border-radius: 8px; }
  .ginput { flex: 1; min-width: 140px; }
  .leave { color: var(--on-surface-variant); border-color: var(--outline); }
  .warn { color: var(--bad); }
</style>
