<script lang="ts">
  // First-run gate, mirroring the app: terms must be ACCEPTED before the app is
  // reachable, then a welcome screen. The originally-called URL stays untouched
  // (this is an overlay; we never navigate), so it is presented once the gate is
  // done. Acceptance + onboarding-shown + analytics consent persist in the browser.
  import Terms from './Terms.svelte'
  import { termsAccepted, markTermsAccepted, markOnboardingShown, analyticsEnabled, setAnalytics } from './prefs'
  import { t } from './i18n.svelte'

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
        <span>{t('ob.terms_text')}</span>
      </label>
      <button class="primary" disabled={!agreed} onclick={accept}>{t('ob.accept_btn')}</button>
    {:else}
      <div class="scroll">
        <h2>{t('ob.welcome')}</h2>
        <p class="intro">{t('ob.intro')}</p>

        <div class="area">
          <div class="atitle">{t('ob.liga_title')} <sup>¹</sup></div>
          <p>{t('ob.liga_text')}</p>
        </div>
        <div class="area">
          <div class="atitle">{t('ob.matches_title')}</div>
          <p>{t('ob.matches_text')}<sup>¹</sup>.</p>
        </div>
        <div class="area">
          <div class="atitle">{t('ob.training_title')}</div>
          <p>{t('ob.training_text')}</p>
        </div>

        <label class="agree toggle">
          <span>{t('settings.stats')}</span>
          <span class="sw"><input type="checkbox" bind:checked={stats} /><span class="slider"></span></span>
        </label>
        <p class="note">{t('ob.stats_note')}</p>
        <p class="fn"><sup>¹</sup>{t('ob.footnote')}</p>
      </div>
      <button class="primary" onclick={start}>{t('ob.start')}</button>
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
  /* the stats opt-in is a preference → a toggle switch (iOS optic), not a checkbox */
  .agree.toggle { align-items: center; justify-content: space-between; }
  .sw { position: relative; width: 46px; height: 28px; flex: 0 0 auto; margin: 0; }
  .sw input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
  .sw .slider { position: absolute; inset: 0; background: var(--outline); border-radius: 999px; transition: background .2s; }
  .sw .slider::before { content: ''; position: absolute; width: 24px; height: 24px; left: 2px; top: 2px;
    background: #fff; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,.3); transition: transform .2s; }
  .sw input:checked + .slider { background: var(--ok); }
  .sw input:checked + .slider::before { transform: translateX(18px); }
  .note { font-size: 12px; color: var(--on-surface-variant); margin: 6px 0 0; }
  .fn { font-size: 12px; color: var(--on-surface-variant); margin: 14px 0 0;
    border-top: 1px solid var(--outline); padding-top: 10px; }
  sup { color: var(--team-a); font-weight: 700; }
  .primary { background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 12px;
    padding: 14px; font-size: 16px; font-weight: 700; cursor: pointer; }
  .primary:disabled { opacity: .5; cursor: default; }
</style>
