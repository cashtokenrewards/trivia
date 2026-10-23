# CashToken Trivia – Project Context

Portable version of the playbook's master context. Point any AI assistant at this file, plus `docs/DECISIONS.md` and `docs/PROGRESS.md`.

## Product
CashToken Trivia for CeLD Innovations Ltd: a short, timed, mobile-first trivia game with a 3D "pick a box" mechanic and (later) rewards. Players pick one of three boxes, answer one question, and finish after six resolved rounds or 90 seconds.

## Stack (fixed)
Laravel (PHP), MySQL, Redis, React + TypeScript, Vite, Babylon.js.
- One repository. Same-origin React app rendered from a Laravel Blade shell; JSON endpoints.
- Not allowed: Next.js, Vue, a separate Node backend, multiplayer, a physics engine, Inertia (unless the lead approves and documents it).
- Never upgrade an existing application without a documented decision.

## Ownership boundaries
- **Laravel** owns every competitive rule and reward decision: clock, deadlines, question issue, correctness, scoring, streaks, lifeline, eligibility, inventory, entitlements.
- **React** owns HTML screens and state mapping from server snapshots.
- **Babylon** owns the 3D scene only. It never fetches questions, calculates correctness or calls rewards; it consumes authorised UI events and confirmed outcomes.
- The browser is never trusted for time, score, correctness or rewards. Device timestamps and tap times are ignored.

## Development rules (configurable, versioned)
| Setting | Default |
|---|---|
| Session | 90 s or six resolved rounds, whichever first |
| Box choice | 3 s; automatic Quick Win on expiry |
| Answer window | 10 s from server issuance, capped by session expiry |
| Points | Easy 100, medium 200, hard 300; wrong/timeout 0 |
| Streak | +100 on every third consecutive correct; max 2 bonuses |
| Lifeline | Once per session; removes one wrong option; clock continues |
| Choices | Four options; order shuffled and persisted by server |
| Eligibility | One competitive participation per verified number and campaign window |
| Practice | Synthetic/separate pool; no rewards, no eligibility consumed. **Proposed practice-only timings (D-018):** 8 s box choice and a 120 s game clock (answer window unchanged at 10 s) so a new player can read the boxes and finish six rounds. The official competitive timings above are unchanged. |
| Reward example | Participation on six resolved rounds; premium at 1,200 points and 4 correct, if configured and available |

A resolved round is answered or timed out. Session expiry finalises partial play, which does not qualify for the participation reward. Maximum score is 2,000 (6 x 300 + 2 x 100). The reward example and allocation policy are **unapproved** until the campaign owner signs off. Live-campaign reward rules stay unchanged until the owner approves replacements.

## Environment separation
- Work locally with synthetic players, questions and rewards. Never use production data, the live campaign database or real reward credentials.
- Never commit `.env`; never print secrets.
- Destructive DB commands only against an explicitly disposable local test database.
- Fake identity and fake reward providers must be impossible to enable in production (fail closed at boot).
- Interns prepare and test releases; the designated release owner performs production cutover. Do not publish, merge or deploy.

## External contracts (UNVERIFIED)
The existing MTN identity (launch assertion, OTP) and reward/CashToken/voucher provider contracts are **unverified and unavailable**. Never invent endpoints, signatures, algorithms or secrets. Keep provider interfaces plus clearly labelled local fakes; real-mode implementations refuse until configured.

## Demo mode (frontend before backend)
The UI may render from JSON fixtures (Prompt 03) only in an explicit, visibly labelled demo mode. The normal path uses Laravel. Demo mode must not embed real competitive rules in the browser.

## Working method
Do one numbered playbook task at a time. At completion report: what changed; changed paths; commands; expected visible result; tests actually run and results; anything not verified; three understanding questions. Update `docs/PROGRESS.md`. Never claim tests passed unless executed.

## Order of work
01-03 foundations and contract -> 04-10 backend -> 11-16 React and 3D -> 17-20 rewards and operations -> 21-25 testing and release. Project-specific variation: after 03, tasks 11-14 may start early on fixtures (see DECISIONS D-002).
Checkpoints: A after 03, B after 10, C after 16, D after 20, E after 25.

## Local setup checklist (Windows 10, PowerShell, run from the repo root)
Detected on this machine (2026-10-19): PHP 8.4.17, Composer 2.9.4, Node 24.13.0, npm 11.6.2, MySQL client 8.0.43, Docker CLI 24.0.5, Git 2.40.0.
1. Confirm repo access: `git remote -v` (origin: github.com/cashtokenrewards/trivia). Work on a task branch, not `main`.
2. Check PHP extensions with `php -m`: pdo_mysql, mbstring, openssl, curl and fileinfo are present; intl, zip and sodium were NOT confirmed and Laravel/Composer usually want them.
3. Redis is not installed locally. Start Docker Desktop (daemon was not running) and use a small docker-compose for MySQL + Redis, or use Predis against another Redis (D-003).
4. MySQL: confirm a **disposable** local server/database and credentials (not checked; never use shared databases).
5. `composer ...`, `php artisan ...` and `npm ...` are all run in PowerShell from the repo root.
