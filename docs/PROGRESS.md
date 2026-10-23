# Progress

## Task 01 – Inspect repository and establish project context
Status: done, awaiting lead review.

Evidence
- Audit (2026-10-19): repo contains only `README.md` ("# trivia") and one commit `adec3d9`. No Laravel app, package.json, composer.json, routes, tests, auth or integrations. Remote: origin https://github.com/cashtokenrewards/trivia.git. Branches: main, dev, trivia-project (checked out).
- Tools: PHP 8.4.17, Composer 2.9.4, Node 24.13.0, npm 11.6.2, MySQL client 8.0.43, Docker 24.0.5 (daemon not running), Git 2.40.0. Redis not installed.
- Docs created: docs/PROJECT_CONTEXT.md, docs/DECISIONS.md, docs/PROGRESS.md.
- No application behaviour changed; no secrets inspected.

Not verified / blockers
- MySQL server status and credentials; PHP intl/zip/sodium extensions; Redis route (D-003).
- Open lead decisions: D-003, D-005, D-006, D-007, D-008, D-010. Blocked: D-009.

Next: Task 02 (Laravel + React foundation).

## Task 02 – Local Laravel and React foundation
Status: done locally, awaiting lead review. Not committed.

What was built
- Laravel 13.37 skeleton in the repo root (created via `composer create-project` in a temp folder, then copied in; README and docs preserved). Tailwind and bunny-fonts from the stock skeleton were removed in favour of plain CSS.
- Blade shell `resources/views/game.blade.php` serving `<div id="root">`; `/` renders it. Entry `resources/js/main.tsx` (named `main`, not `app`, because Windows is case-insensitive and `App.tsx` collides with `app.tsx`).
- React welcome screen (`resources/js/App.tsx`) that calls `GET /api/health` and shows Server online / unreachable.
- `routes/api.php` with a throttled `/api/health` (status, app, UTC time; no secrets); api routing registered in `bootstrap/app.php`.
- Vite 8 + `laravel-vite-plugin` + `@vitejs/plugin-react`, strict TypeScript, ESLint flat config, Vitest (jsdom).
- Scripts: `npm run dev | build | typecheck | lint | test:unit`. PHP smoke test `tests/Feature/FoundationSmokeTest.php`.
- `.env.example` targets MySQL + Redis (placeholders only, `predis/predis` added since the PHP redis extension is absent). Local `.env` (git-ignored) still uses SQLite.
- `AGENTS.md`/`CLAUDE.md`: the skeleton's Laravel-Boost bootstrap text (which says to run PHP installers and `composer require laravel/boost`) was replaced with project-specific instructions. Boost was not installed.

Evidence (all actually executed 2026-10-19)
- `npm run typecheck`: pass. `npm run lint`: pass, no findings. `npm run test:unit`: 2/2 passed.
- `npm run build`: pass; main JS 219.8 kB (68.8 kB gzip), CSS 1.3 kB.
- `php artisan test`: 2 tests, 8 assertions, passed.
- `php artisan serve --port=8010`: `GET /` 200 with hashed asset links and `#root`; `GET /api/health` 200 with expected JSON.

Not verified / blockers
- The welcome screen was never opened in a real browser, so rendering is unconfirmed beyond HTML + asset links.
- `npm run dev` (hot reload) not exercised; production build used.
- MySQL: a server listens on 3306 but credentials and whether it is disposable are unknown; app was not run against it. Redis is not running locally (D-003). Acceptance item "connects to disposable MySQL and Redis" is therefore NOT met.
- Port 8000 is occupied on this machine by another project (`jamisi-api-services`); use 8010 or another free port.
- `intl`, `zip`, `sodium` PHP extensions still absent (Composer worked without them).
- Not done: committing, PR.

## Task 03 – Freeze the API and game contract
Status: drafted and checked locally, **awaiting lead review (Checkpoint A)**. Not committed.

What was built
- `docs/API_CONTRACT.md`: conventions, phases and transitions, 8 endpoints (`/api/v1/...`), Snapshot/Result shapes, `state_version` increment table, idempotency rules, error codes with UI handling, UTC timestamp format, reward availability and fake-provider behaviour, contradictions found.
- `docs/openapi.yaml` (OpenAPI 3.1): all endpoints, schemas, standard error envelope, three examples generated from the fixtures.
- `resources/js/types/api.ts`: matching TypeScript interfaces plus a runtime `ERROR_CODES` list.
- `resources/js/fixtures/*.json` (23 files) + `index.ts` loader: demo snapshots for every phase, results (qualified, partial, practice, reward unavailable) and 9 error examples. Every file carries `_demo: true` and a "DEMO DATA" description; synthetic questions and `demo_` IDs only.
- `resources/js/fixtures/fixtures.test.ts`: contract rules enforced on fixtures (no answer leak in active rounds, `correct_option_id` only in `last_result`, UTC ms timestamps, deadlines within the session, score consistency, max score 2000, demo labelling, no phone/email-like strings).
- Decisions added: D-011 to D-014; D-007 now carries a proposed box mapping.

