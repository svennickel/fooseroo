// Port of the Android ShareCodec: opaque tokens for GROUP match/training share
// links. A token packs a 16-bit group hash + a value (match timestamp ms / training
// day number) into a fixed-width int, scrambled by a reversible odd multiply mod
// 2^bits and base36-encoded. Must match the Kotlin implementation byte-for-byte, so
// the 64-bit Long arithmetic is reproduced with BigInt (+ explicit mod 2^64) and the
// group hash with Java's String.hashCode().

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const MIN_LEN = 7
const K = 0x2545f4914f6cdd1dn
const TWO64 = 1n << 64n

const MATCH_BITS = 58
const TRAIN_BITS = 36
const VAL_MATCH_BITS = 42
const VAL_TRAIN_BITS = 20

const mask = (bits: number): bigint => (1n << BigInt(bits)) - 1n
const mod64 = (x: bigint): bigint => ((x % TWO64) + TWO64) % TWO64

// Java String.hashCode() (32-bit signed overflow), then & 0xFFFF — same as Kotlin's
// String.hashCode() and 0xFFFF.
export function groupHash(groupId: string): number {
  let h = 0
  for (let i = 0; i < groupId.length; i++) h = (Math.imul(31, h) + groupId.charCodeAt(i)) | 0
  return h & 0xffff
}

function base36(value: bigint): string {
  if (value === 0n) return '0'
  let v = value
  let s = ''
  while (v > 0n) { s = ALPHABET[Number(v % 36n)] + s; v /= 36n }
  return s
}

function unbase36(s: string): bigint | null {
  if (s.length === 0) return null
  let v = 0n
  for (const c of s) {
    const d = ALPHABET.indexOf(c)
    if (d < 0) return null
    v = v * 36n + BigInt(d)
  }
  return v
}

// Modular inverse of the odd K mod 2^64 (Newton, 6 steps), reproducing the Kotlin
// Long arithmetic with mod 2^64 at each step.
function inverse(a: bigint): bigint {
  let x = mod64(a)
  for (let i = 0; i < 6; i++) x = mod64(x * mod64(2n - mod64(a * x)))
  return x
}

function encode(payload: bigint, bits: number): string {
  const scrambled = (payload * K) & mask(bits)
  return base36(scrambled).padStart(MIN_LEN, '0')
}

function decode(token: string, bits: number): bigint | null {
  const scrambled = unbase36(token.toLowerCase())
  if (scrambled === null) return null
  const m = mask(bits)
  return ((scrambled & m) * inverse(K)) & m
}

export function encodeMatch(groupId: string, timestampMillis: number): string {
  return encode((BigInt(groupHash(groupId)) << BigInt(VAL_MATCH_BITS)) |
    (BigInt(timestampMillis) & mask(VAL_MATCH_BITS)), MATCH_BITS)
}

export function decodeMatch(token: string): { groupHash: number; timestampMillis: number } | null {
  const v = decode(token, MATCH_BITS)
  if (v === null) return null
  return { groupHash: Number(v >> BigInt(VAL_MATCH_BITS)), timestampMillis: Number(v & mask(VAL_MATCH_BITS)) }
}

export function encodeTraining(groupId: string, dayNumber: number): string {
  return encode((BigInt(groupHash(groupId)) << BigInt(VAL_TRAIN_BITS)) |
    (BigInt(dayNumber) & mask(VAL_TRAIN_BITS)), TRAIN_BITS)
}

export function decodeTraining(token: string): { groupHash: number; dayNumber: number } | null {
  const v = decode(token, TRAIN_BITS)
  if (v === null) return null
  return { groupHash: Number(v >> BigInt(VAL_TRAIN_BITS)), dayNumber: Number(v & mask(VAL_TRAIN_BITS)) }
}
