# Nidou: an airbnb.fr replica

A French-first vacation-rental site rebuilt from a recon of [airbnb.fr](https://www.airbnb.fr/), with its own brand, font and imagery.

- Recon: [`docs/recon/airbnb-fr.md`](docs/recon/airbnb-fr.md)
- Architecture and roadmap: [`docs/architecture.md`](docs/architecture.md)
- Design system: [`docs/design-system.md`](docs/design-system.md), with a static mockup in `design/mockups/home.html`

## Status

| Phase | State |
|---|---|
| P0 Foundation (Next.js 16, Tailwind v4 tokens, primitives, layout shell) | ✅ |
| P1 Homepage (tabs, search bar with destination/dates/guests pop-ups, carousels, cards, inspiration grid, footer, mobile nav and sheet, cookie banner) | ✅ |
| P2 Search | 🟡 results grid at `/s/[place]/homes` (filters by place and guests, totals per stay, pinned card first); no map or filters yet |
| P3 Listing page, P4 Accounts | ⏳ `/login` is a placeholder; Favoris are saved per browser |

Data comes from a deterministic seed (`lib/data/seed.ts`, 18 places, 270 listings) behind `lib/data/repo.ts`; Prisma replaces it in P2. Photos are random placeholders from picsum.photos.

## Develop

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm lint` / `pnpm typecheck` | ESLint, and route-type generation + `tsc` |
| `pnpm test` | Vitest unit tests (`tests/unit`) |
| `pnpm build && pnpm test:e2e` | Playwright against the production build, desktop and mobile (`tests/e2e`) |

Next.js 16 runs with Cache Components: data functions use `"use cache"` + `cacheLife`, and anything that reads request data (params, search params, cookies) must sit inside `<Suspense>`. See `AGENTS.md` and the docs bundled in `node_modules/next/dist/docs/`.