Evidence (executed 2026-10-19)
- `npm run typecheck`: pass. `npm run lint`: pass. `npm run test:unit`: 2 files, 106 tests passed.
- `npx @redocly/cli lint docs/openapi.yaml`: valid. This also confirms the three embedded examples conform to the schemas.

Not verified
- Fixtures other than the three OpenAPI examples were not validated against the OpenAPI schemas (only against the TypeScript-level and runtime checks in the test file).
- TypeScript types are maintained by hand, not generated; drift is caught only by the fixture tests.
- No endpoint exists yet, so nothing real is compared to these examples (planned for Prompt 10 contract tests).
- Lead has not reviewed any payload or phase transition.

Open for the lead: D-007, D-011 (6th question open at expiry), D-012 (late box choice), D-014 (box ids, `/api/v1`).

## Task 11 – React application shell (run ahead of backend, per D-002)
Status: done locally, awaiting lead review. Not committed. Prompt 10 (live integration) is NOT done, so the "uses Laravel" path is unverified against a real backend.

What was built (`resources/js`)
- Screens: Landing, Identity (demo or "not connected yet"), Instructions, Readiness, Arena shell (HUD, timer bar, three box buttons with a placeholder stage, question + four options, lifeline, feedback), Results (completion, rewards with sandbox label, practice wording), Error view.
- `api/client.ts`: `GameApi` interface + `HttpGameApi` (same-origin cookies, CSRF header from `XSRF-TOKEN`, `Idempotency-Key` on writes, contract error envelope parsed, raw server text never shown, network failure -> retryable `network_error`). `api/errors.ts` maps every contract error code to a player message and action.
- `api/demoApi.ts` + `lazyDemo.ts`: fixture playback, separate lazy chunk (about 22 kB), same-key retry returns the saved snapshot.
- `state/gameReducer.ts`: states idle/loading/ready/starting/choosing/answering/submitting/feedback/completed/recovering derived from server phase; `state/snapshot.ts`: central adapter (older `state_version` never overwrites newer), clock estimate from `server_now` + half round trip + monotonic time; `state/useGame.ts`: one Idempotency-Key per logical action, Retry reuses it, stale/phase errors trigger a silent re-sync, a failed re-sync cannot loop.
- Preferences (sound, reduced motion) in localStorage; no tokens stored. CSS: portrait-first, 48 px minimum touch targets, focus rings, reduced-motion support.
- 2 fixtures added (`round_choosing_2`, `question_hard_issued`), OpenAPI examples re-synced.

Evidence (executed 2026-10-19)
- `npm run typecheck`, `npm run lint`: clean. `npm run test:unit`: 4 files, 148 tests passed (reducer, stale guard, clock, error mapping, HTTP client headers, demo playback). `php artisan test`: 2 passed. `npm run build`: ok (main JS 248 kB / 77 kB gzip, CSS 9.3 kB, demo chunk 21.8 kB).
- Real headless Chromium (Playwright, 390x844 touch viewport, scripted from the scratchpad, not committed): demo journey landing -> instructions -> readiness -> choosing -> answering -> feedback -> round 2 -> lifeline -> wrong feedback -> results, **no console errors**. Screenshots: `docs/screenshots/task-11/`.
- Same browser, non-demo path: no demo badge, a clear error view appears when the endpoints are missing, and Retry re-sent the POST with the **same** Idempotency-Key.
- The browser run found a real bug (lifeline button kept its "Use lifeline" aria-label after use); fixed.

Not verified
- No real backend exists: HttpGameApi is only checked against fixtures and mocked fetch, plus the missing-endpoint error path.
- Only Chromium headless at one phone size. Not tested: real phones, iPhone Safari, myMTN WebView, keyboard-only walkthrough, screen reader.
- Demo plays 2 of 6 rounds then jumps to a recorded final result, and its result screen shows reward text even for a practice run (labelled as a recorded example).
- The Arena is an HTML placeholder; Babylon is Prompt 12. Timer behaviour at real expiry (refresh once per deadline) is implemented but only exercised in unit-level logic, not against a live clock.
- Auto-advance and animations/sound belong to Prompt 14; recovery depth to Prompt 15.

