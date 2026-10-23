# CashToken Trivia – API and Game Contract (v1)

Status: **PROPOSED, awaiting lead review (Checkpoint A).** Machine-readable twin: `docs/openapi.yaml`. TypeScript types: `resources/js/types/api.ts`. Demo fixtures: `resources/js/fixtures/`. If these disagree, fix the disagreement before implementing endpoints.

Rule defaults come from `docs/PROJECT_CONTEXT.md` and are delivered to the client inside every snapshot (`rules`), so the UI never hard-codes them.

**Rules are per session and may differ by mode.** A competitive session always carries the official rules (3 s box choice, 10 s answer, 90 s session). A practice session may carry a gentler published rule version (proposed in D-018: 8 s box choice, 120 s session, same 10 s answer window) so a new player can learn the boxes and still finish six rounds. The client must always use `snapshot.rules` for in-game timing and totals. The only place timings are quoted before a session exists is the pre-game copy (How to play, Meet the boxes, Practise first?), which is kept in `resources/js/game/ruleCopy.ts` and checked by a test against the demo server.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1`, same origin as the React app |
| Auth | First-party Laravel session cookie. Writes also need CSRF (`X-XSRF-TOKEN`). No tokens in `localStorage`. |
| Format | JSON in and out. `Accept: application/json` |
| Timestamps | UTC, ISO 8601, **millisecond precision, trailing `Z`**: `2026-10-19T10:00:00.000Z`. Never local time, never epoch. |
| IDs | Opaque strings: `session_id`, `round_id`, `question_id`, `option_id`. Option IDs are random per issued round and carry no position or correctness meaning. |
| Caching | Every `/api` response sends `Cache-Control: no-store, private` and `Vary: Cookie`. A CDN must never cache them. |
| Money/points | Integers only. |
| Mutation headers | `Idempotency-Key` (UUID v4, required) and CSRF. |
| Mutation body | `expected_state_version` (integer) where stated. |

### Core field names (used identically everywhere)
- `server_now` – server clock when the response was built.
- `session_expires_at` – hard end of the session: `session_started_at + 90 s`.
- `phase_deadline` – deadline of the current phase, or `null` when none runs.
- `state_version` – integer that increases on every state change (see section 4).
- `session_id`, `round_id`.

### Trust rules
- Only server receipt time (recorded by trusted middleware) decides deadlines. Device timestamps, tap times and animation acknowledgements are never sent or used.
- A deadline is **inclusive**: a request received at or before `phase_deadline` is on time; after it, it is late.
- The session clock starts when the explicit start request is received, never on page load or asset loading. Feedback, network time, refresh and backgrounding all consume session time.

## 2. Phases

`status` is `active` or `completed`. `phase` is one of:

| phase | Meaning | `phase_deadline` |
|---|---|---|
| `awaiting_round` | No round open. Before round 1 or after a round resolved. The UI shows feedback from `last_result` here. | `null` |
| `choosing` | A round is open and boxes are shown. | choice deadline (opened + 3 s, capped at `session_expires_at`) |
| `answering` | A question was issued. | `min(issued_at + 10 s, session_expires_at)` |
| `completed` | Terminal. Session ended; `result` is present. | `null` |

Transitions (all server-driven):

```
start -> awaiting_round
awaiting_round --open round--> choosing
choosing --select box--> answering
choosing --choice deadline passes--> answering (default Quick Win box, issued_at = choice deadline)
answering --answer on time--> awaiting_round (round resolved: correct | wrong)
answering --answer late / deadline passes--> awaiting_round (round resolved: timeout)
awaiting_round | choosing | answering --6th round resolves or session_expires_at passes--> completed
```

Reconciliation: any request (read or write) first applies every elapsed deadline in order, using the **logical** time of each deadline, not the arrival time of the request. A late request therefore cannot extend play. No job or browser callback is the only enforcement of expiry.

Rounds: only a round that issued a question can resolve. A `choosing` round open at session expiry is abandoned and does not count. A question open at expiry resolves as `timeout` and counts as resolved.

Completion: `completion = "completed"` when 6 rounds are resolved, otherwise `"partial"`. `end_reason` is `six_rounds` or `session_expired`. Completion is separate from reward qualification.

### Boxes (proposal – see D-007)
| `box_id` | Label | Difficulty | Points |
|---|---|---|---|
| `quick_win` | Quick Win | easy | 100 |
| `steady` | Steady | medium | 200 |
| `high_roller` | High Roller | hard | 300 |

Choice expiry always selects `quick_win`.

## 3. Endpoints

All return a **Snapshot** on success unless noted. `{id}` is `session_id`.

| # | Method and path | Purpose | Idempotency-Key | `expected_state_version` |
|---|---|---|---|---|
| 1 | `POST /sessions` | Start a session. Body `{ "mode": "practice" \| "competitive", "client_ready": true }`. `client_ready` must be true: assets are loaded and the player pressed Start. Returns `201`. | required | n/a |
| 2 | `GET /sessions/active` | The caller's active session, for recovery. `404 no_active_session` if none. | no | n/a |
| 3 | `GET /sessions/{id}` | Current snapshot (reconciles elapsed phases). | no | n/a |
| 4 | `POST /sessions/{id}/rounds` | Open the next round. Body `{ "expected_state_version" }`. | required | required |
| 5 | `POST /sessions/{id}/rounds/{round_id}/box` | Select a box. Body `{ "box_id", "expected_state_version" }`. Issues one question. | required | required |
| 6 | `POST /sessions/{id}/rounds/{round_id}/lifeline` | Remove one wrong option. Body `{ "expected_state_version" }`. | required | required |
| 7 | `POST /sessions/{id}/rounds/{round_id}/answer` | Submit an answer. Body `{ "option_id", "expected_state_version" }`. | required | required |
| 8 | `GET /sessions/{id}/result` | Terminal result incl. reward status. `409 session_not_finished` while active. Returns a **SessionResult**, not a Snapshot. | no | n/a |

Reads return the caller's own records only. Another player's `session_id` returns `404 session_not_found` (existence is not revealed). `403 forbidden` is reserved for role or feature denial.

A single logical player action may be retried many times; all retries use the **same** `Idempotency-Key`.

### Snapshot (summary; full schema in OpenAPI and `types/api.ts`)
`session_id, mode, status, phase, state_version, server_now, session_started_at, session_expires_at, phase_deadline, rules, rounds_total, rounds_resolved, score, correct_count, streak, bonuses_awarded, lifeline_available, round, last_result, result`.

- `round` – current open round or `null`. Contains `round_id, ordinal, status, boxes` (while choosing), `selected_box_id`, `auto_selected`, `question`, `answer_deadline`.
- `round.question` – `question_id, category, difficulty, text, options[{option_id,text}], removed_option_ids`. **Never** contains `correct_option_id`, an `is_correct` flag, or explanation.
- `last_result` – the most recently resolved round: `outcome (correct|wrong|timeout), selected_option_id, correct_option_id, explanation, points_awarded, streak_bonus, score_after, streak_after, resolved_at`. `correct_option_id` appears **only** here, for a round that is already resolved.
- `result` – `null` until `status = completed`.
- `streak` is the consecutive-correct counter toward the next bonus (0 to 2). It resets to 0 on a wrong answer, a timeout, or after a bonus is awarded.

### SessionResult
`session_id, mode, completion (completed|partial), end_reason, final_score, correct_count, rounds_resolved, bonuses_awarded, completed_at, rewards`.

`rewards`: `{ qualification, participation, premium, provider_mode }`
- `qualification`: `qualified | not_qualified | not_applicable` (practice is `not_applicable`).
- `participation` / `premium` status: `not_applicable | not_earned | pending | granted | unavailable | under_review`.
  - `pending` – entitlement recorded, delivery in progress. `granted` – delivered. `unavailable` – qualified but inventory exhausted (not oversold). `under_review` – delivery ambiguity escalated to staff.
- `provider_mode`: `none | fake | live`. In any non-production environment using the fake provider the response says `fake` and the UI must label rewards as sandbox. The fake provider cannot be enabled in production.

Reward qualification for local demo only (unapproved, D-008): participation needs 6 resolved rounds; premium also needs `final_score >= 1200` and `correct_count >= 4`. Practice and partial sessions earn nothing.

## 4. `state_version`

Starts at `1` when the session is created and increases by exactly 1 for each persisted state change:

| Event | Increments |
|---|---|
| Session started | creates version `1` |
| Round opened | yes |
| Box selected (question issued) | yes |
| Choice expiry auto-issues Quick Win | yes |
| Lifeline used | yes |
| Answer accepted and resolved | yes |
| Question expiry or late answer resolves as timeout | yes |
| Session finalised (6th round or expiry) | yes |
| Plain read with nothing elapsed | no |
| Idempotent replay of a saved outcome | no |
| Rejected request (any error) | no |

If one reconciliation applies several elapsed transitions, each increments. Clients ignore any snapshot whose `state_version` is lower than the one they hold. A request carrying an `expected_state_version` that differs from the current one gets `409 stale_state_version`, with `current_state_version` in `error.details`.

Late answers: a **new** answer whose server receipt time is after the answer deadline is not an error when it is the request that discovers the expiry. It resolves a timeout, increments `state_version` and returns `200` with the resolved snapshot. If an earlier request (for example a read) already reconciled the timeout, the round is resolved and the new answer gets `409 invalid_phase` (or `409 stale_state_version` if its version check fails first); the client re-fetches and shows the timeout. Version check order: ownership, idempotency, reconciliation, phase, then version.

## 5. Idempotency

- Key scope: authenticated player + operation (endpoint + session/round) + key.
- The server stores a hash of the request body and the saved response (status and body).
- Same key, same body: return the saved response verbatim, header `Idempotent-Replayed: true`. Nothing is re-executed and `state_version` does not change. The saved body may be older than the current state; clients rely on `state_version` to ignore stale data.
- Same key, **different body**: `409 idempotency_conflict`.
- Same key while the first request is still running: `409 idempotency_in_progress` (retryable, `Retry-After: 1`). No database error is ever shown.
- Missing or malformed key on a mutation: `422 idempotency_key_required`.
- Keys are kept at least 24 hours.
- Start: the same key returns the existing session. A different key while an active session exists gives `409 active_session_exists` (`details.session_id`). A second competitive attempt in the window gives `409 already_participated`.
- Answer: after a lost response, retrying with the original key returns the saved outcome. Retrying with a new key on a resolved round gives `409 invalid_phase`.
- Lifeline: retries return the same removal.

## 6. Errors

Envelope for every non-2xx response:

```json
{
  "error": {
    "code": "stale_state_version",
    "message": "Your screen is out of date.",
    "retryable": false,
    "correlation_id": "demo-corr-0001",
    "details": { "current_state_version": 7 }
  },
  "server_now": "2026-10-19T10:00:07.000Z"
}
```

Messages are safe for players: no stack traces, SQL, internal IDs or secrets.

| HTTP | `code` | Meaning | UI handling |
|---|---|---|---|
| 401 | `unauthenticated` | No valid session | Go to sign-in; keep nothing secret |
| 403 | `forbidden` | Role or feature denied | Show "not available" |
| 404 | `session_not_found` | Missing or not yours | Return to landing |
| 404 | `round_not_found` | Round not in this session | Re-fetch snapshot |
| 404 | `no_active_session` | Nothing to recover | Show landing |
| 409 | `stale_state_version` | `expected_state_version` outdated | Re-fetch snapshot silently, then let the player act again |
| 409 | `invalid_phase` | Action not allowed in this phase | Re-fetch snapshot |
| 409 | `phase_expired` | Box choice or lifeline after its deadline | Re-fetch snapshot (default box was applied) |
| 409 | `session_not_finished` | Result requested too early | Re-fetch snapshot |
| 409 | `session_completed` | Session already ended | Go to result |
| 409 | `idempotency_conflict` | Same key, different body | Treat as a bug; re-fetch snapshot |
| 409 | `idempotency_in_progress` | Duplicate still running | Retry same key after `Retry-After` |
| 409 | `active_session_exists` | Active session already open | Resume it using `details.session_id` |
| 409 | `already_participated` | Competitive attempt used | Offer practice only |
| 409 | `campaign_not_open` / `campaign_closed` | Outside the window | Show dates |
| 409 | `sessions_paused` | Operator paused new sessions | Show "back soon" |
| 419 | `csrf_mismatch` | CSRF token expired | Refresh token once, then ask player to reload |
| 422 | `validation_failed` | Bad body (`details.fields`) | Developer error; generic message |
| 422 | `idempotency_key_required` | Key missing/invalid | Developer error |
| 422 | `box_invalid` | Unknown `box_id` | Developer error |
| 422 | `option_not_in_round` | Option not issued for this round | Re-fetch snapshot |
| 429 | `rate_limited` | Too many requests (`Retry-After`) | Wait, show calm message; never auto-spam |
| 503 | `content_unavailable` | Not enough approved questions | Show "game unavailable"; no session consumed |
| 500/503 | `server_error` / `service_unavailable` | Unexpected failure | Retry button using the same key |

Rate limits apply per verified account plus supporting signals. A shared network is not blocked by IP alone.

## 7. Worked examples
Representative payloads for every state live in `resources/js/fixtures/*.json`. Each file is `{ "_demo": true, "description", "http_status", "response" }`. They contain **demo data only**: synthetic questions, fake IDs prefixed `demo_`, no real players or tokens.

## 8. Contradictions and gaps found while writing this contract
Recorded in `docs/DECISIONS.md`:
- D-007 box names and difficulty mapping are not defined by the playbook (proposal above).
- D-011 If the 6th question is open when the session expires, it resolves as timeout and makes 6 resolved rounds. Proposal: that counts as `completed` (six resolved rounds), `end_reason = session_expired`. The playbook's "partial play does not qualify" wording does not cover this edge.
- D-012 A box selection arriving after the choice deadline returns `409 phase_expired` (the auto Quick Win question is already issued) rather than silently honouring the late choice.
- D-013 Prompt 03 says "late new answer resolves a timeout" and Prompt 10 lists an "expired phase" error. Resolved here: late answers are `200 timeout`; `phase_expired` applies to box choice and lifeline only.
