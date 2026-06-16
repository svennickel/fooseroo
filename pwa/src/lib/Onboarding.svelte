<script lang="ts">
  // First-run gate, mirroring the app: terms must be ACCEPTED before the app is
  // reachable, then a welcome screen. The originally-called URL stays untouched
  // (this is an overlay; we never navigate), so it is presented once the gate is
  // done. Acceptance + onboarding-shown + analytics consent persist in the browser.
  import Terms from './Terms.svelte'
  import { termsAccepted, markTermsAccepted, markOnboardingShown, analyticsEnabled, setAnalytics } from './prefs'

  let { onDone }: { onDone: () => void } = $props()

  let step = $state<'terms' | 'welcome'>(termsAccepted() ? 'welcome' : 'terms')
  let agreed = $state(false)
  let stats = $state(analyticsEnabled())

  function accept() {
    if (!agreed) return
    markTermsAccepted()
    step = 'welcome'
  }
  function start() {
    setAnalytics(stats)
    markOnboardingShown()
    onDone()
  }
</script>

<div class="overlay">
  <div class="sheet">
    {#if step === 'terms'}
      <div class="scroll"><Terms /></div>
      <label class="agree">
        <input type="checkbox" bind:checked={agreed} />
        <span>Ich habe die Nutzungs- und Datenschutzbedingungen gelesen und akzeptiere sie.</span>
      </label>
      <button class="primary" disabled={!agreed} onclick={accept}>Akzeptieren &amp; Loslegen</button>
    {:else}
      <div class="scroll">
        <h2>Willkommen bei Fooseroo</h2>
        <p class="intro">Drei Bereiche, ein Ziel: mehr aus deinem Tischfußball machen.</p>

        <div class="area">
          <div class="atitle">🏆&nbsp; Liga <sup>¹</sup></div>
          <p>Verfolge deine Ligen live – Tabellen, Mannschaften, Spieler und jede Begegnung mit
            Live-Ticker. Setz ★ auf deine Favoriten und lass dich benachrichtigen oder vorlesen,
            sobald es losgeht.</p>
        </div>
        <div class="area">
          <div class="atitle">⚪&nbsp; Matches</div>
          <p>Zähl deine eigenen Spiele mit: Punkte, Sätze und Statistik in Echtzeit – und teile das
            Ergebnis als schicke Grafik<sup>¹</sup>.</p>
        </div>
        <div class="area">
          <div class="atitle">⏱️&nbsp; Training</div>
          <p>Werde messbar besser – Zeitmessung, Zeitgefühl und Erfolgsquote, mit Verlauf,
            Tageszusammenfassung und Auswertung je Person.</p>
        </div>

        <label class="agree">
          <input type="checkbox" bind:checked={stats} />
          <span>Unterstütze die Weiterentwicklung über anonyme Statistiken</span>
        </label>
        <p class="note">Ganz freiwillig – jederzeit in den Einstellungen änderbar.</p>
        <p class="fn"><sup>¹</sup> Diese Funktion ist der Fooseroo-App für Android vorbehalten und in
          der Webversion nicht enthalten.</p>
      </div>
      <button class="primary" onclick={start}>Los geht's!</button>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 1000; background: var(--bg);
    display: flex; align-items: stretch; justify-content: center;
    padding: calc(12px + env(safe-area-inset-top, 0px)) 14px calc(14px + env(safe-area-inset-bottom, 0px)); }
  .sheet { width: 100%; max-width: 440px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  .scroll { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  h2 { font-size: 22px; margin: 4px 0 6px; color: var(--team-a); }
  .intro { color: var(--on-surface-variant); margin: 0 0 14px; }
  .area { background: var(--surface); border: 1px solid var(--outline); border-radius: 14px;
    padding: 12px 14px; margin-bottom: 10px; }
  .atitle { font-weight: 800; font-size: 16px; margin-bottom: 4px; }
  .area p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--on-surface); }
  .agree { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; line-height: 1.45;
    background: var(--surface); border: 1px solid var(--outline); border-radius: 12px; padding: 12px; }
  .agree input { width: 20px; height: 20px; margin-top: 1px; flex: 0 0 auto; accent-color: var(--team-a); }
  .note { font-size: 12px; color: var(--on-surface-variant); margin: 6px 0 0; }
  .fn { font-size: 12px; color: var(--on-surface-variant); margin: 14px 0 0;
    border-top: 1px solid var(--outline); padding-top: 10px; }
  sup { color: var(--team-a); font-weight: 700; }
  .primary { background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 12px;
    padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; }
  .primary:disabled { opacity: .5; cursor: default; }
</style>
