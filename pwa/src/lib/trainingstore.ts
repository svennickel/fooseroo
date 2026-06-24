// Persist training entries byte-compatibly with the app (CloudTrainingSync). The
// row id is the same deterministic UUIDv3 scheme (train:<scope>:<kind>:…) so the
// web's entries converge with the app's through the sync. Three kinds:
//   measure          — a timed measurement (no success)
//   measure_success  — a timed measurement with success/fail
//   outcome          — a success/fail tally (no time)
// The category lives in `mode` (and also in data.mode, as the app requires).
import { supabase } from './supabase'
import { nameUUIDv3 } from './matchstore'
import type { Ctx } from './data'

async function uidScope(ctx: Ctx): Promise<{ uid: string; scope: string }> {
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('not_authenticated')
  return { uid, scope: ctx ? `g:${ctx}` : uid }
}

async function upsert(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('training_entries').upsert(row, { onConflict: 'id' })
  if (error) throw error
}

// kind = measure (success null) | measure_success (success set). Mirrors measureRow.
export async function saveMeasure(ctx: Ctx, m: {
  name: string; mode: string; elapsedMs: number; limit: number; ts: number; success: boolean | null
}): Promise<void> {
  const { uid, scope } = await uidScope(ctx)
  const kind = m.success == null ? 'measure' : 'measure_success'
  const succPart = m.success == null ? 'null' : String(m.success)
  const id = nameUUIDv3(`train:${scope}:${kind}:${m.ts}:${m.name}:${m.elapsedMs}:${m.limit}:${succPart}`)
  const data: Record<string, unknown> = { name: m.name, ts: m.ts, elapsedMs: m.elapsedMs, limit: m.limit, mode: m.mode }
  if (kind === 'measure_success') data.success = m.success
  await upsert({
    id, owner_id: uid, created_by: uid, group_id: ctx, kind, mode: m.mode.trim() || null,
    occurred_at: new Date(m.ts).toISOString(), data,
  })
}

// Mirrors outcomeRow.
export async function saveOutcome(ctx: Ctx, o: {
  name: string; mode: string; ts: number; success: boolean
}): Promise<void> {
  const { uid, scope } = await uidScope(ctx)
  const id = nameUUIDv3(`train:${scope}:outcome:${o.ts}:${o.name}:${o.success}`)
  await upsert({
    id, owner_id: uid, created_by: uid, group_id: ctx, kind: 'outcome', mode: o.mode.trim() || null,
    occurred_at: new Date(o.ts).toISOString(),
    data: { name: o.name, ts: o.ts, success: o.success, mode: o.mode },
  })
}

// The deterministic id of an existing entry, recomputed from its fields exactly as
// save*/CloudTrainingSync do (the id excludes `mode`, so changing the category keeps
// the same row). Returns null if the fields needed for this kind are missing.
export function entryId(ctx: Ctx, e: {
  kind: string; name: string; at: number; elapsedMs?: number; limitSeconds?: number; success?: boolean
}, scope: string): string | null {
  if (e.kind === 'outcome') return nameUUIDv3(`train:${scope}:outcome:${e.at}:${e.name}:${!!e.success}`)
  if (e.elapsedMs == null || e.limitSeconds == null) return null
  const succPart = e.kind === 'measure' ? 'null' : String(!!e.success)
  return nameUUIDv3(`train:${scope}:${e.kind}:${e.at}:${e.name}:${e.elapsedMs}:${e.limitSeconds}:${succPart}`)
}

// Soft-delete an entry (set deleted_at; the app's pull then drops it) — mirrors
// CloudTrainingSync.deleteMeasure/deleteOutcome. RLS forbids a hard delete.
export async function deleteTraining(ctx: Ctx, e: {
  kind: string; name: string; at: number; elapsedMs?: number; limitSeconds?: number; success?: boolean
}): Promise<void> {
  const { scope } = await uidScope(ctx)
  const id = entryId(ctx, e, scope)
  if (!id) return
  const { error } = await supabase.from('training_entries')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

// Change an entry's category (mode). The id excludes mode, so this is an in-place
// update of the `mode` column and data.mode — no id change, byte-compatible.
export async function retagTraining(ctx: Ctx, e: {
  kind: string; name: string; at: number; elapsedMs?: number; limitSeconds?: number; success?: boolean
}, newMode: string): Promise<void> {
  const { scope } = await uidScope(ctx)
  const id = entryId(ctx, e, scope)
  if (!id) return
  // Fetch the current data jsonb so we keep its other fields, then rewrite mode.
  const { data } = await supabase.from('training_entries').select('data').eq('id', id).maybeSingle()
  const d = ((data as { data?: Record<string, unknown> } | null)?.data) ?? {}
  const { error } = await supabase.from('training_entries')
    .update({ mode: newMode.trim() || null, data: { ...d, mode: newMode } }).eq('id', id)
  if (error) throw error
}
