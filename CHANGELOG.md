# Changelog

## 2026-09-28 — Canonical subdomain links
- Replaced legacy `scribnetai.github.io/<repo>/` links with canonical
  `https://<repo>.scribnet.io/` URLs (the old URLs 301-redirect, but docs and
  on-page links should point at the real address).

## 2026-09-28
- Added Umami website analytics (cookieless, no consent banner): pageview tracking plus custom events for ad-slot impression/click reporting.

## 2026-09-28
- Added a floating Feedback button (bottom-right) that opens a dialog to send feedback via email — topic chips, optional name, and message, addressed to the site owner with the app name in the subject.

## 2026-09-28
- TLS certificate provisioned for the `deal-pack.scribnet.io` custom domain (GitHub's stuck DNS check was reset 2026-09-28); HTTPS is now enforced on the site. App-switcher menu links switched from legacy `scribnetai.github.io` URLs to direct `https://<app>.scribnet.io` URLs for all 10 apps (footer/launcher links updated likewise). This entry also covers the net-zero CNAME delete/re-add commits from the DNS-check reset, which carried no changelog entries. Touched: index.html, js/app-switcher.js.


## 2026-09-26
- Launched: Deal Pack — the deal workspace for the suite. Import portable JSON exports from the RVTools Analyzer, Server Sizer, Storage Sizer and Network Sizer (any subset) and get a customer-facing refresh proposal: executive summary, current-state findings, proposed architecture, consolidated BOM, quote sanity checklist, TCO model, and a downloadable standalone HTML report.
- Added ✨ demo deal: one click loads a full synthetic engagement so the whole flow is visible with no imports. Clearly labeled everywhere as made-up data.
- Added quote sanity checklist: auto-raised checks from your numbers (optics/cabling per switch, phantom-core licensing, oversubscription over target, odd HBA splits) plus the standing classics (dual PSUs, rails, warranty SKUs, OOBM). Progress persists with the deal.
- Added TCO tab: old-vs-new cost model over 3 or 5 years with your own inputs (VMware licensing, per-core platform pricing, power, support, capex). Labeled honestly as a planning model, not a quote.
- Added 💾 Projects: named saves in this browser, portable JSON export/import, and automatic session restore. Large imports skip browser saves with a nudge — Export still works. Nothing uploaded, ever.
- Import validation mirrors each app's real export envelope — wrong-app files are rejected with a pointer to the right import card.

## 2026-09-27
- Added top-left app-switcher dropdown on the brand mark: one-click jumps to every app in the suite (full index, this page marked).
- Fixed: customer report footer now references https://deal-pack.scribnet.io (was legacy github.io URL).