## Task 12 – Babylon arena with primitive meshes (run ahead of backend, per D-002)
Status: done locally, awaiting lead review. Not committed. Wiring into the real game is Prompt 13, not done.

What was built
- `@babylonjs/core` and `@babylonjs/loaders` 9.31.0 (modular imports). `resources/js/arena/ArenaScene.ts`: stage, three primitive gift boxes with hinged lids and an invisible enlarged hit area, fixed camera (fixed horizontal FOV), lights, score tower with a dark track. API: `highlightBox`, `revealBox`, `resetRound`, `showConfirmedOutcome`, `setTowerLevel`, `setInputEnabled`, `setQuality`, `setReducedMotion`, `dispose`. Typed `onBoxSelected` callback; `ArenaUnavailableError` when WebGL cannot be created.
- `arena/logic.ts` (pure, tested): pixel-ratio cap per quality profile (low/medium), box ids, tap tolerance, tower level, easing.
- `screens/ArenaSandbox.tsx`: developer sandbox at `?arena=1` (demo-allowed builds only, lazy chunk). Synthetic events only; no session, no API, no rewards. Includes 2D mirror buttons, a visible "Selected" line, an event log, quality and reduced-motion toggles and a "Simulate WebGL failure" switch.
- The arena holds no rules: it does not fetch questions, judge answers or call rewards.

Bugs found and fixed during this task
1. Blank page under `npm run dev`: `game.blade.php` lacked `@viteReactRefresh`. Production builds hid this.
2. Whole app rendered twice in dev: Vite hot reload re-ran `main.tsx`, calling `createRoot` twice on `#root`. Now the root is created once and reused.
3. Picking relied on Babylon's tap event, which drops slow presses or small drift. Now selects on release with an explicit pick and an 18 px tolerance; a drag does not select.
4. Score tower was hidden behind the middle box. Moved beside the boxes with a visible track; camera widened.
5. Selection feedback was too subtle: stronger lift/glow, pointer cursor over boxes, a visible "Selected" line.

Evidence (executed 2026-10-21)
- `npm run typecheck`, `npm run lint` clean. `npm run test:unit`: 5 files, 158 tests passed. `npm run build` ok (main JS 249 kB / 77 kB gzip; arena lazy chunk 991 kB / 234 kB gzip). `php artisan test`: 2 passed.
- Headless Chromium on the Vite dev server (software WebGL), 17/17 checks passed: pointer cursor over a box and default elsewhere; slow press selects; press with small drift selects; drag does not select; empty click does nothing; selection locks until reset; reset allows a new tap; 2D buttons select; works with reduced motion; exactly one canvas after 10 mount/unmount cycles; fallback hides the canvas and 2D still selects; 3D works again after recovery; no `/api/v1` or `/api/health` requests; no console errors. Screenshots: `docs/screenshots/task-12/`.

Not verified
- Not run on a real GPU, a real phone, iPhone Safari or the myMTN WebView; no frame-rate or memory measurement (Prompt 16).
- Touch taps were not re-tested after the pick change (mouse clicks were); the earlier touch run hung in the software-rendered browser.
- WebGL context loss is wired to the fallback but not exercised; only the simulated failure was.
- Total arena chunk (234 kB gzip) is within the 5 MB target, but art and audio are not yet counted.
- Bundle contains unused Babylon loaders chunks pulled in by the engine; not optimised.

### Task 12 update (2026-10-21): treasure chests, springs and coin-stack meter
Requested redesign: cartoon treasure chests (not plain boxes), intuitive and animated, score shown as a gold coin stack that doubles as a progress meter.

