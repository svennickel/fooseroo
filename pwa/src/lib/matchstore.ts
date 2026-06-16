// Persistence for matches created/edited in the web, byte-compatible with the app.
// The row id is Java's UUID.nameUUIDFromBytes("match:<scope>:<ts>") — a v3
// (MD5-based) name UUID — so the web's rows share the deterministic id with the
// app's and dedupe/converge through Backup & Sync + RLS.
import { supabase } from './supabase'
import type { ScoreState } from './scoring'
import { setsWonFromGames } from './scoring'

// --- MD5 (bytes → 16-byte digest), needed for the v3 name UUID -----------------
function md5(input: Uint8Array): Uint8Array {
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c))
  const add = (a: number, b: number) => (a + b) | 0
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21]
  const K = new Int32Array(64)
  for (let i = 0; i < 64; i++) K[i] = (Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0

  const origLen = input.length
  const bitLen = origLen * 8
  const padded = new Uint8Array((((origLen + 8) >> 6) + 1) << 6)
  padded.set(input)
  padded[origLen] = 0x80
  // little-endian 64-bit length (low 32 bits enough for our short inputs)
  for (let i = 0; i < 4; i++) padded[padded.length - 8 + i] = (bitLen >>> (8 * i)) & 0xff

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476
  const M = new Int32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4
      M[i] = padded[j] | (padded[j + 1] << 8) | (padded[j + 2] << 16) | (padded[j + 3] << 24)
    }
    let A = a0, B = b0, C = c0, D = d0
    for (let i = 0; i < 64; i++) {
      let F: number, g: number
      if (i < 16) { F = (B & C) | (~B & D); g = i }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
      else { F = C ^ (B | ~D); g = (7 * i) % 16 }
      F = add(add(add(F, A), K[i]), M[g])
      A = D; D = C; C = B; B = add(B, rotl(F, S[i]))
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D)
  }
  const out = new Uint8Array(16)
  ;[a0, b0, c0, d0].forEach((v, k) => {
    out[k * 4] = v & 0xff; out[k * 4 + 1] = (v >>> 8) & 0xff
    out[k * 4 + 2] = (v >>> 16) & 0xff; out[k * 4 + 3] = (v >>> 24) & 0xff
  })
  return out
}

// Java UUID.nameUUIDFromBytes: MD5 of the bytes, then set version 3 + IETF variant.
export function nameUUIDv3(name: string): string {
  const d = md5(new TextEncoder().encode(name))
  d[6] = (d[6] & 0x0f) | 0x30
  d[8] = (d[8] & 0x3f) | 0x80
  const h = Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function matchScope(groupId: string | null): string | null {
  return groupId ? `g:${groupId}` : null // null → caller fills the uid
}
export function matchRowId(scope: string, ts: number): string {
  return nameUUIDv3(`match:${scope}:${ts}`)
}

// Upsert a match row exactly like CloudSync.toRow. groupId null = personal (scope =
// uid). running=true keeps it a live row (live_editor = me); false = finished.
export async function saveMatchRow(opts: {
  groupId: string | null; ts: number; teamA: string; teamB: string
  category: string | null; state: ScoreState; running: boolean
}): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('not_authenticated')
  const scope = opts.groupId ? `g:${opts.groupId}` : uid
  const { a, b } = setsWonFromGames(opts.state.games)
  const row = {
    id: matchRowId(scope, opts.ts),
    owner_id: uid, created_by: uid, group_id: opts.groupId,
    home_name: opts.teamA, away_name: opts.teamB,
    sets_home: a, sets_away: b,
    state: opts.state,
    category: opts.category && opts.category.trim() ? opts.category : null,
    created_at: new Date(opts.ts).toISOString(),
    running: opts.running,
    live_editor: opts.running ? uid : null,
  }
  const { error } = await supabase.from('matches').upsert(row, { onConflict: 'id' })
  if (error) throw error
}

// Discard a running match → soft-delete its row (deleted_at), like the app.
export async function discardMatchRow(groupId: string | null, ts: number): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('not_authenticated')
  const scope = groupId ? `g:${groupId}` : uid
  const { error } = await supabase.from('matches')
    .update({ deleted_at: new Date().toISOString() }).eq('id', matchRowId(scope, ts))
  if (error) throw error
}
