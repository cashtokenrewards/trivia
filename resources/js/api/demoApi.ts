import { demoClock } from '../demo/demoClock';
import { DemoServer, type DemoServerState } from '../demo/demoServer';
import type { BoxId, Rules, SessionMode, SessionResult, Snapshot } from '../types/api';
import type { ActionOptions, GameApi } from './client';
import { ApiError } from './errors';

const LATENCY_MS = 250;
const STORAGE_KEY = 'ct.demo.v1';
const MAX_SAVED_REPLIES = 40;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const notFound = () => new ApiError(404, 'session_not_found', 'No game in progress.', false, undefined, 'demo-corr-0001');

type Store = Pick<Storage, 'getItem' | 'setItem'>;
type SavedReply = { fingerprint: string; snapshot: Snapshot };

interface Persisted {
    v: 1;
    sessions: number;
    server: DemoServerState | null;
    saved: Array<[string, SavedReply]>;
}

function defaultStore(): Store | null {
    try {
        return window.sessionStorage;
    } catch {
        return null; // storage blocked: the demo still works, it just cannot survive a reload
    }
}

/**
 * DEMO ONLY. Plays a whole game against the in-browser DemoServer so the screens can be used
 * without the backend. It copies the real API's retry rule: the same Idempotency-Key with the
 * same request returns the saved outcome, and with a different request returns a conflict.
 *
 * Like the real server, it survives a page reload: the game and its saved replies are kept in
 * this tab's session storage (demo only; the real game state lives on the server, never in the
 * browser). That is what lets a reload or a lost reply be rehearsed without the backend.
 */
export class DemoGameApi implements GameApi {
    readonly kind = 'demo' as const;

    private server: DemoServer | null = null;
    private sessions = 0;
    private readonly saved = new Map<string, SavedReply>();

    /** Optional duration overrides (for example a short session to try expiry quickly). */
    constructor(
        private readonly rules?: Partial<Rules>,
        private readonly store: Store | null = defaultStore(),
    ) {
        this.restore();
    }

    /** True while the demo's pause-timers switch is on, so the screen freezes its countdown too. */
    isClockFrozen(): boolean {
        return demoClock.paused;
    }

    private restore(): void {
        try {
            const raw = this.store?.getItem(STORAGE_KEY);

            if (!raw) return;

            const data = JSON.parse(raw) as Partial<Persisted>;

            if (data.v !== 1) return;

            this.sessions = Number(data.sessions) || 0;
            this.server = data.server ? DemoServer.restore(data.server) : null;
            (data.saved ?? []).forEach(([slot, reply]) => this.saved.set(slot, reply));
        } catch {
            // Unreadable save: start fresh.
        }
    }

    private persist(): void {
        try {
            const saved = [...this.saved.entries()].slice(-MAX_SAVED_REPLIES);
            const data: Persisted = { v: 1, sessions: this.sessions, server: this.server?.toJSON() ?? null, saved };

            this.store?.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
            // Full or blocked storage: ignore.
        }
    }

    /** Runs a mutation once per Idempotency-Key. */
    private async mutate(operation: string, key: string, fingerprint: string, run: () => Snapshot): Promise<Snapshot> {
        await pause(LATENCY_MS);

        const slot = `${operation}:${key}`;
        const previous = this.saved.get(slot);

        if (previous) {
            if (previous.fingerprint !== fingerprint) {
                throw new ApiError(409, 'idempotency_conflict', 'This request key was already used for a different request.', false, undefined, 'demo-corr-0001');
            }

            return previous.snapshot;
        }

        try {
            const snapshot = run();
            this.saved.set(slot, { fingerprint, snapshot });

            return snapshot;
        } finally {
            this.persist(); // even a refused request can have applied overdue deadlines
        }
    }

    private current(sessionId: string): DemoServer {
        if (!this.server || this.server.sessionId !== sessionId) throw notFound();

        return this.server;
    }

    startSession(mode: SessionMode, o: ActionOptions) {
        return this.mutate('start', o.idempotencyKey, mode, () => {
            this.sessions += 1;
            this.server = new DemoServer(mode, Math.random, this.sessions, { rules: this.rules });

            return this.server.snapshot();
        });
    }

    async getActiveSession(): Promise<Snapshot> {
        await pause(LATENCY_MS);

        const snapshot = this.server?.snapshot();

        this.persist();

        if (!snapshot || snapshot.status === 'completed') {
            throw new ApiError(404, 'no_active_session', 'No game in progress.', false, undefined, 'demo-corr-0001');
        }

        return snapshot;
    }

    async getSnapshot(sessionId: string): Promise<Snapshot> {
        await pause(LATENCY_MS);

        const snapshot = this.current(sessionId).snapshot();

        this.persist();

        return snapshot;
    }

    openRound(sessionId: string, v: number, o: ActionOptions) {
        return this.mutate(`open:${sessionId}`, o.idempotencyKey, String(v), () => this.current(sessionId).openRound(v));
    }

    selectBox(sessionId: string, roundId: string, boxId: BoxId, v: number, o: ActionOptions) {
        return this.mutate(`box:${roundId}`, o.idempotencyKey, `${boxId}:${v}`, () => this.current(sessionId).selectBox(roundId, boxId, v));
    }

    applyLifeline(sessionId: string, roundId: string, v: number, o: ActionOptions) {
        return this.mutate(`lifeline:${roundId}`, o.idempotencyKey, String(v), () => this.current(sessionId).lifeline(roundId, v));
    }

    submitAnswer(sessionId: string, roundId: string, optionId: string, v: number, o: ActionOptions) {
        return this.mutate(`answer:${roundId}`, o.idempotencyKey, `${optionId}:${v}`, () => this.current(sessionId).answer(roundId, optionId, v));
    }

    async getResult(sessionId: string): Promise<SessionResult> {
        await pause(LATENCY_MS);

        const result = this.current(sessionId).result();

        this.persist();

        return result;
    }
}
