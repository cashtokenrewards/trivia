import { StrictMode, act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionOptions, GameApi } from '../api/client';
import { ApiError } from '../api/errors';
import { snapshotFixture } from '../fixtures';
import type { BoxId, SessionMode, SessionResult, Snapshot } from '../types/api';
import type { GameController } from './useGame';
import { useGame } from './useGame';
import { recoveryStore, type AnswerReference } from './recoveryStore';
import { MAX_AUTO_RETRIES, MAX_RECOVERY_TRIES, RECOVERY_INTERVAL_MS } from './retryPolicy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noWait = () => Promise.resolve();
const networkDown = () => new ApiError(0, 'network_error', 'Network request failed.', true);
const serverError = () => new ApiError(500, 'server_error', 'Oops', true);

type Step = 'ok' | ApiError | (() => Promise<Snapshot>);

/** A scripted stand-in for the server API: each call takes the next scripted step, or succeeds. */
class FakeApi implements GameApi {
    readonly kind = 'http' as const;
    calls: Array<{ op: string; key?: string }> = [];
    script: Record<string, Step[]> = {};
    /** What GET /sessions/active and GET /sessions/{id} return, by fixture name (null = no game in progress). */
    active: string | null = 'question_medium_issued';
    current = 'question_medium_issued';

    private step(op: string, key: string | undefined, ok: () => Snapshot): Promise<Snapshot> {
        this.calls.push({ op, key });
        const next = this.script[op]?.shift() ?? 'ok';

        if (next === 'ok') return Promise.resolve(ok());
        if (typeof next === 'function') return next();

        return Promise.reject(next);
    }

    keysFor(op: string) {
        return this.calls.filter((c) => c.op === op).map((c) => c.key);
    }

    count(op: string) {
        return this.calls.filter((c) => c.op === op).length;
    }

    startSession(_mode: SessionMode, o: ActionOptions) {
        return this.step('startSession', o.idempotencyKey, () => snapshotFixture('session_started'));
    }

    getActiveSession() {
        this.calls.push({ op: 'getActiveSession' });
        const next = this.script.getActiveSession?.shift();

        if (next instanceof ApiError) return Promise.reject(next);
        if (this.active === null) return Promise.reject(new ApiError(404, 'no_active_session', 'No game', false));

        return Promise.resolve(snapshotFixture(this.active));
    }

    getSnapshot() {
        this.calls.push({ op: 'getSnapshot' });
        const next = this.script.getSnapshot?.shift();

        if (next instanceof ApiError) return Promise.reject(next);
        if (typeof next === 'function') return next();

        return Promise.resolve(snapshotFixture(this.current));
    }

    openRound(_id: string, _v: number, o: ActionOptions) {
        return this.step('openRound', o.idempotencyKey, () => snapshotFixture('round_choosing'));
    }

    selectBox(_id: string, _r: string, _b: BoxId, _v: number, o: ActionOptions) {
        return this.step('selectBox', o.idempotencyKey, () => snapshotFixture('question_medium_issued'));
    }

    applyLifeline(_id: string, _r: string, _v: number, o: ActionOptions) {
        return this.step('applyLifeline', o.idempotencyKey, () => snapshotFixture('question_hard_lifeline_used'));
    }

    submitAnswer(_id: string, _r: string, _opt: string, _v: number, o: ActionOptions) {
        return this.step('submitAnswer', o.idempotencyKey, () => snapshotFixture('answer_correct'));
    }

    getResult(): Promise<SessionResult> {
        return Promise.reject(new Error('not used'));
    }
}

interface Mounted {
    api: FakeApi;
    game: () => GameController;
    unmount: () => Promise<void>;
}

const flush = () =>
    act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

async function mountGame(api: FakeApi, options: { autoRecover?: boolean; strict?: boolean } = {}): Promise<Mounted> {
    const latest: { current: GameController | null } = { current: null };

    function Harness() {
        const game = useGame(api, { sleep: noWait, autoRecover: options.autoRecover ?? false });

        useEffect(() => {
            latest.current = game;
        });

        return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(options.strict ? <StrictMode><Harness /></StrictMode> : <Harness />);
    });
    await flush();

    return {
        api,
        game: () => latest.current!,
        unmount: async () => {
            await act(async () => root.unmount());
            container.remove();
        },
    };
}

