// Web i18n — mirrors the app's bilingual strings (values = English, values-de =
// German). One reactive `lang` ($state) drives a `t(key, ...args)` lookup; reading
// it inside t() makes every `{t('…')}` in a template update live when the language
// changes. Persisted as fs_lang = 'system' | 'de' | 'en'; 'system' follows the
// browser locale. Args fill %s / %1$s / %d placeholders, like the app's getString.
import { detectLang } from './lang'

export type Lang = 'de' | 'en'
export type LangPref = 'system' | 'de' | 'en'

const KEY = 'fs_lang'
function stored(): LangPref {
  try { const v = localStorage.getItem(KEY); return v === 'de' || v === 'en' ? v : 'system' } catch { return 'system' }
}
function systemLang(): Lang {
  // English coverage is still being completed, so "System" resolves to German for
  // now — German-locale testers must never see a half-translated UI. English is
  // reachable via the explicit Settings switcher. Flip this to
  // `detectLang(navigator.language)` once every component uses t().
  void detectLang
  return 'de'
}
function resolve(p: LangPref): Lang { return p === 'system' ? systemLang() : p }

let pref = $state<LangPref>(stored())
let current = $state<Lang>(resolve(stored()))

export function getLangPref(): LangPref { return pref }
export function getLang(): Lang { return current }

export function setLangPref(p: LangPref): void {
  pref = p
  current = resolve(p)
  try { localStorage.setItem(KEY, p) } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = current
}

// Call once on startup to reflect the persisted/derived language on <html lang>.
export function initLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = current
}

function fill(s: string, args: (string | number)[]): string {
  if (!args.length) return s
  let i = 0
  // %1$s / %2$d (explicit index) first, then bare %s / %d in order.
  return s
    .replace(/%(\d+)\$[sd]/g, (_, n) => String(args[Number(n) - 1] ?? ''))
    .replace(/%[sd]/g, () => String(args[i++] ?? ''))
}

export function t(key: string, ...args: (string | number)[]): string {
  const table = DICT[current]
  const s = table[key] ?? DICT.de[key] ?? key
  return fill(s, args)
}

