# Deal Pack 🤝

The deal workspace for the presales suite. Import the portable JSON exports from
[RVTools Analyzer](https://scribnetai.github.io/rvtools-analyzer/),
[Server Sizer](https://scribnetai.github.io/server-sizer/),
[Storage Sizer](https://scribnetai.github.io/storage-sizer/) and
[Network Sizer](https://scribnetai.github.io/network-sizer/) — any subset —
and get a customer-facing refresh proposal:

- **Proposal** — executive summary, current-state findings, proposed architecture, next steps
- **BOM** — one consolidated list: servers, switches, storage capacity
- **Checklist** — quote sanity checks raised by your numbers, plus the classics
- **TCO** — old-vs-new cost model (a model, not a quote)
- **Report** — the whole thing as a standalone downloadable HTML file

Live at https://scribnetai.github.io/deal-pack/ — 100% client-side, nothing uploaded.

## Dev

Pure logic lives in `js/logic.js` (no DOM) so it can be unit-tested in node:

```
node tests/run.js
```

`js/app.js` is the DOM wiring. Same visual language, projects bar, and changelog
pattern as the sibling apps.
