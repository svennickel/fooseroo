<script lang="ts">
  // Settings dialog (from the three-dot menu) — mirrors the app's settings: language,
  // theme (System/Light/Dark), training (rod limits + countdown direction),
  // anonymous-statistics consent (default off) and a read-only "Privacy & Terms".
  import Terms from './Terms.svelte'
  import { getTheme, applyTheme, analyticsEnabled, setAnalytics, type ThemeMode } from './prefs'
  import { rodMode, setRodMode, countdownDescending, setCountdownDescending, type RodMode } from './trainingprefs'
  import { t, getLangPref, setLangPref, type LangPref } from './i18n.svelte'

  let { onClose }: { onClose: () => void } = $props()

  let theme = $state<ThemeMode>(getTheme())
  let stats = $state(analyticsEnabled())
  let rods = $state<RodMode>(rodMode())
  let descending = $state(countdownDescending())
  let langPref = $state<LangPref>(getLangPref())
  let showTerms = $state(false)

  function pickTheme(m: ThemeMode) { theme = m; applyTheme(m) }
  function toggleStats() { stats = !stats; setAnalytics(stats) }
  function pickRods(m: RodMode) { rods = m; setRodMode(m) }
  function toggleDescending() { descending = !descending; setCountdownDescending(descending) }
  function pickLang(p: LangPref) { langPref = p; setLangPref(p) }

  const THEMES = $derived<{ v: ThemeMode; label: string }[]>([
    { v: 'system', label: t('settings.system') }, { v: 'light', label: t('settings.light') }, { v: 'dark', label: t('settings.dark') }
  ])
  const LANGS = $derived<{ v: LangPref; label: string }[]>([
    { v: 'system', label: t('settings.system') }, { v: 'de', label: 'Deutsch' }, { v: 'en', label: 'English' }
  ])
  const RODS = $derived<{ v: RodMode; label: string }[]>([
    { v: 'ITSF', label: t('settings.rods_itsf') }, { v: 'Saarland', label: t('settings.rods_saar') }
  ])
</script>

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
  <div class="sheet">
    {#if showTerms}
      <div class="head">
        <button class="ghost small" onclick={() => (showTerms = false)}>{t('common.back')}</button>
        <strong>{t('settings.terms_title')}</strong>
      </div>
      <div class="scroll"><Terms /></div>
    {:else}
      <div class="head">
        <strong>{t('settings.title')}</strong>
        <button class="ghost small" onclick={onClose}>{t('common.close')}</button>
      </div>
      <div class="scroll">
        <div class="label">{t('settings.language')}</div>
        <div class="seg">
          {#each LANGS as opt}
            <button class="segbtn" class:active={langPref === opt.v} onclick={() => pickLang(opt.v)}>{opt.label}</button>
          {/each}
        </div>

        <div class="label">{t('settings.design')}</div>
        <div class="seg">
          {#each THEMES as opt}
            <button class="segbtn" class:active={theme === opt.v} onclick={() => pickTheme(opt.v)}>{opt.label}</button>
          {/each}
        </div>

        <div class="label">{t('settings.training')}</div>
        <div class="seg">
          {#each RODS as opt}
            <button class="segbtn" class:active={rods === opt.v} onclick={() => pickRods(opt.v)}>{opt.label}</button>
          {/each}
        </div>
        <button class="switchrow" onclick={toggleDescending} aria-pressed={descending}>
          <span>{t('settings.countdown_desc')}</span>
          <span class="sw" class:on={descending}><span class="knob"></span></span>
        </button>
        <p class="note">{t('settings.countdown_note')}</p>

        <button class="switchrow" onclick={toggleStats} aria-pressed={stats}>
          <span>{t('settings.stats')}</span>
          <span class="sw" class:on={stats}><span class="knob"></span></span>
        </button>
        <p class="note">{t('settings.stats_note')}</p>

        <button class="linkrow" onclick={() => (showTerms = true)}>
          {t('settings.terms_link')}
          <span class="chev">›</span>
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Settings is the ONE dialog that fully covers the bottom nav → above it (z 1001). */
  .overlay { position: fixed; inset: 0; z-index: 1001; background: rgba(0,0,0,.45);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; max-height: 86vh; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); gap: 10px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .head strong { font-size: 17px; }
  .scroll { overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .label { font-weight: 700; color: var(--team-a); font-size: 13px; margin: 6px 0 6px; }
  .seg { display: flex; gap: 6px; background: var(--surface-variant); padding: 4px; border-radius: 12px; }
  .segbtn { flex: 1; background: transparent; color: var(--on-surface-variant); border: 0;
    padding: 9px 8px; border-radius: 9px; font-weight: 700; font-size: 14px; cursor: pointer; }
  .segbtn.active { background: var(--surface); color: var(--team-a); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  .switchrow { display: flex; align-items: center; justify-content: space-between; gap: 14px;
    width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--outline);
    border-radius: 12px; padding: 14px; margin-top: 14px; color: var(--on-surface); font-size: 14px;
    cursor: pointer; }
  .sw { flex: 0 0 auto; width: 44px; height: 26px; border-radius: 999px; background: var(--outline);
    position: relative; transition: background .15s; }
  .sw.on { background: var(--team-a); }
  .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
    background: #fff; transition: transform .15s; }
  .sw.on .knob { transform: translateX(18px); }
  .note { font-size: 12px; color: var(--on-surface-variant); margin: 6px 2px 0; }
  .linkrow { display: flex; align-items: center; justify-content: space-between; width: 100%;
    text-align: left; background: var(--surface); border: 1px solid var(--outline); border-radius: 12px;
    padding: 14px; margin-top: 16px; color: var(--team-a); font-size: 14px; font-weight: 600; cursor: pointer; }
  .chev { font-size: 20px; line-height: 1; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 10px; padding: 6px 10px; font-size: 13px; font-weight: 600; cursor: pointer; }
</style>
