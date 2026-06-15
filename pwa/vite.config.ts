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
        name: 'Fooseroo',
        short_name: 'Fooseroo',
        description: 'Matches & Training: Tischfußball mitzählen, auswerten, live mitverfolgen.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0e1a12',
        theme_color: '#0e1a12',
        icons: [{ src: 'icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
      },
      workbox: { navigateFallback: 'index.html' }
    })
  ]
})
