<script lang="ts">
  // Privacy & terms content — identical wording for web and app, and describing
  // BOTH. Used by the onboarding gate and the settings ("Datenschutz &
  // Nutzungsbedingungen"). Footnote ¹ marks features reserved for the Android app.
</script>

<div class="terms">
  <h2>Willkommen bei Fooseroo ⚪</h2>
  <p class="intro">Bevor du loslegst, kurz zur Transparenz: So gehen wir mit deinen Daten um. Diese
    Hinweise gelten gleichermaßen für die Fooseroo-App (Android) und die Webversion.</p>

  <h3>1. Standardmäßig bleibt alles lokal</h3>
  <p>Deine Spiele, Trainings und Einstellungen werden standardmäßig nur lokal auf deinem Gerät bzw.
    in deinem Browser gespeichert. Sie verlassen dein Gerät erst, wenn du dich für „Backup &amp; Sync"
    anmeldest oder eine Trainingsgruppe nutzt (siehe Punkt 3).</p>

  <h3>2. Liga-Daten von Drittanbietern <sup>¹</sup></h3>
  <p>Tabellen, Begegnungen, Spielpläne und die Verbandsstruktur werden nur lesend von der öffentlichen
    Schnittstelle deines Verbands geladen – die Inhalte stammen vom jeweiligen Verband, auf den wir
    keinen Einfluss haben. Zur besseren Nutzererfahrung werden diese Ligadaten vorübergehend im
    internen App-Speicher (für andere Apps nicht zugänglich) zwischengespeichert. Maximale
    Speicherdauern: Verbandsstruktur 30 Tage, Spielpläne 7 Tage, abgeschlossene Ergebnisse 90 Tage,
    Tabellenstände 24 Stunden; laufende Ergebnisse werden nicht dauerhaft gespeichert. Nach Ablauf
    werden die Daten automatisch verworfen; eine Weitergabe an Dritte findet nicht statt. Verbände
    können der Nutzung ihrer Daten jederzeit widersprechen; in diesem Fall werden alle Daten des
    betreffenden Verbands umgehend und vollständig entfernt. Ein Link oder eine Grafik verlässt dein
    Gerät nur, wenn du aktiv auf „Teilen" tippst.</p>

  <h3>3. Konto, Backup &amp; Sync, Trainingsgruppen</h3>
  <p>Optional kannst du ein Konto per E-Mail-Code anlegen. Dann werden deine Spiele, Trainings,
    Kategorien und Favoriten zur Sicherung und Synchronisation auf unserem Server (Supabase)
    gespeichert; in einer Trainingsgruppe teilst du diese Daten mit deren Mitgliedern. Rechtsgrundlage
    ist die Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO). Ohne Anmeldung findet keine Übertragung
    statt.</p>
  <p>Der Eigentümer einer Trainingsgruppe kann optional eine Aufbewahrungsfrist (in Tagen) festlegen,
    nach der die Ergebnisse der Gruppe automatisch gelöscht werden. Die genaue Verdrängungsstrategie:</p>
  <ul>
    <li>Der Abgleich läuft täglich um <strong>04:00 Uhr</strong> in der vom Eigentümer eingestellten
      Zeitzone (anfänglich die Zeitzone des Geräts, mit dem die Gruppe angelegt wurde).</li>
    <li><strong>Stufe 1 – nach Ablauf der Frist:</strong> Matches und Trainings, die älter als die
      eingestellte Zahl Tage sind, werden für alle Mitglieder <strong>ausgeblendet</strong> (sofort
      nicht mehr sichtbar), intern aber noch <strong>bis zu 7 Tage</strong> vorgehalten, damit eine
      Wiederherstellung möglich ist. Ein gerade laufendes Spiel wird nicht angetastet.</li>
    <li><strong>Stufe 2 – nach diesen 7 Tagen Schonfrist:</strong> werden die Ergebnisse
      <strong>endgültig und unwiderruflich</strong> gelöscht.</li>
  </ul>
  <p>Wenn die automatische Löschung in einer Gruppe aktiv ist, weist die Anzeige unter „Matches" und
    „Training" sichtbar darauf hin.</p>

  <h3>Juristische Details (Datenschutz)</h3>
  <p>Verantwortliche Person: Sven Nickel (ÆquiNode Studio)<br />Kontakt: sven.nickel@gmail.com</p>
  <p>Falls aktiviert, verarbeiten wir anonyme Nutzungsstatistiken auf Grundlage deiner Einwilligung
    (Art. 6 Abs. 1 lit. a DSGVO), die du jederzeit in den Einstellungen widerrufen kannst (Standard:
    aus).</p>
  <p>Lokale Daten lassen sich durch Deinstallation der App bzw. Löschen der Browserdaten restlos
    entfernen. Hast du ein Konto, kannst du dich jederzeit abmelden; dabei werden die Konto- und
    Trainingsgruppen-Inhalte vom Gerät entfernt. Liga-Daten werden nicht dauerhaft gespeichert (siehe
    Punkt 2).</p>

  <p class="fn"><sup>¹</sup> Die Liga-Ansicht (Verbandsdaten, Live-Ticker, Benachrichtigungen) sowie
    das Teilen als Grafik sind der <strong>Fooseroo-App für Android</strong> vorbehalten und in der
    Webversion nicht enthalten.</p>
</div>

<style>
  .terms { color: var(--on-surface); font-size: 14px; line-height: 1.55; }
  .terms h2 { font-size: 20px; margin: 0 0 6px; }
  .terms h3 { font-size: 15px; margin: 16px 0 4px; color: var(--team-a); }
  .terms p { margin: 0 0 8px; }
  .terms ul { margin: 4px 0 10px; padding-left: 20px; }
  .terms li { margin: 0 0 6px; }
  .terms .intro { color: var(--on-surface-variant); }
  .terms .fn { margin-top: 16px; font-size: 12px; color: var(--on-surface-variant);
    border-top: 1px solid var(--outline); padding-top: 10px; }
  .terms sup { color: var(--team-a); font-weight: 700; }
</style>