What changed (`resources/js/arena/`)
- `ArenaScene.ts` rewritten. Each chest: wooden body with plank lines, arched half-cylinder lid on a back hinge, gold bands, corner posts, studs, lock and keyhole, tier-coloured gems (green Quick Win, blue Steady, red High Roller; Steady changed from yellow because yellow vanished against the gold trim; High Roller has three gems, Steady and High Roller get a gold base trim). Static parts are merged per material to keep draw calls low.
- Animation (springs, so motion overshoots naturally): idle sway/bob, travelling gold shine and gem pulse; a spotlight ring under each chest that brightens on hover and selection; on hover the chest rises and swells and the cursor becomes a pointer; on tap it squashes then springs up and glows while the other two dim and sink (the one-choice lock is visible); opening swings the lid with overshoot and releases an additive light shaft, glowing interior, sparkles and spilled coins; correct = hop, sparkle burst and coins that fly in an arc to the stack; wrong = head-shake; timeout = lid slams shut. Reduce motion removes all movement, particles and flying coins and snaps states instantly.
- Coin stack: 20 coins, 100 points each, on a pedestal with a translucent column marking full height (reads as a progress bar). Coins pop in one by one with a bounce and the stack wobbles. Counter-tilted slightly because perspective at the screen edge made it lean.
- `logic.ts`: `Spring` (stable sub-stepped damped spring), `easeOutBack`, `easeInOutCubic`, `MAX_COINS`, `coinsForLevel`; low/medium quality now also caps sparkle and coin particles.
- `ArenaScene.lockSelection()` plus sandbox: the 2D mirror buttons now respect the one-choice lock, are disabled while locked, and the page says "Choice locked: press Reset round".

Evidence (executed 2026-10-21)
- `npm run lint`, `npm run typecheck` clean. `npm run test:unit`: 5 files, 166 tests passed (new: spring stability and overshoot, easing, coin mapping). `npm run build` ok: main JS 249 kB (77 kB gzip); lazy arena chunk 1,021 kB (244 kB gzip). `php artisan test`: 2 passed.
- Headless Chromium on the Vite dev server (software WebGL), 17/17 interaction checks still pass (hover cursor, slow press, drift, drag, empty click, one-choice lock, reset, 2D buttons, reduced motion, 10 mount/unmount cycles with one canvas, fallback and recovery, no API calls, no console errors). Extra checks: 2D buttons disabled after a choice and re-enabled after reset; wrong, timeout and reduced-motion states render with no console errors. Screenshots: `docs/screenshots/task-12/`.

Not verified
- Animation was judged from still frames only: I did not record video, so timing, bounce feel and smoothness are unconfirmed. No frame-rate measurement; software rendering cannot represent a phone GPU.
- Not tested on a real GPU, real phone, iPhone Safari or the myMTN WebView. Touch taps still untested (mouse only).
- Arena chunk grew to 244 kB gzip; draw-call count and memory not measured (Prompt 16).
- Open lid reads as a flat panel from the front camera; lid orientation and hinge direction verified visually only at this angle.
- WebGL context loss still not exercised.

## Task 13 – Connect React and Babylon safely (run ahead of backend, per D-002)
Status: done locally against the recorded demo and a mocked HTTP layer, awaiting lead review. Not committed. Not verified against a real Laravel backend (does not exist yet).

What was built
- `arena/sync.ts`: pure `planArenaSync(snapshot summary, pending choice, scene state, tracker)` returning scene commands (reset / lock / reveal / outcome / tower). The snapshot is the single source of truth: the server's accepted box overrules a different tap, a rejected choice unlocks the chest, the chest opens once per round, each confirmed outcome plays once, a reload mid-question rebuilds the chest state.
- `arena/useArenaScene.ts`: scene adapter hook. Creates the Babylon scene when the canvas mounts, disposes it on unmount, context loss or failure; creates nothing if unmounted before the lazy module loads (Strict Mode, fast navigation); always calls the latest handlers without rebuilding the scene. Babylon objects live in a ref, never React state: they change every frame and React cannot diff them, so state would re-render the tree 60 times a second.
- `components/ArenaCanvas.tsx`: a 3D tap becomes exactly one `selectBox` action (one logical action, one Idempotency-Key); taps from an old round or while a request is in flight are ignored and the chest unlocks; input disabled while pending; context loss re-reads the snapshot (never a replay) and continues in 2D; quality picked from device cores and memory. Its effects only move the scene; they never start a session or submit an answer.
- `screens/Arena.tsx`: the flat placeholder stage is replaced by the 3D arena. Accessible HTML box buttons (label and points) remain as the keyboard, screen reader and no-WebGL route. Notices now float over the page so a banner can no longer push the chest from under a finger (found by the browser test).
- Sandbox (`?arena=1`) now uses the same hook. `ArenaScene` gained `selectedBoxId`.