const ANSWER = 'demo_opt_m3';

beforeEach(() => {
    window.sessionStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('a lost reply', () => {
    it('is repeated with the SAME Idempotency-Key and the result is applied once', async () => {
        const api = new FakeApi();
        api.script.submitAnswer = [networkDown(), networkDown()];
        const view = await mountGame(api);

        await act(async () => {
            await view.game().answer(ANSWER);
        });

        const keys = api.keysFor('submitAnswer');

        expect(keys).toHaveLength(3);
        expect(new Set(keys).size).toBe(1);
        expect(view.game().state).toMatchObject({ connection: 'ok', pending: null, error: null, ui: 'feedback' });
        expect(view.game().state.snapshot?.last_result).toMatchObject({ outcome: 'correct' });
        expect(view.game().state.answerStatus).toMatchObject({ status: 'accepted', outcome: 'correct', recovered: false });
        expect(recoveryStore.load()).toBeNull();
        await view.unmount();
    });

    it('stays in the game as "unconfirmed" after the automatic retries, keeping the key and the recovery reference', async () => {
        const api = new FakeApi();
        api.script.submitAnswer = Array.from({ length: MAX_AUTO_RETRIES + 1 }, networkDown);
        const view = await mountGame(api);

        await act(async () => {
            await view.game().answer(ANSWER);
        });

        const state = view.game().state;

        expect(api.count('submitAnswer')).toBe(MAX_AUTO_RETRIES + 1);
        expect(new Set(api.keysFor('submitAnswer')).size).toBe(1);
        expect(state.connection).toBe('unconfirmed');
        expect(state.error).toBeNull(); // no error screen: the game stays on screen
        expect(state.snapshot?.phase).toBe('answering');
        expect(state.pending?.key).toBe(api.keysFor('submitAnswer')[0]);
        expect(state.answerStatus).toMatchObject({ status: 'unconfirmed', recovered: true });
        expect(recoveryStore.load()).toMatchObject({ key: api.keysFor('submitAnswer')[0], optionId: ANSWER });
        await view.unmount();
    });

    it('Try again replays the original key, and cannot count the answer twice', async () => {
        const api = new FakeApi();
        api.script.submitAnswer = Array.from({ length: MAX_AUTO_RETRIES + 1 }, serverError);
        const view = await mountGame(api);

        await act(async () => {
            await view.game().answer(ANSWER);
        });
        await act(async () => {
            await view.game().retry();
        });

        const keys = api.keysFor('submitAnswer');

        expect(keys).toHaveLength(MAX_AUTO_RETRIES + 2);
        expect(new Set(keys).size).toBe(1);
        expect(view.game().state).toMatchObject({ connection: 'ok', pending: null, ui: 'feedback' });
        expect(view.game().state.answerStatus).toMatchObject({ status: 'accepted', outcome: 'correct', recovered: true });
        expect(recoveryStore.load()).toBeNull();
        await view.unmount();
    });
});

describe('no duplicate actions', () => {
    it('a double tap sends one request', async () => {
        const api = new FakeApi();
        const view = await mountGame(api);

        await act(async () => {
            await Promise.all([view.game().answer(ANSWER), view.game().answer(ANSWER), view.game().answer('demo_opt_m1')]);
        });

        expect(api.count('submitAnswer')).toBe(1);
        await view.unmount();
    });

    it('pressing Start twice starts one game', async () => {
        const api = new FakeApi();
        api.active = null;
        const view = await mountGame(api);

        await act(async () => {
            await Promise.all([view.game().start('competitive'), view.game().start('competitive')]);
        });

        expect(api.count('startSession')).toBe(1);
        await view.unmount();
    });

    it('a choice and an answer cannot overlap', async () => {
        const api = new FakeApi();
        api.active = 'round_choosing';
        let release!: () => void;
        api.script.selectBox = [() => new Promise<Snapshot>((resolve) => (release = () => resolve(snapshotFixture('question_medium_issued'))))];
        const view = await mountGame(api);

        let first!: Promise<unknown>;
        await act(async () => {
            first = view.game().selectBox('steady');
            await Promise.resolve();
        });
        await act(async () => {
            await view.game().selectBox('high_roller'); // ignored while the first is running
        });

        expect(api.count('selectBox')).toBe(1);

        await act(async () => {
            release();
            await first;
        });
        await view.unmount();
    });
});

describe('failures that must NOT be retried automatically', () => {
    it('a stale version triggers one silent re-sync and never a repeat of the action', async () => {
        const api = new FakeApi();
        api.script.submitAnswer = [new ApiError(409, 'stale_state_version', 'Out of date', false)];
        const view = await mountGame(api);

        await act(async () => {
            await view.game().answer(ANSWER);
        });
        await flush();

        expect(api.count('submitAnswer')).toBe(1);
        expect(api.count('getSnapshot')).toBeGreaterThanOrEqual(1);
        expect(view.game().state.error).toBeNull();
        expect(recoveryStore.load()).toBeNull();
        await view.unmount();
    });

    it('a 429 is shown to the player, not hammered, and keeps its key for a manual retry', async () => {
        const api = new FakeApi();
        api.active = 'round_choosing';
        api.script.selectBox = [new ApiError(429, 'rate_limited', 'Slow down', true, { retry_after_seconds: 5 })];
        const view = await mountGame(api);

        await act(async () => {
            await view.game().selectBox('steady');
        });

        const firstKey = api.keysFor('selectBox')[0];

        expect(api.count('selectBox')).toBe(1);
        expect(view.game().state.error?.code).toBe('rate_limited');
        expect(view.game().state.pending?.key).toBe(firstKey);

        await act(async () => {
            await view.game().retry();
        });

        expect(api.keysFor('selectBox')).toEqual([firstKey, firstKey]);
        expect(view.game().state.snapshot?.phase).toBe('answering');
        await view.unmount();
    });

    it('failing to start shows an error with Try again that reuses the key (one game, not two)', async () => {
        const api = new FakeApi();
        api.active = null;
        api.script.startSession = Array.from({ length: MAX_AUTO_RETRIES + 1 }, networkDown);
        const view = await mountGame(api);

        await act(async () => {
            await view.game().start('competitive');
        });

        expect(view.game().state.error?.code).toBe('network_error');
        expect(view.game().state.snapshot).toBeNull();

        await act(async () => {
            await view.game().retry();
        });

        const keys = api.keysFor('startSession');

        expect(new Set(keys).size).toBe(1);
        expect(view.game().state.snapshot?.session_id).toBe('demo_sess_0001');
        await view.unmount();
    });
});

describe('reload', () => {
    it('only reads: it never starts a game, and resumes the one in progress', async () => {
        const api = new FakeApi();
        const view = await mountGame(api, { strict: true });

        expect(api.count('startSession')).toBe(0);
        expect(api.count('openRound')).toBe(0);
        expect(view.game().state.snapshot?.session_id).toBe('demo_sess_0001');
        expect(view.game().state.ui).toBe('answering');
        await view.unmount();
    });

    it('with no game in progress it shows the home state, not an error or a spinner', async () => {
        const api = new FakeApi();
        api.active = null;
        const view = await mountGame(api);

        expect(view.game().state).toMatchObject({ snapshot: null, error: null, connection: 'ok', ui: 'ready' });
        await view.unmount();
    });

    it('replays an unconfirmed answer with its original key when the round is still open', async () => {
        const reference: AnswerReference = { kind: 'answer', key: 'key-from-before-the-reload', sessionId: 'demo_sess_0001', roundId: 'demo_rnd_01', optionId: ANSWER, expectedVersion: 3 };
        recoveryStore.save(reference);
        const api = new FakeApi();
        const view = await mountGame(api);

        await flush();

        expect(api.keysFor('submitAnswer')).toEqual(['key-from-before-the-reload']);
        expect(view.game().state.ui).toBe('feedback');
        expect(view.game().state.answerStatus).toMatchObject({ status: 'accepted', outcome: 'correct', recovered: true });
        expect(recoveryStore.load()).toBeNull();
        await view.unmount();
    });

    it('does not replay when the server already settled that round: it just tells the player what happened', async () => {
        recoveryStore.save({ kind: 'answer', key: 'old-key', sessionId: 'demo_sess_0001', roundId: 'demo_rnd_01', optionId: ANSWER, expectedVersion: 3 });
        const api = new FakeApi();
        api.active = 'answer_correct';
        const view = await mountGame(api);

        expect(api.count('submitAnswer')).toBe(0);
        expect(view.game().state.answerStatus).toMatchObject({ status: 'accepted', outcome: 'correct', recovered: true });
        expect(recoveryStore.load()).toBeNull();
        await view.unmount();
    });

    it('reports a round that timed out while the reply was lost', async () => {
        recoveryStore.save({ kind: 'answer', key: 'old-key', sessionId: 'demo_sess_0001', roundId: 'demo_rnd_03', optionId: 'demo_opt_e2', expectedVersion: 10 });
        const api = new FakeApi();
        api.active = 'answer_timeout';
        const view = await mountGame(api);

        expect(view.game().state.answerStatus).toMatchObject({ status: 'timed_out', recovered: true });
        await view.unmount();
    });

    it('ignores and clears a reference that belongs to a different game', async () => {
        recoveryStore.save({ kind: 'answer', key: 'old-key', sessionId: 'some_other_session', roundId: 'demo_rnd_01', optionId: ANSWER, expectedVersion: 3 });
        const api = new FakeApi();
        await mountGame(api);

        expect(api.count('submitAnswer')).toBe(0);
        expect(recoveryStore.load()).toBeNull();
    });

    it('does not strand the player on a spinner when the server cannot be reached', async () => {
        const api = new FakeApi();
        api.script.getActiveSession = Array.from({ length: MAX_AUTO_RETRIES + 1 }, networkDown);
        const view = await mountGame(api);

        expect(view.game().state.ui).not.toBe('loading');
        expect(view.game().state).toMatchObject({ snapshot: null, connection: 'unconfirmed', error: null });
        await view.unmount();
    });
});

describe('stale and late replies', () => {
    it('an older reply that arrives after a newer snapshot never rolls the game back', async () => {
        const api = new FakeApi();
        let release!: () => void;
        api.script.submitAnswer = [() => new Promise<Snapshot>((resolve) => (release = () => resolve(snapshotFixture('question_medium_issued'))))]; // an OLD version-3 reply
        api.current = 'answer_correct'; // the server has already moved to version 4
        const view = await mountGame(api);

        let pending!: Promise<unknown>;
        await act(async () => {
            pending = view.game().answer(ANSWER);
            await Promise.resolve();
        });
        await act(async () => {
            await view.game().refresh(); // a background read returns the newer truth first
        });
        expect(view.game().state.snapshot?.state_version).toBe(4);

        await act(async () => {
            release();
            await pending;
        });

        expect(view.game().state.snapshot?.state_version).toBe(4);
        expect(view.game().state.ui).toBe('feedback');
        await view.unmount();
    });
});

describe('background re-sync and the quiet recovery loop', () => {
    it('a failed background read keeps the last known game on screen and flags the connection', async () => {
        const api = new FakeApi();
        const view = await mountGame(api);
        api.script.getSnapshot = [networkDown()];

        await act(async () => {
            await view.game().refresh();
        });

        expect(view.game().state).toMatchObject({ connection: 'unconfirmed', error: null, ui: 'answering' });
        expect(view.game().state.snapshot?.phase).toBe('answering');
        await view.unmount();
    });

    it('several triggers at once share a single read', async () => {
        const api = new FakeApi();
        const view = await mountGame(api);
        let release!: () => void;
        api.script.getSnapshot = [() => new Promise<Snapshot>((resolve) => (release = () => resolve(snapshotFixture('question_medium_issued'))))];

        await act(async () => {
            void view.game().refresh();
            void view.game().refresh();
            void view.game().refresh();
            await Promise.resolve();
        });
        await act(async () => release());

        expect(api.count('getSnapshot')).toBe(1);
        await view.unmount();
    });

    it('coming back to the tab re-reads the truth', async () => {
        const api = new FakeApi();
        const view = await mountGame(api, { autoRecover: true });
        api.current = 'answer_correct'; // the server moved on while the tab was in the background

        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await flush();

        expect(api.count('getSnapshot')).toBe(1);
        expect(view.game().state.snapshot?.state_version).toBe(4);
        await view.unmount();
    });

    it('quietly replays an unconfirmed action with its original key and settles when the server answers', async () => {
        const api = new FakeApi();
        api.script.submitAnswer = Array.from({ length: MAX_AUTO_RETRIES + 1 }, networkDown);
        const view = await mountGame(api, { autoRecover: true });

        vi.useFakeTimers(); // after mounting, so the helper that waits for a mount is not frozen

        await act(async () => {
            await view.game().answer(ANSWER);
        });
        expect(view.game().state.connection).toBe('unconfirmed');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS + 50);
        });

        const keys = api.keysFor('submitAnswer');

        expect(keys).toHaveLength(MAX_AUTO_RETRIES + 2);
        expect(new Set(keys).size).toBe(1);
        expect(view.game().state).toMatchObject({ connection: 'ok', pending: null, ui: 'feedback' });
        await view.unmount();
    });

    it('stops nagging after a while, so the player is asked instead of the screen retrying forever', async () => {
        const api = new FakeApi();
        api.script.submitAnswer = Array.from({ length: 200 }, networkDown);
        const view = await mountGame(api, { autoRecover: true });

        vi.useFakeTimers();

        await act(async () => {
            await view.game().answer(ANSWER);
        });

        const before = api.count('submitAnswer');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(RECOVERY_INTERVAL_MS * (MAX_RECOVERY_TRIES + 6));
        });

        // Each quiet attempt is itself a full set of automatic tries; there must be a ceiling.
        const attempts = (api.count('submitAnswer') - before) / (MAX_AUTO_RETRIES + 1);

        expect(attempts).toBeLessThanOrEqual(MAX_RECOVERY_TRIES);
        expect(view.game().state.connection).toBe('unconfirmed');
        await view.unmount();
    });

    it('the online event replays an unconfirmed action straight away', async () => {
        const api = new FakeApi();
        api.script.submitAnswer = Array.from({ length: MAX_AUTO_RETRIES + 1 }, networkDown);
        const view = await mountGame(api, { autoRecover: true });

        await act(async () => {
            await view.game().answer(ANSWER);
        });
        await act(async () => {
            window.dispatchEvent(new Event('online'));
        });
        await flush();

        expect(new Set(api.keysFor('submitAnswer')).size).toBe(1);
        expect(view.game().state).toMatchObject({ connection: 'ok', ui: 'feedback' });
        await view.unmount();
    });
});

