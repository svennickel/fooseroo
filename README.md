# fooseroo – Landing Page

Statische Produktseite für die Android-App **Fooseroo**
(`de.snickel.fooser`, [Google Play](https://play.google.com/store/apps/details?id=de.snickel.fooser)).

- Live (GitHub Pages, Projektseite): https://svennickel.github.io/fooseroo/
  – das ist zugleich das Ziel der in der App geteilten Spiel-Links (`?spiel=…`).
- `\.well-known/assetlinks.json` wird erst relevant, sobald eine eigene Domain
  (z. B. `fooseroo.app`) als Custom Domain auf dieses Repo zeigt – dann liegt die
  Datei automatisch auf der Domain-Root und Android App Links können auf die
  Domain umgestellt werden. Für `svennickel.github.io` liegt die maßgebliche
  `assetlinks.json` im User-Site-Repo.
- `.nojekyll` sorgt dafür, dass GitHub Pages den `.well-known`-Ordner ausliefert.

Deployment: GitHub Pages, Branch `main`, Root – jeder Push geht direkt live.

## Eigene Domain aufschalten (später)

1. Domain registrieren (z. B. Cloudflare Registrar).
2. In diesem Repo eine Datei `CNAME` mit dem Domainnamen anlegen.
3. Beim DNS-Anbieter: `CNAME`-Record auf `svennickel.github.io` (bzw. A/AAAA
   auf die GitHub-Pages-IPs für die Apex-Domain).
4. In den Repo-Settings → Pages → „Enforce HTTPS“ aktivieren.