// ---- Dictionary -------------------------------------------------------------
// Keys are namespaced by area. German first (the app's primary), English mirrors
// values/strings.xml wording where one exists.
const de: Record<string, string> = {
  // common
  'common.close': 'Schließen', 'common.cancel': 'Abbrechen', 'common.save': 'Speichern',
  'common.delete': 'Löschen', 'common.back': '← Zurück', 'common.done': 'Fertig',
  'common.add': 'Hinzufügen', 'common.overview': 'Zur Übersicht', 'common.loading': 'Lädt…',
  'common.retry_later': 'Bitte später erneut versuchen.',

  // nav / shell
  'nav.matches': 'Matches', 'nav.training': 'Training',
  'menu.settings': 'Einstellungen', 'menu.account': 'Konto', 'menu.signout': 'Abmelden',

  // settings
  'settings.title': 'Einstellungen', 'settings.design': 'Design',
  'settings.system': 'System', 'settings.light': 'Hell', 'settings.dark': 'Dunkel',
  'settings.language': 'Sprache', 'settings.lang_de': 'Deutsch', 'settings.lang_en': 'English',
  'settings.training': 'Training',
  'settings.rods_itsf': 'ITSF (10s / 15s)', 'settings.rods_saar': 'Saarland (20s)',
  'settings.countdown_desc': 'Restzeit herunterzählen statt verstrichener Zeit',
  'settings.countdown_note': 'Die Farbe (grün→amber→rot) folgt immer der Restzeit. Im Browser gespeichert.',
  'settings.stats': 'Unterstütze die Weiterentwicklung über anonyme Statistiken',
  'settings.stats_note': 'Ganz freiwillig – Standard: aus, jederzeit änderbar. Im Browser gespeichert.',
  'settings.terms_link': 'Datenschutz & Nutzungsbedingungen',
  'settings.terms_title': 'Datenschutz & Nutzungsbedingungen',

  // training — capture
  'training.new': 'Neuer Trainingseintrag', 'training.kind_measure': 'Zeitmessung',
  'training.kind_success': 'Zeit & Erfolg', 'training.kind_outcome': 'Erfolgsquote',
  'training.name': 'Name', 'training.pick_person': 'Person wählen',
  'training.category': 'Kategorie', 'training.pick_category': 'Kategorie wählen',
  'training.window_label': 'Zeitfenster', 'training.hit': '✓ Treffer', 'training.miss': '✗ Fehler',
  'training.start': 'Start', 'training.running': 'läuft …', 'training.time_over': 'Zeit!',
  'training.stop': 'Stopp', 'training.saved': '✓ gespeichert',
  'training.saved_ok': '✓ Erfolg gespeichert', 'training.saved_fail': '✗ Fehler gespeichert',
  'training.saved_hit': '✓ Treffer gespeichert', 'training.saved_miss': '✗ Fehler gespeichert',
  'training.hint_success': 'Knopf startet die Messung – dann ✓/✗ zum Stoppen.',
  'training.hint_measure': 'Knopf startet die Messung – Anzeige oder „Stopp“ beendet sie.',
  'training.save_failed': 'Speichern fehlgeschlagen.',
  'training.person': 'Person',

  // training — category editor
  'cat.title': 'Kategorie „%s“', 'cat.std': 'Standard',
  'cat.buttons': 'Angebotene Knöpfe', 'cat.both': '%1$s & %2$s', 'cat.only': 'nur %s',
  'cat.hide_counter': 'Zähler beim Laufen verbergen',
  'cat.window': 'Zeitfenster (optional, Sek.)', 'cat.from': 'Von', 'cat.to': 'Bis',
  'cat.window_hint': 'Innerhalb des Fensters grün, davor/danach orange, über dem Limit rot.',
  'cat.target': 'Ziel-Erfolgsquote (optional, %)',
  'cat.target_hint': 'Erreicht die Quote das Ziel, wird sie grün angezeigt, sonst orange.',

  // training — row menu
  'row.change_person': 'Person ändern…', 'row.change_cat': 'Kategorie ändern…',
  'row.delete': 'Eintrag löschen…', 'row.confirm_delete': 'Wirklich löschen?',
  'row.cat_prefix': 'Kategorie: %s',

  // training — evaluations
  'eval.day': 'Tagesauswertung', 'eval.person': 'Einzelauswertung',
  'eval.share': 'Teilen', 'eval.copied': 'In die Zwischenablage kopiert',
  'eval.pick_day': 'Tag wählen', 'eval.empty_day': 'Kein Training und keine Begegnungen an diesem Tag.',
  'eval.matches': 'Begegnungen', 'eval.empty_person': 'Keine Trainingsergebnisse für diese Person.',
  'eval.show_earlier': 'Frühere anzeigen', 'eval.today': 'Heute', 'eval.yesterday': 'Gestern',
  'eval.entries_n': '%s Trainingseinträge', 'eval.matches_n': ', %s Begegnungen',

  // training — hub cards (like the app's TrainingHub)
  'hub.daysummary': 'Tagesauswertung', 'hub.daysummary_desc': 'Alle Trainings & Begegnungen eines Tages',
  'hub.singleeval': 'Einzelauswertung', 'hub.singleeval_desc': 'Alle Trainings einer Person',
  'hub.successrate': 'Erfolgsquote', 'hub.successrate_desc': 'Treffer/Fehler zählen',
  'hub.timemeasure': 'Zeitmessung', 'hub.timemeasure_desc': 'Zeit am Stab messen (10s/15s)',
  'hub.timesuccess': 'Zeit & Erfolg', 'hub.timesuccess_desc': 'Zeit messen mit Erfolg/Fehler',
  'hub.recent': 'Letzte Einträge',

  // training — list / tab
  'training.empty': 'Keine Trainingsergebnisse', 'training.empty_day': ' an diesem Tag',

  // chart aria
  'chart.times': 'Trainingszeiten', 'chart.rate': 'Erfolgsquote', 'chart.target': 'Ziel %s%',

  // shared training deep link
  'shared.training_intro': 'Eine geteilte Trainings-Auswertung wurde mit dir geteilt. Melde dich an, um sie anzusehen.',
  'shared.training_loading': 'Geteilte Trainings-Auswertung wird geladen…',
  'shared.training_label': '%s · geteilte Tagesauswertung',
  'shared.training_empty': 'An diesem Tag wurden in dieser Gruppe keine Trainingseinträge erfasst.',
  'shared.training_open': 'In der Gruppe öffnen',
  'shared.training_notfound': 'Diese geteilte Auswertung wurde nicht gefunden. Möglicherweise bist du kein Mitglied der Gruppe.',
  'shared.training_error': 'Die Auswertung konnte nicht geladen werden. Bitte später erneut versuchen.',
}