describe('reload recovery under React Strict Mode (the app runs in it during development)', () => {
    it('replays the unconfirmed answer once, with its original key, and tells the player it was recovered', async () => {
        recoveryStore.save({ kind: 'answer', key: 'key-from-before-the-reload', sessionId: 'demo_sess_0001', roundId: 'demo_rnd_01', optionId: ANSWER, expectedVersion: 3 });
        const api = new FakeApi();
        const view = await mountGame(api, { strict: true });

        await flush();
        await flush();

        expect(api.keysFor('submitAnswer')).toEqual(['key-from-before-the-reload']);
        expect(view.game().state.ui).toBe('feedback');
        expect(view.game().state.answerStatus).toMatchObject({ status: 'accepted', outcome: 'correct', recovered: true });
        await view.unmount();
    });
});

describe('retrying a failed start', () => {
    it('goes on to open the first round, exactly like pressing Start does', async () => {
        const api = new FakeApi();
        api.active = null;
        api.script.startSession = Array.from({ length: MAX_AUTO_RETRIES + 1 }, networkDown);
        const view = await mountGame(api);

        await act(async () => {
            await view.game().start('practice');
        });

        expect(view.game().state.error?.code).toBe('network_error');
        expect(api.count('openRound')).toBe(0);

        await act(async () => {
            await view.game().retry();
        });

        expect(new Set(api.keysFor('startSession')).size).toBe(1);
        expect(api.count('openRound')).toBe(1);
        expect(view.game().state.snapshot?.phase).toBe('choosing');
        await view.unmount();
    });
});
