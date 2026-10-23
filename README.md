# CashToken Trivia

Timed mobile trivia game for CeLD Innovations Ltd. Laravel serves a Blade shell; a React + TypeScript app (Vite) renders the game; Babylon.js will render the 3D arena. Laravel owns every competitive rule.

Read `docs/PROJECT_CONTEXT.md` first. Task status is in `docs/PROGRESS.md`; open questions in `docs/DECISIONS.md`.

## Runtime versions (verified locally 2026-10-19)
PHP 8.4.17 · Composer 2.9.4 · Laravel 13.37 · Node 24.13 · npm 11.6 · Vite 8.3 · React 19.3 · TypeScript 6.0 · Vitest 5.0 · ESLint 10.
Lockfiles (`composer.lock`, `package-lock.json`) are committed.

## Clean install
Run everything in PowerShell from the repo root.

```powershell
composer install
npm install
copy .env.example .env
php artisan key:generate
```

`.env.example` targets MySQL + Redis. Until you have a **disposable** local MySQL and Redis, you can run with SQLite instead: set `DB_CONNECTION=sqlite`, `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync` in your `.env`, then `php artisan migrate`. Never point `.env` at a shared or live database.

## Start locally
Two terminals, both in the repo root:

```powershell
php artisan serve     # Laravel web process  -> http://localhost:8000
npm run dev           # Vite dev server (hot reload, serves resources/js)
```

Open http://localhost:8000. You should see the CashToken Trivia welcome screen and a "Server online" badge. Health endpoint: http://localhost:8000/api/health.

Queue worker (not needed yet): `php artisan queue:work`.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check, then production build into `public/build` |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | ESLint on `resources/js` |
| `npm run test:unit` | Vitest frontend unit tests |
| `php artisan test` | PHP tests (foundation smoke) |

## Processes
- **web**: `php artisan serve` handles pages and `/api/*` JSON.
- **vite**: compiles React/TS and CSS in development; `npm run build` produces hashed assets for production.
- **queue**: `php artisan queue:work` (reward delivery, later tasks).
- **database / cache**: MySQL and Redis (see `.env.example`).

## Safety
Never commit `.env`, use production data, or reset a shared database. Fake identity/reward providers (later tasks) must be impossible to enable in production.

## Demo mode (frontend without the backend)
Until the game endpoints exist (backend tasks 04-10), the whole game can be played in the browser against a small simulated server:

1. Set `VITE_ALLOW_DEMO=true` in your local `.env` (it is `false` in `.env.example`; `npm run dev` always allows it).
2. Open `http://localhost:8010/?demo=1`.

A yellow **DEMO MODE** banner is always shown. The demo uses made-up questions and plays six real rounds: your box choice sets the difficulty, answers are scored (100/200/300, streak bonus, lifeline once), and the game ends with a results screen. Timers run for real: 3 seconds to pick a box (Quick Win opens by itself if you wait), 10 seconds to answer (a timeout scores nothing), and a 90 second game clock (a game that runs out ends as partial, with no reward). Tick **Pause timers** in the banner to explore at your own pace. Nothing is saved, secure or rewarded; it is **not** the real rule engine, which belongs to Laravel.

To try expiry quickly, shorten the durations in the URL (seconds, demo only): `?demo=1&session=20&choice=2&answer=4`.

Keyboard: while picking, `1`-`3` choose a chest; while answering, `1`-`4` or `A`-`D` choose an answer and `L` uses the lifeline; after a result, `N` (or Enter) starts the next round. Sound is off by default; switch it on from the home screen or the **Sound** button over the arena (it starts after your first tap, as browsers require). Without `?demo=1` the app talks to Laravel (`/api/v1/...`) and shows a clear error while those endpoints are missing. The demo is a separate lazy-loaded chunk.

Developer sandbox for the 3D chests alone (synthetic events, no game): `http://localhost:8010/?arena=1`.
