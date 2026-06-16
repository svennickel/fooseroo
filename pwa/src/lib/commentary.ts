// Read-aloud commentary text — a byte-for-byte port of the Android
// LiveCommentaryService wording (res/values-de speak_* strings + the ordinal
// maps), so the PWA speaks EXACTLY what the app speaks. German only (the app's
// commentary here is German; the web speak() forces de-DE).
import type { MatchView } from './match'
import { setsWon } from './match'

export type SpeakNames = { home: string; away: string }

// Nominative ordinals used inside player/team names ("1. Herren" → "Erster Herren").
const GERMAN_ORDINALS: Record<number, string> = {
  1: 'Erster', 2: 'Zweiter', 3: 'Dritter', 4: 'Vierter', 5: 'Fünfter',
  6: 'Sechster', 7: 'Siebter', 8: 'Achter', 9: 'Neunter', 10: 'Zehnter',
  11: 'Elfter', 12: 'Zwölfter', 13: 'Dreizehnter', 14: 'Vierzehnter', 15: 'Fünfzehnter',
  16: 'Sechzehnter', 17: 'Siebzehnter', 18: 'Achtzehnter', 19: 'Neunzehnter', 20: 'Zwanzigster',
  21: 'Einundzwanzigster', 22: 'Zweiundzwanzigster', 23: 'Dreiundzwanzigster', 24: 'Vierundzwanzigster', 25: 'Fünfundzwanzigster',
  26: 'Sechsundzwanzigster', 27: 'Siebenundzwanzigster', 28: 'Achtundzwanzigster', 29: 'Neunundzwanzigster', 30: 'Dreißigster',
}
// Declined ("den/im …ten Satz") forms — "Im vierten Satz".
const GERMAN_SET_ORDINALS: Record<number, string> = {
  1: 'ersten', 2: 'zweiten', 3: 'dritten', 4: 'vierten', 5: 'fünften',
  6: 'sechsten', 7: 'siebten', 8: 'achten', 9: 'neunten', 10: 'zehnten',
  11: 'elften', 12: 'zwölften', 13: 'dreizehnten', 14: 'vierzehnten', 15: 'fünfzehnten',
  16: 'sechzehnten', 17: 'siebzehnten', 18: 'achtzehnten', 19: 'neunzehnten', 20: 'zwanzigsten',
  21: 'einundzwanzigsten', 22: 'zweiundzwanzigsten', 23: 'dreiundzwanzigsten', 24: 'vierundzwanzigsten', 25: 'fünfundzwanzigsten',
  26: 'sechsundzwanzigsten', 27: 'siebenundzwanzigsten', 28: 'achtundzwanzigsten', 29: 'neunundzwanzigsten', 30: 'dreißigsten',
}

// app spokenName: Regex("(\d+)\.") replaced by the German ordinal (all matches).
export function spokenName(name: string): string {
  return name.replace(/(\d+)\./g, (m, d) => GERMAN_ORDINALS[Number(d)] ?? m)
}
// app ordinalSetWord: GERMAN_SET_ORDINALS[n] ?: "$n.".
function setOrd(n: number): string {
  return GERMAN_SET_ORDINALS[n] ?? `${n}.`
}
// app speakParts: join with ", ", each part trimmed and trailing ":" removed.
function joinParts(parts: string[]): string {
  return parts.map((p) => p.trim().replace(/:+$/, '')).join(', ')
}

// speak_match_setscore_lead / _draw
function setScoreLine(n: SpeakNames, setNumber: number, ga: number, gb: number): string {
  const ord = setOrd(setNumber)
  if (ga > gb) return `Im ${ord} Satz führt ${spokenName(n.home)} damit jetzt mit ${ga} zu ${gb}.`
  if (gb > ga) return `Im ${ord} Satz führt ${spokenName(n.away)} damit jetzt mit ${gb} zu ${ga}.`
  return `Im ${ord} Satz steht es damit unentschieden mit ${ga} zu ${gb}.`
}

// announceMatchStart: "Live A gegen B" (+ set tally + current set score when
// the read-aloud is started mid-match, so a late listener is caught up).
export function matchStartLine(view: MatchView, n: SpeakNames): string {
  const { a: sa, b: sb } = setsWon(view)
  const ga = view.current?.a ?? 0
  const gb = view.current?.b ?? 0
  const parts = [`Live ${spokenName(n.home)} gegen ${spokenName(n.away)}`]
  if (sa > 0 || sb > 0) {
    parts.push('Nach Sätzen:')
    parts.push(`${spokenName(n.home)} ${sa}`)
    parts.push(`${spokenName(n.away)} ${sb}`)
  }
  if (sa > 0 || sb > 0 || ga > 0 || gb > 0) parts.push(setScoreLine(n, sa + sb + 1, ga, gb))
  return joinParts(parts)
}

// announceMatchGoal: 4-way classification on the score BEFORE this goal.
export function goalLine(view: MatchView, n: SpeakNames, goalIndex: number): string {
  const g = view.goals[goalIndex]
  const name = spokenName(g.team === 'A' ? n.home : n.away)
  const scorerBefore = (g.team === 'A' ? g.a : g.b) - 1
  const oppBefore = g.team === 'A' ? g.b : g.a
  if (scorerBefore > oppBefore) return `${name} baut die Führung aus.`
  if (scorerBefore === oppBefore) return `Führungstor für ${name}.`
  if (scorerBefore + 1 === oppBefore) return `Ausgleichstor für ${name}.`
  return `Anschlusstor für ${name}.`
}

// announceCurrentSetScore: the running set score, announced once after a burst.
export function currentScoreLine(view: MatchView, n: SpeakNames): string {
  const { a: sa, b: sb } = setsWon(view)
  return setScoreLine(n, sa + sb + 1, view.current?.a ?? 0, view.current?.b ?? 0)
}

// announceMatchSet: winner + ordinal, then (a beat, then) the running set tally —
// two utterances, as in the app (speakParts → speakSilence(450) → speakParts).
export function setWinLines(view: MatchView, n: SpeakNames, setIndex: number): [string, string] {
  const s = view.sets[setIndex]
  const winner = spokenName(s.a > s.b ? n.home : n.away)
  const { a: sa, b: sb } = setsWon(view)
  const win = `${winner} gewinnt den ${setOrd(setIndex + 1)} Satz.`
  const tally = joinParts(['Nach Sätzen:', `${spokenName(n.home)} ${sa}`, `${spokenName(n.away)} ${sb}`])
  return [win, tally]
}

// announceMatchDiff (undo/edit branch): "Korrektur." + the recomputed set score.
export function correctionLine(view: MatchView, n: SpeakNames): string {
  return joinParts(['Korrektur.', currentScoreLine(view, n)])
}

// announceMatchFinal: "Endstand. A gegen B." + set tally + outcome, one utterance
// (joined with " ", and the tally keeps its colon — like the app).
export function finalLine(view: MatchView, n: SpeakNames): string {
  const { a: sa, b: sb } = setsWon(view)
  const outcome = sa > sb ? `Damit gewinnt ${spokenName(n.home)}.`
    : sb > sa ? `Damit gewinnt ${spokenName(n.away)}.`
    : 'Damit endet das Match unentschieden.'
  const tally = `Nach Sätzen: ${spokenName(n.home)} ${sa}, ${spokenName(n.away)} ${sb}`
  return [`Endstand. ${spokenName(n.home)} gegen ${spokenName(n.away)}.`, tally, outcome]
    .map((p) => p.trim()).join(' ')
}
