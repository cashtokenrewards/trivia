# Recovery and failure test matrix (Prompt 15)

How the game behaves when a connection is poor, a reply is lost, or the page is reloaded, and exactly which automated check proves each row. **Status as of 2026-10-23: proven against the in-browser simulated server and a fault-injecting mock server. Nothing here has been run against the real Laravel backend, which does not exist yet.**

## The rules this protects

1. **The server is the truth and owns the clock.** Reloading, losing signal, going to the background or coming back never pauses or extends it.
2. **One logical action = one Idempotency-Key.** A retry reuses the key, so the server either returns the saved outcome (it already counted it) or counts it once. A retry never creates a second action.
3. **Reading never creates an attempt.** Reload and resume only call the read endpoints.
4. **Say what is true.** If we cannot tell what the server did, say "we could not confirm", never "lost", and say the clock keeps running.
5. **Never promise offline competitive play.**

## What the app does (plain words)

| Situation | What the player sees | What happens underneath |
|---|---|---|
| A request fails in a safe-to-repeat way (no connection, 5xx, an identical request still running) | A small banner: "Connection problem. Trying again (n of 3)…" | Same action, **same key**, up to 3 more tries after 0.4 s, 1.2 s, 2.5 s. |
| Still unconfirmed after those tries | The game stays on screen. Banner: "We could not confirm your answer yet. It will not be counted twice, and the game clock keeps running. We keep trying." + **Try again now** | Same key kept. Quiet retry every 3 s for up to 10 more rounds of tries, then it stops and waits for **Try again now**, the browser's `online` event, or the player coming back to the tab. |
| The server answers while we were unsure | Banner: "Your last answer was received: correct / not correct", or "…did not arrive in time, so that round timed out" | The snapshot settles it (`resolveAnswerStatus`). |
| Offline | "You are offline. The game clock keeps running on the server and playing for rewards needs a connection. We will reconnect as soon as you are back online." | The browser's offline hint; a request is still the real test. On reconnect: retry the action or re-read. |
| Back from the background / restored tab | Nothing, unless the server moved on (then the new state) | Re-reads the snapshot. The screen's own countdown is only a display. |
| Reload in any phase | The same game, same round, same question | `GET /sessions/active` only. |
| Reload with an answer in flight | After the reload: the result and "Your last answer was received" | The answer's key and ids are kept in this tab's session storage (no secrets). If the server counted it: read it. If not: replay it with the **original key**. |
| 429 | "Slow down", button disabled with "Try again in N s" until the wait is over | Not retried automatically. Reuses the same key afterwards. |
| 5xx on start | After the automatic tries: an error with **Try again** | Same key: cannot start two games. |
| 401 / 403 / 422 / 503 content unavailable | A specific message, with the right button (Sign in / none / none / Home) | Not retried automatically. |
| 409 stale / wrong phase | No error screen: the screen re-syncs quietly | One read. The action is **not** repeated. |
| A slow older reply arrives after a newer one | Nothing changes | `state_version` guard (`acceptSnapshot`): an older snapshot never replaces a newer one. |
| Double tap, triple tap, Enter plus a click | One action | A synchronous in-flight lock in `useGame` (and disabled buttons). |

## Matrix

"Unit" = Vitest (`npm run test:unit`). "Browser" = Playwright against the app with the fault-injecting mock server (`scratchpad` scripts, not committed; see "Reproducing" below).

