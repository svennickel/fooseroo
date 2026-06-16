<script lang="ts">
  // Owner/moderator management of one Trainingsgruppe — the web port of the app's
  // GroupManageFragment: member roster with role/access controls + remove, the join
  // code + its settings, result retention (owner) and group deletion (owner, with a
  // typed confirmation). Plain members get a read-only roster (names + roles).
  import {
    groupMembers, groupSettings, setMemberRole, setMemberAccess, removeMember,
    regenerateJoinCode, configureJoin, setResultRetention, deleteGroup,
    type Member, type GroupSettings
  } from './data'

  let { groupId, groupName, myUserId, onClose, onChanged }:
    { groupId: string; groupName: string; myUserId: string | null;
      onClose: () => void; onChanged: () => void } = $props()

  let members = $state<Member[]>([])
  let settings = $state<GroupSettings | null>(null)
  let loading = $state(true)
  let busy = $state(false)
  let err = $state('')
  let delConfirm = $state('')   // typed group name to enable deletion
  let askDelete = $state(false)
  let retDays = $state('')      // retention input (empty = off)

  const myRole = $derived(members.find((m) => m.userId === myUserId)?.role ?? 'member')
  const isOwner = $derived(myRole === 'owner')
  const isManager = $derived(myRole === 'owner' || myRole === 'moderator')

  async function load() {
    loading = true; err = ''
    try {
      members = await groupMembers(groupId)
      settings = await groupSettings(groupId)
      retDays = settings?.retentionDays != null ? String(settings.retentionDays) : ''
    } catch { err = 'Konnte die Gruppe nicht laden.' }
    finally { loading = false }
  }
  $effect(() => { load() })

  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } })()
  const roleLabel = (r: string) => r === 'owner' ? 'Inhaber:in' : r === 'moderator' ? 'Moderator:in' : 'Mitglied'

  async function run(fn: () => Promise<void>) {
    if (busy) return
    busy = true; err = ''
    try { await fn(); await load() } catch { err = 'Aktion fehlgeschlagen.' } finally { busy = false }
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
  async function doDelete() {
    if (busy || delConfirm.trim() !== groupName.trim()) return
    busy = true; err = ''
    try { await deleteGroup(groupId); onChanged(); onClose() }
    catch { err = 'Löschen fehlgeschlagen.'; busy = false }
  }
</script>

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
  <div class="sheet">
    <div class="head">
      <strong>{groupName} · Verwalten</strong>
      <button class="ghost small" onclick={onClose}>Schließen</button>
    </div>

    {#if loading}
      <p class="hint">Lädt…</p>
    {:else}
      <div class="scroll">
        {#if err}<p class="err">{err}</p>{/if}

        <!-- Join code (managers) -->
        {#if isManager && settings}
          <div class="sec">
            <div class="slabel">Beitritts-Code</div>
            <div class="coderow">
              <code class="code">{settings.joinCode ?? '—'}</code>
              <button class="ghost small" onclick={regen} disabled={busy}>Neu erzeugen</button>
            </div>
            <label class="chk"><input type="checkbox" checked={settings.joinEnabled} onchange={toggleEnabled} disabled={busy} /> Beitritt per Code erlaubt</label>
            <div class="arow">
              <span>Standard-Zugriff neuer Mitglieder:</span>
              <select value={settings.joinDefaultAccess} onchange={(e) => setDefaultAccess((e.currentTarget as HTMLSelectElement).value)} disabled={busy}>
                <option value="write">Schreiben</option>
                <option value="read">Nur lesen</option>
              </select>
            </div>
          </div>
        {/if}

        <!-- Members -->
        <div class="sec">
          <div class="slabel">Mitglieder ({members.length})</div>
          {#each members as m (m.userId)}
            <div class="mrow">
              <div class="minfo">
                <div class="mname">{m.name || 'Ohne Namen'}{#if m.userId === myUserId} <span class="you">(du)</span>{/if}</div>
                {#if m.email}<div class="memail">{m.email}</div>{/if}
              </div>
              {#if isManager && m.role !== 'owner' && m.userId !== myUserId}
                <div class="mctl">
                  <select value={m.role} onchange={(e) => changeRole(m, (e.currentTarget as HTMLSelectElement).value)} disabled={busy}>
                    <option value="member">Mitglied</option>
                    <option value="moderator">Moderator:in</option>
                  </select>
                  <select value={m.access} onchange={(e) => changeAccess(m, (e.currentTarget as HTMLSelectElement).value)} disabled={busy}>
                    <option value="write">Schreiben</option>
                    <option value="read">Nur lesen</option>
                  </select>
                  <button class="ghost small" onclick={() => kick(m)} disabled={busy}>Entfernen</button>
                </div>
              {:else}
                <span class="rtag">{roleLabel(m.role)}</span>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Retention (owner) -->
        {#if isOwner}
          <div class="sec">
            <div class="slabel">Ergebnisse automatisch löschen</div>
            <p class="hint">Tage, nach denen abgeschlossene Ergebnisse gelöscht werden (leer = aus).</p>
            <div class="arow">
              <input class="num" inputmode="numeric" bind:value={retDays} placeholder="aus" />
              <button class="ghost small" onclick={saveRetention} disabled={busy}>Speichern</button>
            </div>
          </div>

          <!-- Danger zone -->
          <div class="sec danger">
            <div class="slabel">Gefahrenzone</div>
            {#if !askDelete}
              <button class="danger small" onclick={() => { askDelete = true; delConfirm = '' }}>Gruppe löschen</button>
            {:else}
              <p class="hint">Das löscht die Gruppe samt aller Daten für alle Mitglieder – unwiderruflich. Tippe zum Bestätigen den Namen <strong>{groupName}</strong> ein.</p>
              <input class="num wide" bind:value={delConfirm} placeholder={groupName} />
              <div class="arow">
                <button class="danger small" onclick={doDelete} disabled={busy || delConfirm.trim() !== groupName.trim()}>Endgültig löschen</button>
                <button class="ghost small" onclick={() => (askDelete = false)}>Abbrechen</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 950; background: rgba(0,0,0,.45);
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
  .chk { display: flex; align-items: center; gap: 8px; font-size: 14px; }
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
  .err { color: var(--bad); font-size: 13px; margin: 0; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 8px; padding: 6px 11px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .danger.small { background: transparent; color: var(--bad); border: 1px solid var(--bad);
    border-radius: 8px; padding: 6px 11px; font-size: 13px; font-weight: 700; cursor: pointer; align-self: flex-start; }
  .ghost.small:disabled, .danger.small:disabled { opacity: .5; cursor: default; }
</style>
