import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorFixture, snapshotFixture } from '../fixtures';
import { ERROR_CODES } from '../types/api';
import { HttpGameApi, parseError } from './client';
import { DemoGameApi } from './demoApi';
import { ApiError, describeError } from './errors';

afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('describeError', () => {
    it('has a player-safe description for every contract error code', () => {
        for (const code of ERROR_CODES) {
            const d = describeError(new ApiError(400, code, 'x', false));

            expect(d.title, code).toBeTruthy();
            expect(d.message, code).toBeTruthy();
        }
    });

    it('re-syncs silently for stale, phase and idempotency conflicts', () => {
        for (const code of ['stale_state_version', 'invalid_phase', 'phase_expired', 'idempotency_conflict', 'session_completed'] as const) {
            expect(describeError(new ApiError(409, code, '', false)).autoRefresh, code).toBe(true);
        }
    });

    it('offers retry for network and server failures, and never for validation', () => {
        expect(describeError(new ApiError(0, 'network_error', '', true)).action).toBe('retry');
        expect(describeError(new ApiError(500, 'server_error', '', true)).action).toBe('retry');
        expect(describeError(new ApiError(422, 'validation_failed', '', false)).action).toBe('none');
    });

    it('sends 401 to sign-in, 419 to reload, 429 to wait and a used attempt to practice', () => {
        expect(describeError(new ApiError(401, 'unauthenticated', '', false)).action).toBe('sign_in');
        expect(describeError(new ApiError(419, 'csrf_mismatch', '', false)).action).toBe('reload');
        expect(describeError(new ApiError(429, 'rate_limited', '', true)).action).toBe('wait');
        expect(describeError(new ApiError(409, 'already_participated', '', false)).action).toBe('practice_only');
    });
});

describe('parseError', () => {
    it('reads the standard envelope from the contract fixtures', async () => {
        const body = errorFixture('error_stale_state_version');
        const error = await parseError(json(body, 409));

        expect(error.code).toBe('stale_state_version');
        expect(error.details).toEqual({ current_state_version: 7 });
        expect(error.correlationId).toBe('demo-corr-0001');
    });

    it('never surfaces raw server text for non-envelope responses', async () => {
        const html = new Response('<html>Stack trace SELECT * FROM users</html>', { status: 500 });
        const error = await parseError(html);

        expect(error.code).toBe('server_error');
        expect(error.message).not.toContain('SELECT');
    });

    it('maps unknown codes by status', async () => {
        const error = await parseError(json({ error: { code: 'brand_new_code', message: 'x' } }, 429));

        expect(error.code).toBe('rate_limited');
    });
});

describe('HttpGameApi', () => {
    it('sends the same Idempotency-Key, JSON body and credentials on a mutation', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(snapshotFixture('question_medium_issued'), 200));
        const api = new HttpGameApi();

        await api.selectBox('s1', 'r1', 'steady', 3, { idempotencyKey: 'key-123' });

        const [url, init] = fetchSpy.mock.calls[0]!;
        const headers = (init as RequestInit).headers as Record<string, string>;

        expect(url).toBe('/api/v1/sessions/s1/rounds/r1/box');
        expect(headers['Idempotency-Key']).toBe('key-123');
        expect((init as RequestInit).credentials).toBe('same-origin');
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({ box_id: 'steady', expected_state_version: 3 });
    });

    it('does not send an Idempotency-Key on reads', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(snapshotFixture('session_started')));

        await new HttpGameApi().getSnapshot('s1');

        const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
        expect(headers['Idempotency-Key']).toBeUndefined();
    });

    it('turns a failed network call into a retryable network_error', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(new HttpGameApi().getActiveSession()).rejects.toMatchObject({ code: 'network_error', retryable: true });
    });

    it('rejects with the mapped contract error on a 409', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(errorFixture('error_phase_expired'), 409));

        await expect(new HttpGameApi().openRound('s1', 1, { idempotencyKey: 'k' })).rejects.toMatchObject({ status: 409, code: 'phase_expired' });
    });
});

