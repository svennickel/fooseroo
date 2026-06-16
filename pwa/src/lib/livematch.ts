// Read-only viewer for the app's live-match broadcast channel (cloud/LiveMatch.kt).
// The editor (the device scoring the match) broadcasts "state" messages — the full
// MatchScore JSON — on a per-match channel `live-match:<scope>:<timestampMillis>`,
// where scope is the group id (group context) or the owner's user id (personal).
// A viewer announces "hello" on join so the editor pushes the current state, then
// mirrors every "state" push read-only — exactly what the apps do between each
// other, so the web detail updates in realtime instead of waiting for the poll.
import { supabase } from './supabase'

// Wire-compatible with the Kotlin @Serializable LiveMessage (field names must match).
export type LiveMessage = {
  type: string // hello | claim | state | ended (we only act on state/ended)
  sender: string
  target?: string
  state?: string // full MatchScore JSON for "state" / "ended" (final score)
  ts?: number
  blocked?: boolean
  abandoned?: boolean // "ended": true = abandoned (discarded), false = finished
  teamA?: string
  teamB?: string
}

export type LiveHandlers = {
  onState: (stateJson: string, teamA: string | undefined, teamB: string | undefined, ts: number | undefined) => void
  onEnded: (finalState: string | undefined, abandoned: boolean) => void
}

const EVENT = 'sync'

export function liveChannelId(scope: string, timestampMillis: number): string {
  return `live-match:${scope}:${timestampMillis}`
}

export type LiveEditor = {
  push: (stateJson: string, teamA: string, teamB: string) => void
  end: (finalState: string | null, abandoned: boolean) => void
  leave: () => void
}

// Join a match's broadcast channel as the EDITOR (the web is scoring it): claim the
// token (a fresh, newer claim ts takes the editor role over from the app, per the
// LiveMatch protocol), heartbeat the claim, answer a viewer's "hello" with the
// current state, and push "state" on every change. Mirrors cloud/LiveMatch.kt's
// editor role (without the takeover-veto UI — the newest claim simply wins).
export function createLiveEditor(channelId: string, getState: () => { json: string; teamA: string; teamB: string } | null): LiveEditor {
  const myId = (globalThis.crypto?.randomUUID?.() ?? `web-edit-${channelId.length}-${Date.now()}`)
  const claimTs = Date.now()
  const ch = supabase.channel(channelId, { config: { broadcast: { self: false } } })
  let hb: ReturnType<typeof setInterval> | null = null
  const claim = () => ch.send({ type: 'broadcast', event: EVENT, payload: { type: 'claim', sender: myId, ts: claimTs } })
  ch.on('broadcast', { event: EVENT }, (m: { payload?: unknown }) => {
    const msg = (m.payload ?? {}) as LiveMessage
    if (!msg || msg.sender === myId) return
    if (msg.type === 'hello') {
      claim()
      const s = getState()
      if (s) ch.send({ type: 'broadcast', event: EVENT, payload: { type: 'state', sender: myId, state: s.json, ts: Date.now(), teamA: s.teamA, teamB: s.teamB } })
    }
  })
  ch.subscribe((status: string) => {
    if (status !== 'SUBSCRIBED') return
    claim()
    hb = setInterval(claim, 3000) // heartbeat so a fresh viewer learns who holds the token
  })
  return {
    push: (json, teamA, teamB) => ch.send({ type: 'broadcast', event: EVENT, payload: { type: 'state', sender: myId, state: json, ts: Date.now(), teamA, teamB } }),
    end: (finalState, abandoned) => ch.send({ type: 'broadcast', event: EVENT, payload: { type: 'ended', sender: myId, state: finalState, abandoned } }),
    leave: () => { if (hb) clearInterval(hb); try { supabase.removeChannel(ch) } catch { /* ignore */ } },
  }
}

// Join as a VIEWER. Returns an unsubscribe function.
export function watchLiveMatch(channelId: string, h: LiveHandlers): () => void {
  const myId = (globalThis.crypto?.randomUUID?.() ?? `web-${Math.abs(Date.parse(channelId) || channelId.length)}-${channelId.length}`)
  const ch = supabase.channel(channelId, { config: { broadcast: { self: false } } })
  ch.on('broadcast', { event: EVENT }, (m: { payload?: unknown }) => {
    const msg = (m.payload ?? {}) as LiveMessage
    if (!msg || msg.sender === myId) return
    if (msg.type === 'state' && msg.state) h.onState(msg.state, msg.teamA ?? undefined, msg.teamB ?? undefined, msg.ts)
    else if (msg.type === 'ended') h.onEnded(msg.state ?? undefined, !!msg.abandoned)
  })
  ch.subscribe((status: string) => {
    // Announce ourselves so the editor replies with a "claim" + current "state".
    if (status === 'SUBSCRIBED') ch.send({ type: 'broadcast', event: EVENT, payload: { type: 'hello', sender: myId, ts: 0 } })
  })
  return () => { try { supabase.removeChannel(ch) } catch { /* ignore */ } }
}