| # | Scenario | Expected | Automated evidence |
|---|---|---|---|
| R1 | Reply to an **answer** lost after the server committed | Result shown, no error screen; answer counted once; same key; second request served from the saved outcome | Browser 1; Unit `useGame` "a lost reply … SAME key" |
| R2 | Reply to a **box choice** lost after commit | Question appears; choice counted once; same key | Browser 2 |
| R3 | Reply to **start** lost after commit | Exactly one game; same key | Browser 3; Unit `useGame` "failing to start … reuses the key" |
| R4 | Server unreachable for a while, then back | Game stays on screen; honest "could not confirm" banner; answer locked; settles by itself; counted once; one key; player told "received" | Browser 4; Unit `useGame` (unconfirmed, quiet replay) |
| R5 | "Try again now" | Settles; counted once | Browser 5; Unit `useGame` "Try again replays the original key" |
| R6 | Reload while choosing / answering / on a result / after the game ended | Same state each time; no new game or round; only reads; home after the end, no spinner | Browser 6; Unit `useGame` "reload only reads" |
| R7 | Reload while the answer is in flight and the server already counted it | Result + "received"; counted once; recovery reference cleaned | Browser 7; Unit `useGame` "does not replay when the server already settled" |
| R8 | Reload when the answer never reached the server | Replayed with the original key; counted once; player told | Browser 8; Unit `useGame` "replays an unconfirmed answer with its original key" |
| R9 | Reference from a different game / timed-out round | Ignored and cleared / "did not arrive in time" | Unit `useGame` (two cases) |
| R10 | Offline, then back online | Honest offline banner (no offline-play promise); settles on reconnect; counted once | Browser 9; Unit `connectionNotice` wording rules |
| R11 | Back from the background after the server moved on | Screen shows the new state with no player action and no answer sent | Browser 10; Unit `useGame` "coming back to the tab re-reads the truth" |
| R12 | 429 with Retry-After | Visible countdown, disabled button, no hammering, then safe retry with the same key | Browser 11; Unit `parseError` + `retryPolicy` |
| R13 | 5xx on start | Error after automatic tries; Try again; one game; one key | Browser 12 |
| R14 | 401 / 403 / 422 / 503 content unavailable | Specific message and the right button; one request, no retry | Browser 13 (four cases); Unit `describeError` |
| R15 | 409 stale | Silent re-sync; not repeated; can answer again | Browser 13; Unit `useGame` "stale version" |
| R16 | Older reply arrives late | Ignored | Browser 14; Unit `useGame` "an older reply … never rolls the game back"; Unit reducer |
| R17 | Double / triple tap and key press | One request | Browser 15; Unit `useGame` "no duplicate actions" |
| R18 | A background read fails | Last known game stays; connection flagged; no error screen; no endless spinner | Unit reducer + `useGame` |
| R19 | Boot cannot reach the server | Home screen with "could not check for a game in progress", keeps checking; never stuck on a spinner | Unit `useGame` "does not strand the player on a spinner" |
| R20 | The quiet retry loop | Bounded: stops after 10 rounds so the player is asked | Unit `useGame` "stops nagging" |
| R21 | Blocked storage | Game works; only reload recovery of an in-flight answer is lost | Unit `recoveryStore` |
| R22 | Demo mode survives a reload (so the above can be rehearsed without a backend) | Game, deadlines and saved replies restored | Unit `DemoServer` save/restore, `DemoGameApi` reload |

## Not covered / known limits

- **No real backend.** Real latency, real clock skew between phone and server, load, and Laravel's actual idempotency store are untested. Section 5 of `docs/API_CONTRACT.md` is the contract the real server must meet for any of this to hold: **the same key and body must return the saved outcome, including after a restart of the connection, for at least 24 hours.**
- **A request that never left the device, then a reload**: replayed with its original key. If the player's deadline passed meanwhile, the server resolves it as a timeout (contract rule D-013), which is correct but may surprise them; the banner explains it.
- **Only `answer` has a recovery reference.** After a reload, an unconfirmed box choice, lifeline or "next round" is settled by the server's snapshot, not replayed. That is deliberate: replaying those after a reload could act on a screen the player no longer remembers.
- **`navigator.onLine` is only a hint.** It can be wrong in both directions; real requests are the test.
- **Real devices.** All browser runs are headless Chromium with WebGL off for speed. Not run on a real phone, iPhone Safari, the myMTN WebView, or with real flaky mobile networks.
- **Demo-mode pause** is not preserved across a reload (a paused demo resumes with the clock moved on).

## Manual checklist: a lost reply immediately after the server commits

Do this on a staging server once the real backend exists, with a real phone, using a proxy that can drop a response after the server has handled the request (for example Charles/mitmproxy "drop response", or a deliberately flaky mobile hotspot).

1. Start a **practice** game. Pick a box so a question is showing.
2. Arrange for the **next answer's response to be dropped after the server handled it** (not the request: the response).
3. Tap an answer.
4. **Expect:** a "Connection problem. Trying again (1 of 3)…" banner for a moment, then the result. No error screen. The score went up **once**.
5. Check server-side: exactly **one** answer row for that round; the request log shows the same `Idempotency-Key` on two requests, the second marked replayed.
6. Repeat, but this time **kill the connection completely** for 20 seconds after tapping. **Expect:** "We could not confirm your answer yet. It will not be counted twice, and the game clock keeps running." The question stays on screen with the options locked. Restore the connection. **Expect:** the result appears by itself within about 3 seconds, and "Your last answer was received…". One answer row server-side.
7. Repeat once more, but **reload the page** right after tapping (before any reply). **Expect:** the same game; after a moment the result and "Your last answer was received" (or "did not arrive in time" if the deadline passed). One answer row, and no new game or round.
8. Put the phone to sleep for a minute mid-question and wake it. **Expect:** the screen re-syncs on its own to what the server says (likely a timeout result) without you tapping.
9. Fail the check if you ever see: two answer rows for one round, a second game, an error screen for a transient failure, the words "lost" or "failed" about an answer whose fate is unknown, a promise of offline play, or a spinner that never ends.

## Reproducing the browser runs

The mock server and scenarios live outside the repository (in the session scratchpad), like the earlier browser scripts. In short: `build-mock.mjs` bundles `resources/js/demo/demoServer.ts` into a stateful mock of the game API; `faults.mjs` drives the app in headless Chromium, routes every `/api/v1/**` call to it, and injects faults (`drop_after_commit`, `drop_before`, `status`, `delay`, clock skew). If these should live in the repository for the team, that is a decision for the lead (they need `playwright` as a dev dependency: Prompt 21 adds `npm run test:e2e`).