describe('DemoGameApi', () => {
    const opts = (key: string) => ({ idempotencyKey: key });

    /** Runs a promise to completion under fake timers, capturing either the value or the error. */
    const settle = async <T,>(promise: Promise<T>) => {
        const outcome = promise.then(
            (value) => ({ value, error: null as unknown }),
            (error: unknown) => ({ value: null as T | null, error }),
        );
        await vi.advanceTimersByTimeAsync(400);

        return outcome;
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('has no game before one is started, then plays a first round on the chosen box', async () => {
        const api = new DemoGameApi();

        expect((await settle(api.getActiveSession())).error).toMatchObject({ code: 'no_active_session' });

        const started = (await settle(api.startSession('practice', opts('k1')))).value!;
        expect(started).toMatchObject({ phase: 'awaiting_round', mode: 'practice' });

        const opened = (await settle(api.openRound(started.session_id, started.state_version, opts('k2')))).value!;
        const picked = (await settle(api.selectBox(opened.session_id, opened.round!.round_id, 'high_roller', opened.state_version, opts('k3')))).value!;

        expect(picked.round!.question!.difficulty).toBe('hard');
        expect((await settle(api.getActiveSession())).value!.state_version).toBe(picked.state_version);
    });

    it('returns the saved outcome for a retried key and a conflict when the same key is reused for a different request', async () => {
        const api = new DemoGameApi();
        const started = (await settle(api.startSession('practice', opts('k1')))).value!;
        const opened = (await settle(api.openRound(started.session_id, started.state_version, opts('k2')))).value!;
        const first = (await settle(api.selectBox(opened.session_id, opened.round!.round_id, 'steady', opened.state_version, opts('k3')))).value!;
        const retry = (await settle(api.selectBox(opened.session_id, opened.round!.round_id, 'steady', opened.state_version, opts('k3')))).value!;
        const conflict = await settle(api.selectBox(opened.session_id, opened.round!.round_id, 'quick_win', opened.state_version, opts('k3')));

        expect(retry).toBe(first);
        expect(conflict.error).toMatchObject({ status: 409, code: 'idempotency_conflict' });
    });

    it('does not know sessions it did not start, and a finished game is no longer active', async () => {
        const api = new DemoGameApi();

        expect((await settle(api.getSnapshot('other'))).error).toMatchObject({ code: 'session_not_found' });

        const started = (await settle(api.startSession('practice', opts('k1')))).value!;
        expect((await settle(api.getSnapshot('other'))).error).toMatchObject({ code: 'session_not_found' });
        expect((await settle(api.getSnapshot(started.session_id))).value!.session_id).toBe(started.session_id);
    });

    it('a new game replaces the old one', async () => {
        const api = new DemoGameApi();
        const first = (await settle(api.startSession('practice', opts('a')))).value!;
        const second = (await settle(api.startSession('practice', opts('b')))).value!;

        expect(second.session_id).not.toBe(first.session_id);
        expect((await settle(api.getSnapshot(first.session_id))).error).toMatchObject({ code: 'session_not_found' });
    });
});

describe('DemoGameApi surviving a reload', () => {
    const opts = (key: string) => ({ idempotencyKey: key });
    const memory = () => {
        const data = new Map<string, string>();

        return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    };
    const settle = async <T,>(promise: Promise<T>) => {
        const outcome = promise.then(
            (value) => ({ value, error: null as unknown }),
            (error: unknown) => ({ value: null as T | null, error }),
        );
        await vi.advanceTimersByTimeAsync(400);

        return outcome;
    };

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('a new page load finds the game in progress, with no new attempt created', async () => {
        const store = memory();
        const before = new DemoGameApi(undefined, store);
        const started = (await settle(before.startSession('competitive', opts('k1')))).value!;
        const opened = (await settle(before.openRound(started.session_id, started.state_version, opts('k2')))).value!;

        const after = new DemoGameApi(undefined, store); // the reload
        const found = (await settle(after.getActiveSession())).value!;

        expect(found.session_id).toBe(started.session_id);
        expect(found.state_version).toBe(opened.state_version);
        expect(found.phase).toBe('choosing');
    });

    it('a reply lost before the reload is returned unchanged when the same key is replayed afterwards', async () => {
        const store = memory();
        const before = new DemoGameApi({ choice_seconds: 60 }, store);
        const started = (await settle(before.startSession('practice', opts('k1')))).value!;
        const opened = (await settle(before.openRound(started.session_id, started.state_version, opts('k2')))).value!;
        const picked = (await settle(before.selectBox(opened.session_id, opened.round!.round_id, 'steady', opened.state_version, opts('k3')))).value!;

        const after = new DemoGameApi({ choice_seconds: 60 }, store);
        const replay = (await settle(after.selectBox(opened.session_id, opened.round!.round_id, 'steady', opened.state_version, opts('k3')))).value!;
        const live = (await settle(after.getActiveSession())).value!;

        expect(replay.state_version).toBe(picked.state_version); // not applied a second time
        expect(live.state_version).toBe(picked.state_version);
        expect(replay.round!.question!.text).toBe(picked.round!.question!.text);
    });

    it('a game that finished is not resumed, and unreadable saved data just means a fresh start', async () => {
        const broken = { getItem: () => '{not json', setItem: () => {} };
        const api = new DemoGameApi(undefined, broken);

        expect((await settle(api.getActiveSession())).error).toMatchObject({ code: 'no_active_session' });
        expect((await settle(new DemoGameApi(undefined, null).getActiveSession())).error).toMatchObject({ code: 'no_active_session' });
    });
});
