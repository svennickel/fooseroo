import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

// Built to ../app and served at fooseroo.app/app/ (relative base, so it also
// works under svennickel.github.io/fooseroo/app/). The static landing page at the
// repo root stays untouched.
export default defineConfig({
  base: './',
  build: { outDir: '../app', emptyOutDir: true },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.png'],
      manifest: {
        // Launcher name differs from the Play Store app ("Fooseroo") so the
        // installed PWA is distinguishable on the home screen.
        name: 'Fooseroo Web',
        short_name: 'Fooseroo Web',
        description: 'Matches & Training: Tischfußball mitzählen, auswerten, live mitverfolgen.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#E8F0FB',
        theme_color: '#1565C0',
        icons: [{ src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
      },
      workbox: { navigateFallback: 'index.html' }
    })
  ]
})