Evidence (executed 2026-10-21)
- `npm run lint`, `npm run typecheck` clean. `npm run test:unit`: 7 files, 185 tests passed. New: `planArenaSync` (11 cases), hook lifecycle (7 cases incl. 10 mount/unmount cycles in Strict Mode, unmount before load, forced and real failure, context loss, latest handler), quality picker. `npm run build` ok: main JS 255 kB (79 kB gzip), arena chunk 1,021 kB (244 kB gzip). `php artisan test`: 2 passed.
- Headless Chromium against the Vite dev server with the Laravel endpoints mocked from the contract fixtures (so the real `HttpGameApi` path ran): one canvas in the game; HTML mirror present; session and round opened once; a double and triple tap during a slow request sent exactly ONE `/box` request; the answer was sent once; the HTML button route sends one request; a 409 stale rejection re-syncs silently with no error screen, the arena does not move, the chest unlocks and a new tap sends a new request.
- Resilience: with WebGL disabled the game shows the fallback message and a full round is playable with buttons; a real `WEBGL_lose_context` mid-question switches to 2D on the same question with the score unchanged and the round can be finished; three full visits never leave more than one canvas and none on the results screen. Sandbox suite: 17/17 still pass. Screenshots: `docs/screenshots/task-13/`.

Not verified
- No real backend: `HttpGameApi` was exercised only against mocked fixture responses. Real timing, latency and error behaviour are untested.
- The demo's recorded journey ignores which chest you pick (it always issues the same question); the chest shown follows the server's choice.
- Animation judged from stills; no frame-rate or memory measurement; software-rendered Chromium only. No real phone, iPhone Safari or myMTN WebView; touch taps still not tested (mouse only).
- `GET /sessions/active` fires twice in dev because React Strict Mode runs the boot effect twice (harmless read; not present in production builds).
- With mocked fixtures the countdown estimate starts from recorded timestamps, so the "apparent expiry" re-sync fires after a few seconds; with a real server clock this is correct.
- Keyboard-only and screen-reader walkthroughs not done.

### Demo mode rebuilt as a playable simulated server (2026-10-21, found by manual testing)
Problem reported: in demo mode, round 2 ignored the chosen box (always served the hard question) and answering did nothing. Cause: the demo replayed a fixed recorded script (`select -> lifeline -> answer`), so the box choice was ignored and an answer given before the scripted lifeline step was rejected as an invalid phase, then silently re-synced. This was the known limitation from Task 11 (D-015), but it made the demo feel broken.

What changed
- `demo/demoServer.ts` (+ `demo/questions.ts`): a small in-browser simulated server following docs/API_CONTRACT.md. Honours the chosen box (easy/medium/hard question), 18 made-up questions with no repeats in a session, option ids that reveal nothing, correct answer and explanation only after the round resolves, scoring 100/200/300, +100 on every third consecutive correct answer (max two), lifeline once per session removing one wrong option, six rounds then a results screen, `state_version` +1 per change (+1 more at finalisation), stale-version and wrong-phase errors, practice vs competitive reward summary (fake provider label).
- `api/demoApi.ts`: wraps it with latency and the real retry rule (same key + same request returns the saved outcome; same key + different request is a 409 conflict). The recorded fixtures remain, used by the contract tests and the mocked-HTTP browser test.
- Banner and results text now describe what the demo is. HUD round counter no longer jumps to the next round while a result is on screen. D-015 revised: the demo now duplicates a small part of the rules in the browser, so it must stay demo-only (lazy chunk, `VITE_ALLOW_DEMO`, never in the normal path).

Evidence (executed 2026-10-21)
- `npm run lint`, `npm run typecheck` clean; `npm run test:unit`: 8 files, 206 tests passed (new: 21 demo server cases covering choice honoured, no answer leak, option-position randomness, scoring, streak, 2,000 maximum with two bonuses, no repeats, lifeline rules, state_version steps, stale and phase errors, completion, reward summary; rewritten demo API cases for idempotent retry, conflict and session rules).
- Real headless Chromium, full six-round game through the UI: each box gave the matching difficulty in all six rounds, the lifeline removed exactly one option, every answer moved the game on, six rounds ended on the results screen, and a new game started cleanly; no page errors. Resilience suite (no WebGL, WebGL lost mid-question, three repeated visits) still passes against the new demo.

Not verified
- The browser game used "pick the first option", so which answers were correct varied; scoring correctness is covered by the unit tests, not by the browser run.
- Demo timers are frozen on purpose: expiry, timeouts, auto Quick Win and the 90-second limit are not demonstrable in demo mode. Those belong to the real server (Prompts 07-09).

## Task 14 – Complete timed player interaction (run ahead of backend, per D-002)
Status: done locally against the simulated demo server and mocked HTTP, awaiting lead review. Not committed. Not verified against a real Laravel backend (does not exist yet).