const en: Record<string, string> = {
  'common.close': 'Close', 'common.cancel': 'Cancel', 'common.save': 'Save',
  'common.delete': 'Delete', 'common.back': '← Back', 'common.done': 'Done',
  'common.add': 'Add', 'common.overview': 'To overview', 'common.loading': 'Loading…',
  'common.retry_later': 'Please try again later.',

  'nav.matches': 'Matches', 'nav.training': 'Training',
  'menu.settings': 'Settings', 'menu.account': 'Account', 'menu.signout': 'Sign out',

  'settings.title': 'Settings', 'settings.design': 'Theme',
  'settings.system': 'System', 'settings.light': 'Light', 'settings.dark': 'Dark',
  'settings.language': 'Language', 'settings.lang_de': 'Deutsch', 'settings.lang_en': 'English',
  'settings.training': 'Training',
  'settings.rods_itsf': 'ITSF (10s / 15s)', 'settings.rods_saar': 'Saarland (20s)',
  'settings.countdown_desc': 'Count remaining time down instead of elapsed',
  'settings.countdown_note': 'The colour (green→amber→red) always follows the remaining time. Stored in the browser.',
  'settings.stats': 'Support development with anonymous statistics',
  'settings.stats_note': 'Entirely optional – default off, change any time. Stored in the browser.',
  'settings.terms_link': 'Privacy & Terms of Use',
  'settings.terms_title': 'Privacy & Terms of Use',

  'training.new': 'New training entry', 'training.kind_measure': 'Time measurement',
  'training.kind_success': 'Time & success', 'training.kind_outcome': 'Success rate',
  'training.name': 'Name', 'training.pick_person': 'Choose person',
  'training.category': 'Category', 'training.pick_category': 'Choose category',
  'training.window_label': 'Time window', 'training.hit': '✓ Hit', 'training.miss': '✗ Miss',
  'training.start': 'Start', 'training.running': 'running …', 'training.time_over': 'Time!',
  'training.stop': 'Stop', 'training.saved': '✓ saved',
  'training.saved_ok': '✓ Success saved', 'training.saved_fail': '✗ Fail saved',
  'training.saved_hit': '✓ Hit saved', 'training.saved_miss': '✗ Miss saved',
  'training.hint_success': 'Button starts the measurement – then ✓/✗ to stop.',
  'training.hint_measure': 'Button starts the measurement – the display or “Stop” ends it.',
  'training.save_failed': 'Saving failed.',
  'training.person': 'Person',

  'cat.title': 'Category “%s”', 'cat.std': 'Standard',
  'cat.buttons': 'Offered buttons', 'cat.both': '%1$s & %2$s', 'cat.only': 'only %s',
  'cat.hide_counter': 'Hide the counter while running',
  'cat.window': 'Time window (optional, sec.)', 'cat.from': 'From', 'cat.to': 'To',
  'cat.window_hint': 'Green inside the window, orange before/after, red beyond the limit.',
  'cat.target': 'Target success rate (optional, %)',
  'cat.target_hint': 'When the rate meets the target it shows green, otherwise orange.',

  'row.change_person': 'Change person…', 'row.change_cat': 'Change category…',
  'row.delete': 'Delete entry…', 'row.confirm_delete': 'Really delete?',
  'row.cat_prefix': 'Category: %s',

  'eval.day': 'Day summary', 'eval.person': 'Single evaluation',
  'eval.share': 'Share', 'eval.copied': 'Copied to clipboard',
  'eval.pick_day': 'Choose day', 'eval.empty_day': 'No training or matches on this day.',
  'eval.matches': 'Matches', 'eval.empty_person': 'No training results for this person.',
  'eval.show_earlier': 'Show earlier', 'eval.today': 'Today', 'eval.yesterday': 'Yesterday',
  'eval.entries_n': '%s training entries', 'eval.matches_n': ', %s matches',

  'hub.daysummary': 'Day summary', 'hub.daysummary_desc': 'All training & matches of a day',
  'hub.singleeval': 'Single evaluation', 'hub.singleeval_desc': 'All training of one person',
  'hub.successrate': 'Success rate', 'hub.successrate_desc': 'Count hits & misses',
  'hub.timemeasure': 'Time measurement', 'hub.timemeasure_desc': 'Measure time on the rod (10s/15s)',
  'hub.timesuccess': 'Time & success', 'hub.timesuccess_desc': 'Measure time with success/fail',
  'hub.recent': 'Recent entries',

  'training.empty': 'No training results', 'training.empty_day': ' on this day',

  'chart.times': 'Training times', 'chart.rate': 'Success rate', 'chart.target': 'target %s%',

  'shared.training_intro': 'A shared training summary was shared with you. Sign in to view it.',
  'shared.training_loading': 'Loading the shared training summary…',
  'shared.training_label': '%s · shared day summary',
  'shared.training_empty': 'No training entries were recorded in this group on this day.',
  'shared.training_open': 'Open in the group',
  'shared.training_notfound': 'This shared summary was not found. You may not be a member of the group.',
  'shared.training_error': 'The summary could not be loaded. Please try again later.',
}

const DICT: Record<Lang, Record<string, string>> = { de, en }
