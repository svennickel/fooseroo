# fooseroo – Landing Page

Statische Produktseite für die Android-App **Fooseroo**
(`de.snickel.fooser`, [Google Play](https://play.google.com/store/apps/details?id=de.snickel.fooser)).

- Live (GitHub Pages, Projektseite): https://svennickel.github.io/fooseroo/
  – das ist zugleich das Ziel der in der App geteilten Spiel-Links (`?spiel=…`).
- Ziel-Domain: **fooseroo.app** (siehe unten).
- `.well-known/assetlinks.json` wird relevant, sobald `fooseroo.app` als Custom
  Domain auf dieses Repo zeigt – dann liegt die Datei automatisch auf der
  Domain-Root und die Android App Links können per App-Update auf die Domain
  umgestellt werden. Für `svennickel.github.io` liegt die maßgebliche
  `assetlinks.json` weiterhin im User-Site-Repo.
- `.nojekyll` sorgt dafür, dass GitHub Pages den `.well-known`-Ordner ausliefert.

Deployment: GitHub Pages, Branch `main`, Root – jeder Push geht direkt live.

## fooseroo.app aufschalten (manuelle Schritte)

1. Domain bei Cloudflare registrieren: https://domains.cloudflare.com
2. Im Cloudflare-DNS für `fooseroo.app` anlegen (Proxy-Status „DNS only“/graue Wolke):
   - `CNAME` `www` → `svennickel.github.io`
   - Apex (`fooseroo.app`): `A`-Records auf die GitHub-Pages-IPs
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
3. **Erst danach** in diesem Repo die Datei `CNAME` mit Inhalt `fooseroo.app`
   anlegen (bzw. Repo-Settings → Pages → Custom Domain). Vorher gesetzt würde
   GitHub `svennickel.github.io/fooseroo` auf die noch tote Domain umleiten und
   die Share-Links der App brechen.
4. Repo-Settings → Pages → „Enforce HTTPS“ aktivieren (Pflicht für `.app`).
5. Optional später: Deep-Link-Host in der App auf `fooseroo.app` erweitern
   (zweiter `intent-filter` + `assetlinks.json` liegt hier schon bereit).