What was built
- **Real timing in demo mode** (`demo/demoServer.ts`, `demo/demoClock.ts`): 3 s to choose (an unchosen box becomes Quick Win, issued at the choice deadline, so a late request cannot extend play), 10 s to answer (a timeout scores nothing and breaks the streak), 90 s game clock (a game that runs out ends as partial with no reward; a question open at expiry counts as a timeout; a round still being chosen is abandoned; six resolved rounds ending at expiry still count as completed, D-011). Deadlines are inclusive and capped at the session end. Every read and write first applies any deadline that has passed, using that deadline's logical time. A late answer resolves a timeout with 200 (D-013); a late box choice or lifeline is a 409 `phase_expired` (D-012). Demo-only extras: a **Pause timers** switch in the banner (pausable clock) and URL overrides `?demo=1&session=&choice=&answer=` in seconds (D-017).
- **Circular timer in the top corner** (`components/CircleTimer.tsx`, `game/timerVisuals.ts`): an SVG ring that drains and changes colour (green, amber, red, with a pulse in the last seconds); label Pick / Answer / Game; announced as a timer. It replaces the horizontal bar. The ring is a display of the server's deadline: at apparent expiry the screen disables input, shows "Time is up", and re-reads the snapshot every 2 s until it moves on.
- **Timeouts shown clearly**: "Time ran out" result with an explanation, a "Quick Win opened for you" chip, and a "Time is up" results screen that explains a partial game does not qualify for rewards.
- **Sound** (`audio/`): effects synthesised with Web Audio (no files or licences), off by default, unlocked by the player's first tap, toggled from the home screen or the Sound button over the arena. Which sound plays comes from confirmed server changes (`planSounds`); the player's own tap sounds immediately; a tick plays in the last three seconds.
- **Keyboard** (`game/keys.ts`): 1-3 pick a chest, 1-4 or A-D answer, L lifeline, N (or Enter) next round; key hints on buttons (hidden on touch devices); focus moves to the new step and lands on "Next round" after a result. Enter on a focused button is left to the button so it never fires twice.
- Screen-reader announcements only at 5 and 3 seconds left (not every second). Countdown now ticks every 100 ms from the monotonic clock (never counts frames).

Evidence (executed 2026-10-21)
- `npm run lint`, `npm run typecheck` clean; `npm run test:unit`: 13 files, 246 tests passed (new: 20 demo timing cases with a hand-moved clock covering inclusive deadlines, auto Quick Win at the logical time, timeouts, a long delay replaying missed steps in order, late answer / box / lifeline, expiry, partial and D-011 cases, duration overrides, the pausable clock; ring geometry and colours; spoken warnings; key mapping; sound planning; sound player with a fake audio context). `npm run build` ok (main JS 262 kB / 82 kB gzip, demo chunk 11.6 kB gzip 4.4 kB, arena chunk 244 kB gzip). `php artisan test`: 2 passed.
- Headless Chromium against the Vite dev server, 26/26 checks passed with no page errors: ring in the top-right corner and announced as a timer; labels Pick / Answer; real-time countdown; amber then red; screen-reader warning at the end; Quick Win opens by itself when nothing is chosen; an unanswered question gives "Time ran out" and scores nothing; a game ends by itself when the clock runs out (partial, practice) and a competitive partial explains no reward; Pause timers freezes the ring and resuming continues; keys 2, L, 1, N, C and Enter all work (Enter advances exactly once); every button and option is at least 44 px; sound is silent by default, plays after turning it on, and is silent again when muted. Screenshots: `docs/screenshots/task-14/`.
- Visual check with 3D on and off: ring in the corner, sound button on the arena, and the sound button no longer overlaps the no-3D message.

Not verified
- No real backend: expiry and reconciliation were exercised against the simulated demo server only, so real network latency, clock skew between phone and server, and server load are untested. The ring uses `server_now` plus half the round trip; demo latency is a fixed 250 ms.
- The timing browser tests ran with WebGL switched off because software-rendered 3D made page actions slower than a 3 second window. The ring, timers, keyboard and sound do not depend on 3D, but this exact combination (live 3D plus a 3 s window) was checked only by eye and by the sandbox and demo suites with long durations.
- Real sound output was not heard: the Web Audio context was replaced by a counting stub, so loudness, pleasantness and browser autoplay behaviour on real phones, iPhone Safari and the myMTN WebView are untested.
- Keyboard play was driven by Playwright; a real keyboard-only and screen-reader walkthrough was not done. Touch input not tested (mouse and keyboard only).
- "Reduce motion" removes the ring pulse and transitions via the global rule but was not separately screenshot-tested.
- Reconnection after a lost reply is covered only by the 2 s re-read loop; the full failure matrix is Prompt 15.

