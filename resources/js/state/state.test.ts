import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { snapshotFixture } from '../fixtures';
import { deriveUi, gameReducer, initialGameState, type GameState, type PendingAction } from './gameReducer';
import { acceptSnapshot, estimatedServerNowMs, remainingMs, syncClock, type ClockSync } from './snapshot';

const clock: ClockSync = { offsetMs: 0, frozenServerNowMs: null };
const received = (state: GameState, name: string) => gameReducer(state, { type: 'snapshot_received', snapshot: snapshotFixture(name), clock });

const answerPending: PendingAction = { kind: 'answer', key: 'k1', sessionId: 's', roundId: 'r', optionId: 'o', expectedVersion: 3 };

describe('acceptSnapshot', () => {
    it('keeps the newer snapshot when an older response arrives late', () => {
        const newer = snapshotFixture('answer_correct'); // v4
        const older = snapshotFixture('question_medium_issued'); // v3

        expect(acceptSnapshot(newer, older)).toBe(newer);
    });

    it('accepts a newer or equal version and any first snapshot', () => {
        const a = snapshotFixture('question_medium_issued');
        const b = snapshotFixture('answer_correct');

        expect(acceptSnapshot(null, a)).toBe(a);
        expect(acceptSnapshot(a, b)).toBe(b);
        expect(acceptSnapshot(b, { ...b })).not.toBe(b);
    });

    it('accepts a different session even with a lower version', () => {
        const old = snapshotFixture('answer_correct');
        const fresh = { ...snapshotFixture('session_started'), session_id: 'other' };

        expect(acceptSnapshot(old, fresh)).toBe(fresh);
    });
});

describe('clock estimate', () => {
    it('adds half the round trip to server_now and follows the monotonic clock', () => {
        const snap = snapshotFixture('question_medium_issued'); // server_now 10:00:03.400
        const c = syncClock(snap, 1000, 1200, false); // 200 ms round trip received at mono 1200
        const serverAtReceipt = Date.parse(snap.server_now) + 100;

        expect(estimatedServerNowMs(c, 1200)).toBe(serverAtReceipt);
        expect(estimatedServerNowMs(c, 2200)).toBe(serverAtReceipt + 1000);
    });

    it('computes remaining time from the server deadline, never below zero', () => {
        const snap = snapshotFixture('question_medium_issued'); // deadline 10:00:13.400
        const c = syncClock(snap, 0, 0, false);

        expect(remainingMs(snap.phase_deadline, c, 0)).toBe(10000);
        expect(remainingMs(snap.phase_deadline, c, 99999)).toBe(0);
        expect(remainingMs(null, c, 0)).toBeNull();
    });

    it('freezes in demo mode so recorded timestamps do not run out', () => {
        const snap = snapshotFixture('question_medium_issued');
        const c = syncClock(snap, 0, 0, true);

        expect(remainingMs(snap.phase_deadline, c, 5000)).toBe(10000);
    });
});

describe('deriveUi', () => {
    it('maps each server phase to one UI state', () => {
        const ui = (name: string, pending: PendingAction | null = null) => deriveUi(snapshotFixture(name), pending, null, false, 'ready');

        expect(ui('session_started')).toBe('ready');
        expect(ui('round_choosing')).toBe('choosing');
        expect(ui('question_medium_issued')).toBe('answering');
        expect(ui('question_medium_issued', answerPending)).toBe('submitting');
        expect(ui('answer_correct')).toBe('feedback');
        expect(ui('answer_timeout')).toBe('feedback');
        expect(ui('snapshot_completed_qualified')).toBe('completed');
    });

    it('is recovering whenever a re-sync is running, and starting while the first request is in flight', () => {
        expect(deriveUi(snapshotFixture('round_choosing'), null, null, true, 'ready')).toBe('recovering');
        expect(deriveUi(null, { kind: 'start', key: 'k', mode: 'practice' }, null, false, 'ready')).toBe('starting');
    });

    it('does not show submitting once the answer request has failed', () => {
        const error = new ApiError(0, 'network_error', '', true);

        expect(deriveUi(snapshotFixture('question_medium_issued'), answerPending, error, false, 'answering')).toBe('answering');
    });
});

describe('gameReducer', () => {
    it('boots to loading, then to ready with no game or to the resumed phase', () => {
        const loading = gameReducer(initialGameState, { type: 'boot' });
        expect(loading.ui).toBe('loading');

        expect(gameReducer(loading, { type: 'booted', snapshot: null, clock: null }).ui).toBe('ready');
        expect(gameReducer(loading, { type: 'booted', snapshot: snapshotFixture('question_medium_issued'), clock }).ui).toBe('answering');
    });

    it('never rolls the UI back when a stale response arrives', () => {
        let state = received(initialGameState, 'answer_correct'); // v4, feedback
        state = received(state, 'question_medium_issued'); // v3 arrives late

        expect(state.snapshot?.state_version).toBe(4);
        expect(state.ui).toBe('feedback');
    });

    it('moves from choosing to answering to feedback to completed', () => {
        let state = received(initialGameState, 'round_choosing');
        expect(state.ui).toBe('choosing');

        state = received(state, 'question_medium_issued');
        expect(state.ui).toBe('answering');

        state = received(state, 'answer_correct');
        expect(state.ui).toBe('feedback');

        state = received(state, 'snapshot_completed_qualified');
        expect(state.ui).toBe('completed');
    });

    it('remembers the question so feedback can name the options', () => {
        let state = received(initialGameState, 'question_medium_issued');
        state = received(state, 'answer_correct');

        expect(state.lastQuestion?.roundId).toBe('demo_rnd_01');
        expect(state.lastQuestion?.question.options).toHaveLength(4);
    });

    it('keeps the pending action (and its key) after a retryable failure', () => {
        let state = received(initialGameState, 'question_medium_issued');
        state = gameReducer(state, { type: 'action_started', pending: answerPending });
        expect(state.ui).toBe('submitting');

        state = gameReducer(state, { type: 'action_failed', error: new ApiError(0, 'network_error', '', true) });

        expect(state.pending?.key).toBe('k1');
        expect(state.error?.code).toBe('network_error');
        expect(state.ui).toBe('answering');
    });

    it('re-syncs silently, without an error screen, after a stale version', () => {
        let state = received(initialGameState, 'question_medium_issued');
        state = gameReducer(state, { type: 'action_started', pending: answerPending });
        state = gameReducer(state, { type: 'action_failed', error: new ApiError(409, 'stale_state_version', '', false) });

        expect(state.error).toBeNull();
        expect(state.pending).toBeNull();
        expect(state.ui).toBe('recovering');
        expect(state.notice).toBeTruthy();

        state = received(state, 'answer_correct');
        expect(state.ui).toBe('feedback');
        expect(state.recovering).toBe(false);
    });

    it('drops the pending action on a non-retryable failure', () => {
        let state = received(initialGameState, 'round_choosing');
        state = gameReducer(state, { type: 'action_started', pending: { kind: 'select', key: 'k', sessionId: 's', roundId: 'r', boxId: 'steady', expectedVersion: 2 } });
        state = gameReducer(state, { type: 'action_failed', error: new ApiError(422, 'box_invalid', '', false) });

        expect(state.pending).toBeNull();
        expect(state.error?.code).toBe('box_invalid');
    });

    it('reset returns to a clean ready state', () => {
        const state = gameReducer(received(initialGameState, 'answer_correct'), { type: 'reset' });

        expect(state.snapshot).toBeNull();
        expect(state.ui).toBe('ready');
    });
});
