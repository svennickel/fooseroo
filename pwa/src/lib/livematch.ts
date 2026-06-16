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