### Task 14 follow-up (2026-10-21): recommend practice, "Meet the boxes", box points in "How to play", longer practice
Requested after trying the timed game: players cannot read what each box is worth in 3 seconds, and should be steered to practise before the one competitive game.

What changed
- **Practice is recommended**: on the home screen Practice is the first card with a "Recommended first" badge; choosing "Play for rewards" shows a skippable "Practise first?" step (advice only: "Practise first (recommended)" or "Play for rewards now"); it is skipped once a practice game has been finished on this device (`state/practiceHistory.ts`, a convenience only, never a rule); the practice results screen invites the player to the real game ("Ready for the real thing?").
- **"Meet the boxes" panel on the Ready screen** (`components/MeetTheBoxes.tsx`): a chest drawing, name, points (100 / 200 / 300), a difficulty chip and a one-line hint for each box, plus how long they will have to pick. It sits above Start and no timer runs on that screen, so it uses no game time (the clock still starts only when Start is pressed).
- **"How to play" now lists every box with its difficulty and points** (Quick Win: Easy, 100; Steady: Medium, 200; High Roller: Hard, 300), the wrong/timeout-scores-nothing rule, and the right timings for the mode.
- **Longer practice session (D-018, proposed)**: practice uses 8 s to choose and a 120 s game clock (answer window unchanged at 10 s); competitive keeps the official 3 s / 10 s / 90 s untouched. Reason: six slow rounds need up to 6 x (choice + answer): 78 s at 3 s choice, 108 s at 8 s, so practice needs more than 90 s. In-game ring and clock use `snapshot.rules`; the pre-game copy lives in `game/ruleCopy.ts` and a test checks it equals the demo server for both modes.
- Docs: PROJECT_CONTEXT (practice note, competitive unchanged), API_CONTRACT (rules are per session and may differ by mode), DECISIONS D-016 and new D-018.

Evidence (executed 2026-10-21)
- `npm run lint`, `npm run typecheck` clean; `npm run test:unit`: 14 files, 261 tests passed (new: 15 covering the rule copy per mode and its equality with the demo server, box info equal to the contract boxes and the 3D chests, 100/200/300 with difficulty and hints, practice history including blocked storage, and practice timings: 8 s choice, 120 s clock still running at 100 s, Quick Win default after the full 8 s, overrides still win). `npm run build` ok (main JS 267 kB / 83 kB gzip). `php artisan test`: 2 passed.
- Headless Chromium (WebGL off, since none of this depends on 3D), 26/26 checks passed, no page errors: two home cards with Practice first and badged; advice step wording and highlighted primary button; advice does not block the real game; competitive "How to play" shows 3 s, 10 s, 90 s and all three boxes with difficulty and points; the Ready screen shows three chest drawings with names, points, difficulty and hints, says the clock has not started, shows no timer, and the panel sits above Start; practice screens say 8 s and a 120 s clock and a real practice game starts with the ring at 8 and the game clock at 120; finishing a practice game invites the real game, is remembered, and skips the advice next time; "Practise first" opens the practice instructions; all advice-screen buttons are at least 44 px. Screenshots: `docs/screenshots/task-14b/`.

Not verified
- D-018 (practice 8 s / 120 s) is a proposal; the real server and the campaign owner have not agreed it, and the real server does not exist yet.
- "Has practised" lives in one browser's local storage: another device or cleared storage shows the advice again. That is intended (advice only).
- The text was reviewed for wording by me only; no player has read it, and reading speed at 3 seconds with the new panel and floating labels has not been tested with real people. Floating point labels above the 3D chests (an idea discussed earlier) were NOT built; the points are shown in the panel, "How to play" and the box buttons.
- Not re-checked on a real phone, iPhone Safari or the myMTN WebView. Chest drawings are flat SVG illustrations, not the 3D art.

## Task 15 – Refresh, disconnection and errors (run ahead of backend, per D-002)
Status: done locally against the simulated demo server and a fault-injecting mock server, awaiting lead review. Not committed. **Not verified against a real Laravel backend (does not exist yet).** Full matrix and the manual checklist: `docs/RECOVERY_TEST_MATRIX.md`.

