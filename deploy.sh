#!/usr/bin/env bash
# Local Cloudflare deploy for fooseroo.app.
#
# fooseroo.app is a Cloudflare Worker ("fooseroo") serving STATIC ASSETS (no
# bindings). This replaces the git-push auto-build (Workers Builds): it builds the
# PWA, assembles a CLEAN public directory (landing + /app + App-Links + redirects —
# WITHOUT pwa/ source or supabase/ SQL), and uploads it via `wrangler deploy`.
#
# Prereqs (once): `npx wrangler login` in ./pwa.
# Usage: ./deploy.sh   (or: cd pwa && npm run deploy)
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "▶ Building PWA…"
( cd pwa && npm run build )            # → ./app

echo "▶ Assembling public site…"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
PUB="$OUT/public"                       # served root — keeps wrangler.jsonc OUT of the assets
mkdir -p "$PUB"
cp -r app "$PUB/app"                    # the built PWA (served at /app)
cp index.html 404.html icon.png _redirects "$PUB/"   # landing + SPA fallback + CF redirects
cp -r .well-known "$PUB/.well-known"    # assetlinks.json (Android App Links)

# Assets-only Worker config (mirrors the live worker). Lives ABOVE the assets dir
# so it is never itself served.
cat > "$OUT/wrangler.jsonc" <<'JSON'
{
  "name": "fooseroo",
  "compatibility_date": "2026-06-06",
  "observability": { "enabled": true },
  "assets": { "directory": "./public" },
  "compatibility_flags": ["nodejs_compat"]
}
JSON

echo "▶ Deploying Worker (fooseroo, production)…"
( cd pwa && npx wrangler deploy --cwd "$OUT" )

echo "✔ Deployed → https://fooseroo.app/"
