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
  // "System" follows the browser locale (English coverage is complete across all
  // components); an explicit choice in Settings overrides it.
  try { return detectLang(navigator.language) } catch { return 'de' }
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
  'training.person': 'Person', 'training.undo_last': '↶ Letzte rückgängig', 'training.no_entries': 'Noch keine Einträge an diesem Tag.',

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

  // shell / menu
  'menu.account_sync': 'Konto & Sync', 'a11y.menu': 'Menü', 'a11y.menu_close': 'Menü schließen',
  'ctx.personal': 'Dein Konto', 'ctx.group_fallback': 'Gruppe',
  'common.back_word': 'Zurück',
  'install.prompt': 'Fooseroo Web als App installieren?', 'install.install': 'Installieren',
  'install.later': 'Später', 'install.ok': 'OK',
  'install.ios_pre': 'Installieren: unten auf ', 'install.ios_share': 'Teilen',
  'install.ios_mid': ' tippen, dann ', 'install.ios_a2hs': '„Zum Home-Bildschirm“', 'install.ios_end': '.',

  // match detail + shared match
  'match.edit': 'Bearbeiten', 'match.takeover': 'Übernehmen',
  'match.taken_over': 'Jemand anderes bearbeitet dieses Match gerade.',
  'match.read_on': '🔊  Vorlesen: an', 'match.read_off': '🔈  Vorlesen: aus',
  'shared.match_intro': 'Ein geteiltes Match wurde mit dir geteilt. Melde dich an, um es anzusehen.',
  'shared.match_loading': 'Geteiltes Match wird geladen…', 'shared.match_label': '%s · geteiltes Match',
  'shared.match_notfound': 'Dieses geteilte Match wurde nicht gefunden. Möglicherweise bist du kein Mitglied der Gruppe oder es wurde gelöscht.',
  'shared.match_error': 'Das Match konnte nicht geladen werden. Bitte später erneut versuchen.',

  // join
  'join.title': 'Gruppe beitreten',
  'join.invited_pre': 'Du wurdest in die Trainingsgruppe ', 'join.invited_post': ' eingeladen.',
  'join.retention': '🛡️ Ergebnisse in dieser Trainingsgruppe werden nach %s Tagen automatisch gelöscht.',
  'join.signin_named': 'Melde dich an, um der Gruppe „%s“ beizutreten.',
  'join.signin_generic': 'Melde dich an, um einer Trainingsgruppe beizutreten.',
  'join.enter_code': 'Gib den Beitritts-Code ein, den du erhalten hast.',
  'join.code_ph': 'Code (z. B. K7QF-3MZP)', 'join.joining': 'Trete bei…',
  'join.join_named': '„%s“ beitreten', 'join.join': 'Beitreten',
  'join.err_invalid': 'Code ungültig, deaktiviert oder abgelaufen.',
  'join.err_throttled': 'Zu viele Versuche – bitte später erneut.',
  'join.err_full': 'Diese Gruppe ist voll.',
  'join.err_generic': 'Beitritt fehlgeschlagen – bitte erneut versuchen.',

  // entitlement gate
  'gate.title': 'Backup & Sync und Trainingsgruppen sind in Vorbereitung.',
  'gate.body1': 'Wir testen diese Funktionen gerade mit einem eingeladenen Nutzerkreis und geben sie anschließend für alle frei.',
  'gate.body2': 'Du hast bereits Zugang, wenn du Mitglied einer Trainingsgruppe bist oder die Android-App „Backup & Sync“ nutzt. Tritt einer Gruppe per Code bei oder richte „Backup & Sync“ in der Android-App ein — danach erscheinen deine Inhalte hier automatisch.',
  'gate.android': 'Android-App',

  // filters
  'filter.category': 'Kategorie', 'filter.manage_cats': '✎ Kategorien verwalten', 'filter.all_persons': 'Alle Personen',

  // matches list
  'match.new': '＋ Neues Match', 'match.load_error': 'Matches konnten nicht geladen werden.',
  'match.empty_pre': 'Keine Matches', 'match.empty_sel': ' mit dieser Auswahl', 'match.empty_post': ' – erfasse welche in der App.',

  // auth
  'auth.signin_to_see': 'Melde dich an, um deine Matches & Trainings (und geteilte Inhalte) hier zu sehen.',
  'auth.email_ph': 'E-Mail-Adresse', 'auth.send_code': 'Code per E-Mail senden',
  'auth.code_from_pre': 'Code aus der E-Mail an ', 'auth.code_from_post': ':',
  'auth.code_hint': 'Gib den 6-stelligen Code direkt hier ein. Tippe nicht auf den Link in der E-Mail – er öffnet den Browser, nicht diese App.',
  'auth.code_ph': 'Code', 'auth.signin': 'Anmelden', 'auth.other_email': 'Andere E-Mail',

  // match editor / live counter
  'me.ready': 'Bereit', 'me.countdown': '%ss Countdown',
  'me.serve': 'Auflage', 'me.reset': 'Reset', 'me.timeout': 'Timeout', 'me.goal': 'Tor',
  'me.set_end': 'Satzende', 'me.match_end': 'Spielende',
  'me.delete_q': 'Match löschen?', 'me.end_q': 'Spiel beenden?',
  'me.end_save': 'Ergebnis und Spielverlauf werden gespeichert.',
  'me.end_discard': 'Ohne Tore wird das Spiel verworfen.',
  'me.delete_dots': 'Löschen…', 'me.team_left': 'Team links', 'me.team_right': 'Team rechts',
  'me.discard_failed': 'Verwerfen fehlgeschlagen.',
  'me.history': 'Spielverlauf', 'me.undo': 'Rückgängig', 'me.swap': 'Seiten tauschen', 'me.more': 'Mehr',
  'me.reset_warning': 'Reset Warning', 'me.reset_violation': 'Reset Violation',
  'me.timeouts_1': '1 Timeout', 'me.timeouts_2': '2 Timeouts', 'me.not_saved': 'Nicht gespeichert – Verbindung?',

  // category editor (match categories)
  'ce.title': 'Kategorien verwalten', 'ce.new_ph': 'Neue Kategorie',
  'ce.exists': 'Diese Kategorie gibt es schon.', 'ce.action_failed': 'Aktion fehlgeschlagen.',
  'ce.default_hint': 'Standardkategorie für neue Matches.', 'ce.make_default': 'Als Standard',
  'ce.rename': 'Umbenennen', 'ce.confirm_delete_cat': 'Kategorie „%s“ löschen?',
  'ce.head': 'Kategorien', 'ce.delete_to': '„%s“ löschen → Matches nach:',
  'a11y.up': 'hoch', 'a11y.down': 'runter',

  // onboarding
  'ob.terms_text': 'Ich habe die Nutzungs- und Datenschutzbedingungen gelesen und akzeptiere sie.',
  'ob.welcome': 'Willkommen bei Fooseroo', 'ob.continue': 'Weiter', 'ob.start': 'Los geht’s!',
  'ob.accept_btn': 'Akzeptieren & Loslegen',
  'ob.intro': 'Drei Bereiche, ein Ziel: mehr aus deinem Tischfußball machen.',
  'ob.liga_title': '🏆  Liga', 'ob.matches_title': '⚪  Matches', 'ob.training_title': '⏱️  Training',
  'ob.liga_text': 'Verfolge deine Ligen live – Tabellen, Mannschaften, Spieler und jede Begegnung mit Live-Ticker. Setz ★ auf deine Favoriten und lass dich benachrichtigen oder vorlesen, sobald es losgeht.',
  'ob.matches_text': 'Zähl deine eigenen Spiele mit: Punkte, Sätze und Statistik in Echtzeit – und teile das Ergebnis als schicke Grafik',
  'ob.training_text': 'Werde messbar besser – Zeitmessung, Zeitgefühl und Erfolgsquote, mit Verlauf, Tageszusammenfassung und Auswertung je Person.',
  'ob.stats_note': 'Ganz freiwillig – jederzeit in den Einstellungen änderbar.',
  'ob.footnote': ' Diese Funktion ist der Fooseroo-App für Android vorbehalten und in der Webversion nicht enthalten.',

  // account
  'acc.title': 'Konto & Sync',
  'acc.intro': 'Wähle, wo deine Matches und Trainings gespeichert werden.',
  'acc.backup': 'Backup & Sync', 'acc.backup_desc': 'Sichern und auf deinen Geräten synchron halten.',
  'acc.signed_in_as': 'Angemeldet als', 'acc.signout_q': 'Nur dieses Gerät abmelden, oder alle Geräte? Deine Daten bleiben erhalten.',
  'acc.this_device': 'Dieses Gerät', 'acc.all_devices': 'Alle Geräte',
  'acc.signin_create': 'Anmelden / Konto anlegen', 'acc.send_code': 'Code senden',
  'acc.code_hint': 'Gib den Code ein, den wir dir per E-Mail geschickt haben.', 'acc.confirm': 'Bestätigen',
  'acc.group': 'Trainingsgruppe', 'acc.group_desc': 'Gemeinsam in Echtzeit eintragen.',
  'acc.owner': 'Inhaber:in', 'acc.manage': 'Verwalten', 'acc.display_name_ph': 'Mein Anzeigename',
  'acc.my_name_is': 'Mein Anzeigename: %s', 'acc.set_name': 'Anzeigename festlegen',
  'acc.owner_hint': 'Als Inhaber:in: Mitglieder verwalten, umbenennen oder löschen in der App.',
  'acc.leave_q': '„%s“ wirklich verlassen? Du verlierst den Zugriff auf die Gruppendaten.',
  'acc.leave': 'Verlassen', 'acc.leave_group': 'Gruppe verlassen',
  'acc.full_admin_hint': 'Volle Verwaltung (Mitglieder, Rollen, Tarife): in der Fooseroo-App für Android.',
  'acc.name_dup': 'Dieser Name wird in der Gruppe bereits verwendet.',
  'acc.save_failed': 'Konnte nicht gespeichert werden.', 'acc.leave_failed': 'Verlassen fehlgeschlagen.',

  // group management
  'gm.load_failed': 'Konnte die Gruppe nicht laden.', 'gm.delete_failed': 'Löschen fehlgeschlagen.',
  'gm.moderator': 'Moderator:in', 'gm.member': 'Mitglied',
  'gm.join_code': 'Beitritts-Code', 'gm.regen': 'Neu erzeugen', 'gm.join_enabled': 'Beitritt per Code erlaubt',
  'gm.code_valid_until': 'Code gültig bis einschließlich %s',
  'gm.code_invalid': 'Kein gültiger Code mehr verfügbar.', 'gm.code_generate': 'Code erzeugen',
  'gm.retention_confirm': 'Wirklich speichern? Alle abgeschlossenen Ergebnisse, die älter als %s Tage sind, werden unwiderruflich gelöscht.',
  'gm.retention_save': 'Löschen & speichern',
  'gm.default_access': 'Standard-Zugriff neuer Mitglieder:', 'gm.write': 'Schreiben', 'gm.read': 'Nur lesen',
  'gm.members': 'Mitglieder (%s)', 'gm.no_name': 'Ohne Namen', 'gm.you': '(du)', 'gm.remove': 'Entfernen',
  'gm.retention_title': 'Ergebnisse automatisch löschen',
  'gm.retention_hint': 'Tage, nach denen abgeschlossene Ergebnisse gelöscht werden (leer = aus).',
  'gm.off': 'aus', 'gm.danger_zone': 'Gefahrenzone', 'gm.delete_group': 'Gruppe löschen',
  'gm.delete_warn_pre': 'Das löscht die Gruppe samt aller Daten für alle Mitglieder – unwiderruflich. Tippe zum Bestätigen den Namen ',
  'gm.delete_warn_post': ' ein.', 'gm.delete_final': 'Endgültig löschen',
  'gm.delete_confirm1': 'Diese Gruppe und alle geteilten Daten werden für alle Mitglieder endgültig gelöscht. Wirklich fortfahren?',
  'gm.delete_continue': 'Fortfahren',
  'gm.make_owner': 'Zum Eigentümer machen',
  'gm.transfer_confirm': 'Willst du %s wirklich zum Eigentümer dieser Gruppe machen? Du bist danach nur noch Moderator. Tippe zum Bestätigen den Gruppennamen ein.',
  'gm.transfer_final': 'Eigentümer übertragen',
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
  'training.person': 'Person', 'training.undo_last': '↶ Undo last', 'training.no_entries': 'No entries on this day yet.',

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

  'menu.account_sync': 'Account & Sync', 'a11y.menu': 'Menu', 'a11y.menu_close': 'Close menu',
  'ctx.personal': 'Your account', 'ctx.group_fallback': 'Group',
  'common.back_word': 'Back',
  'install.prompt': 'Install Fooseroo Web as an app?', 'install.install': 'Install',
  'install.later': 'Later', 'install.ok': 'OK',
  'install.ios_pre': 'To install: tap ', 'install.ios_share': 'Share',
  'install.ios_mid': ' below, then ', 'install.ios_a2hs': '“Add to Home Screen”', 'install.ios_end': '.',

  'match.edit': 'Edit', 'match.takeover': 'Take over',
  'match.taken_over': 'Someone else is now editing this match.',
  'match.read_on': '🔊  Read aloud: on', 'match.read_off': '🔈  Read aloud: off',
  'shared.match_intro': 'A match was shared with you. Sign in to view it.',
  'shared.match_loading': 'Loading the shared match…', 'shared.match_label': '%s · shared match',
  'shared.match_notfound': 'This shared match was not found. You may not be a member of the group, or it was deleted.',
  'shared.match_error': 'The match could not be loaded. Please try again later.',

  'join.title': 'Join group',
  'join.invited_pre': "You've been invited to the training group ", 'join.invited_post': '.',
  'join.retention': '🛡️ Results in this training group are automatically deleted after %s days.',
  'join.signin_named': 'Sign in to join the group “%s”.',
  'join.signin_generic': 'Sign in to join a training group.',
  'join.enter_code': 'Enter the join code you received.',
  'join.code_ph': 'Code (e.g. K7QF-3MZP)', 'join.joining': 'Joining…',
  'join.join_named': 'Join “%s”', 'join.join': 'Join',
  'join.err_invalid': 'Code invalid, disabled or expired.',
  'join.err_throttled': 'Too many attempts – please try again later.',
  'join.err_full': 'This group is full.',
  'join.err_generic': 'Joining failed – please try again.',

  'gate.title': 'Backup & Sync and training groups are in preparation.',
  'gate.body1': "We're currently testing these features with an invited group of users and will release them to everyone afterwards.",
  'gate.body2': 'You already have access if you are a member of a training group or use the Android app’s “Backup & Sync”. Join a group with a code or set up “Backup & Sync” in the Android app — your content then appears here automatically.',
  'gate.android': 'Android app',

  'filter.category': 'Category', 'filter.manage_cats': '✎ Manage categories', 'filter.all_persons': 'All people',

  'match.new': '＋ New match', 'match.load_error': 'Matches could not be loaded.',
  'match.empty_pre': 'No matches', 'match.empty_sel': ' for this selection', 'match.empty_post': ' – record some in the app.',

  'auth.signin_to_see': 'Sign in to see your matches & training (and shared content) here.',
  'auth.email_ph': 'Email address', 'auth.send_code': 'Send code by email',
  'auth.code_from_pre': 'Code from the email to ', 'auth.code_from_post': ':',
  'auth.code_hint': 'Enter the 6-digit code directly here. Do not tap the link in the email – it opens the browser, not this app.',
  'auth.code_ph': 'Code', 'auth.signin': 'Sign in', 'auth.other_email': 'Different email',

  'me.ready': 'Ready', 'me.countdown': '%ss countdown',
  'me.serve': 'Serve', 'me.reset': 'Reset', 'me.timeout': 'Timeout', 'me.goal': 'Goal',
  'me.set_end': 'End set', 'me.match_end': 'Match end',
  'me.delete_q': 'Delete match?', 'me.end_q': 'End match?',
  'me.end_save': 'The result and match history will be saved.',
  'me.end_discard': 'Without goals the match is discarded.',
  'me.delete_dots': 'Delete…', 'me.team_left': 'Team left', 'me.team_right': 'Team right',
  'me.discard_failed': 'Discard failed.',
  'me.history': 'Match history', 'me.undo': 'Undo', 'me.swap': 'Swap sides', 'me.more': 'More',
  'me.reset_warning': 'Reset Warning', 'me.reset_violation': 'Reset Violation',
  'me.timeouts_1': '1 timeout', 'me.timeouts_2': '2 timeouts', 'me.not_saved': 'Not saved – connection?',

  'ce.title': 'Manage categories', 'ce.new_ph': 'New category',
  'ce.exists': 'This category already exists.', 'ce.action_failed': 'Action failed.',
  'ce.default_hint': 'Default category for new matches.', 'ce.make_default': 'Set default',
  'ce.rename': 'Rename', 'ce.confirm_delete_cat': 'Delete category “%s”?',
  'ce.head': 'Categories', 'ce.delete_to': 'Delete “%s” → move matches to:',
  'a11y.up': 'up', 'a11y.down': 'down',

  'ob.terms_text': 'I have read and accept the terms of use and privacy policy.',
  'ob.welcome': 'Welcome to Fooseroo', 'ob.continue': 'Continue', 'ob.start': "Let's go!",
  'ob.accept_btn': 'Accept & get started',
  'ob.intro': 'Three areas, one goal: get more out of your table football.',
  'ob.liga_title': '🏆  Leagues', 'ob.matches_title': '⚪  Matches', 'ob.training_title': '⏱️  Training',
  'ob.liga_text': 'Follow your leagues live – standings, teams, players and every match with a live ticker. Star ★ your favourites and get notified or read aloud as soon as it kicks off.',
  'ob.matches_text': 'Count your own games: points, sets and stats in real time – and share the result as a slick graphic',
  'ob.training_text': 'Get measurably better – time measurement, time feeling and success rate, with history, day summary and a per-person evaluation.',
  'ob.stats_note': 'Entirely optional – change any time in Settings.',
  'ob.footnote': ' This feature is reserved for the Fooseroo Android app and is not included in the web version.',

  'acc.title': 'Account & Sync',
  'acc.intro': 'Choose where your matches and training are stored.',
  'acc.backup': 'Backup & Sync', 'acc.backup_desc': 'Back up and keep in sync across your devices.',
  'acc.signed_in_as': 'Signed in as', 'acc.signout_q': 'Sign out this device only, or all devices? Your data is kept.',
  'acc.this_device': 'This device', 'acc.all_devices': 'All devices',
  'acc.signin_create': 'Sign in / create account', 'acc.send_code': 'Send code',
  'acc.code_hint': 'Enter the code we sent you by email.', 'acc.confirm': 'Confirm',
  'acc.group': 'Training group', 'acc.group_desc': 'Record together in real time.',
  'acc.owner': 'Owner', 'acc.manage': 'Manage', 'acc.display_name_ph': 'My display name',
  'acc.my_name_is': 'My display name: %s', 'acc.set_name': 'Set display name',
  'acc.owner_hint': 'As owner: manage members, rename or delete in the app.',
  'acc.leave_q': 'Really leave “%s”? You will lose access to the group data.',
  'acc.leave': 'Leave', 'acc.leave_group': 'Leave group',
  'acc.full_admin_hint': 'Full administration (members, roles, plans): in the Fooseroo Android app.',
  'acc.name_dup': 'This name is already used in the group.',
  'acc.save_failed': 'Could not be saved.', 'acc.leave_failed': 'Leaving failed.',

  'gm.load_failed': 'Could not load the group.', 'gm.delete_failed': 'Deletion failed.',
  'gm.moderator': 'Moderator', 'gm.member': 'Member',
  'gm.join_code': 'Join code', 'gm.regen': 'Regenerate', 'gm.join_enabled': 'Joining by code allowed',
  'gm.code_valid_until': 'Code valid through %s',
  'gm.code_invalid': 'No valid code available anymore.', 'gm.code_generate': 'Generate code',
  'gm.retention_confirm': 'Really save? All completed results older than %s days will be permanently deleted.',
  'gm.retention_save': 'Delete & save',
  'gm.default_access': 'Default access for new members:', 'gm.write': 'Write', 'gm.read': 'Read only',
  'gm.members': 'Members (%s)', 'gm.no_name': 'No name', 'gm.you': '(you)', 'gm.remove': 'Remove',
  'gm.retention_title': 'Auto-delete results',
  'gm.retention_hint': 'Days after which completed results are deleted (empty = off).',
  'gm.off': 'off', 'gm.danger_zone': 'Danger zone', 'gm.delete_group': 'Delete group',
  'gm.delete_warn_pre': 'This deletes the group and all its data for every member – irreversibly. Type the name ',
  'gm.delete_warn_post': ' to confirm.', 'gm.delete_final': 'Delete permanently',
  'gm.delete_confirm1': 'This group and all its shared data will be permanently deleted for every member. Really continue?',
  'gm.delete_continue': 'Continue',
  'gm.make_owner': 'Make owner',
  'gm.transfer_confirm': 'Make %s the owner of this group? You will then only be a moderator. Type the group name to confirm.',
  'gm.transfer_final': 'Transfer ownership',
}

const DICT: Record<Lang, Record<string, string>> = { de, en }