What was built
- **One logical action, one key, never two requests at once** (`state/useGame.ts`): a synchronous in-flight lock means a double tap, a triple tap, Enter plus a click, or pressing Start twice is one action. Retries reuse the action's Idempotency-Key.
- **Automatic same-key retries** (`state/retryPolicy.ts`): no connection, 5xx, 503 and "an identical request is still running" are retried up to 3 times (0.4 s, 1.2 s, 2.5 s, honouring a short Retry-After). Decisions the server already made (401, 403, 404, 409, 422, 429, content unavailable) are never retried automatically.
- **Honest "unconfirmed" state**: if the reply is still missing, the game stays on screen (no error screen), options stay locked, and a bottom banner says "We could not confirm your answer yet. It will not be counted twice, and the game clock keeps running. We keep trying." with **Try again now**. A quiet loop retries every 3 s (max 10 rounds), and the browser's `online` event, returning to the tab and a restored tab each trigger an immediate retry or re-read. The countdown keeps running.
- **What became of the answer** (`gameReducer.ts` `AnswerStatus`): sending, unconfirmed, accepted (correct / not correct), timed out, not recorded, decided from the server snapshot. After a recovery the player is told ("Your last answer was received: correct", "…did not arrive in time, so that round timed out").
- **Reload recovery**: the page only READS (`GET /sessions/active`), so it can never create an attempt. An in-flight answer leaves a small, secret-free recovery reference in session storage (`state/recoveryStore.ts`); after a reload it is either settled from the snapshot or replayed with its original key (D-019).
- **Background reads are soft**: a failed re-sync keeps the last known game on screen and flags the connection instead of showing an error; a read can never clear an in-flight action; an older reply never overwrites a newer snapshot; several triggers share one read.
- **Messages**: offline banner with no promise of offline play (`game/connectionNotice.ts`); a floating pre-game strip; a visible "Try again in N s" countdown for 429 (Retry-After header now parsed); 401 / 403 / 422 / 503-content-unavailable / 5xx each get their own message and the right button; Try again states that it cannot count a move twice.
- **Demo mode now survives a reload** (saved in session storage, demo only) so all of this can be rehearsed without a backend.

Real bugs found and fixed by this task's tests
1. A retried **start** left the player on "Start first round" instead of going on to open it.
2. Going offline before the 3D code had loaded left an unhandled error and an endless "Loading 3D…" (now falls back to 2D with a reason).
3. A caller passing an inline `sleep` option could restart the page-load check on every render (an out-of-memory loop in a test): options are now read through refs.
4. A recovery banner that covered the countdown ring when it mattered most: in-game banners now sit at the bottom with matching page padding.
5. After a reload that replayed an answer, the player was not told it was recovered.

Evidence (executed 2026-10-23)
- `npm run lint`, `npm run typecheck` clean. `npm run test:unit`: 19 files, 339 tests passed (new: retry policy, recovery store, 21 reducer recovery transitions, 28 `useGame` integration cases with a scripted flaky API including Strict Mode, notice wording, demo save/restore). `npm run build` ok (main JS 277 kB / 86 kB gzip). `php artisan test`: 2 passed.
- **15 browser fault scenarios, 62 checks, 0 failures** (headless Chromium with WebGL off; stateful mock built from the real demo rules engine that can drop a reply after committing, drop a request before it arrives, return 401/403/422/429/5xx, delay replies and skew the server clock): lost reply after commit for answer, box and start (counted once, same key, replayed not redone); server unreachable then back (honest banner, answer locked, settles by itself, counted once, told "received"); Try again now; reload while choosing, answering, on a result and after the game ended (same game, only reads, never a new game); reload with the answer in flight; reload when the answer never arrived (replayed once with the original key); offline and back; returning from the background after the server moved on; 429 countdown; 5xx on start; 401/403/422/503 messages; stale 409; a late older reply ignored; double / triple tap and key press. Screenshots: `docs/screenshots/task-15/`.

Not verified
- **No real backend.** Real latency, real clock skew between phone and server, real load and Laravel's actual idempotency store are untested. The whole design relies on the server returning the saved outcome for a repeated key for at least 24 hours (API_CONTRACT section 5).
- Headless Chromium only, WebGL off. No real phone, iPhone Safari, myMTN WebView, or genuinely flaky mobile network (the manual checklist in RECOVERY_TEST_MATRIX.md is for that, once a staging backend exists).
- `navigator.onLine` is only a hint; the offline banner can be wrong in both directions.
- The mock server and fault scenarios live outside the repository (scratchpad), like the earlier browser scripts; adding Playwright to the repo is Prompt 21.
- Only the answer has a recovery reference: after a reload an unconfirmed box choice, lifeline or "next round" is settled from the snapshot, not replayed.
- Keyboard-only and screen-reader walkthroughs of the new banners were not done.
