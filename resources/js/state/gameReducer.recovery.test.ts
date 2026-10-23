import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { snapshotFixture } from '../fixtures';
import { deriveUi, gameReducer, initialGameState, resolveAnswerStatus, type AnswerStatus, type GameAction, type GameState, type PendingAction } from './gameReducer';
import type { ClockSync } from './snapshot';

const clock: ClockSync = { offsetMs: 0, frozenServerNowMs: null };
const apply = (state: GameState, ...actions: GameAction[]) => actions.reduce(gameReducer, state);
const received = (name: string, source?: 'action' | 'read'): GameAction => ({ type: 'snapshot_received', snapshot: snapshotFixture(name), clock, source });

// Round 1 of the recorded fixtures: answering at version 3, the right answer is demo_opt_m3, resolved at version 4.
const answerPending: PendingAction = { kind: 'answer', key: 'key-1', sessionId: 'demo_sess_0001', roundId: 'demo_rnd_01', optionId: 'demo_opt_m3', expectedVersion: 3 };
const answering = () => apply(initialGameState, received('question_medium_issued'));

describe('automatic retries and the unconfirmed state', () => {
    it('records which automatic retry is running without touching the pending action', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'retrying', attempt: 2 });

        expect(state.connection).toBe('retrying');
        expect(state.retryAttempt).toBe(2);
        expect(state.pending?.key).toBe('key-1');
        expect(state.error).toBeNull();
    });

    it('goes unconfirmed without an error screen, keeping the same key and the question on screen', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'retrying', attempt: 3 }, { type: 'action_unconfirmed' });

        expect(state.connection).toBe('unconfirmed');
        expect(state.error).toBeNull();
        expect(state.pending?.key).toBe('key-1');
        expect(state.snapshot?.phase).toBe('answering');
        expect(state.ui).toBe('submitting');
        expect(state.answerStatus).toMatchObject({ status: 'unconfirmed', recovered: true });
    });

    it('the reply to the player\'s own request clears pending and the connection trouble', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'action_unconfirmed' }, received('answer_correct'));

        expect(state.pending).toBeNull();
        expect(state.connection).toBe('ok');
        expect(state.ui).toBe('feedback');
    });
});

describe('background re-syncs (reads)', () => {
    it('a read that arrives while a request is still running does not clear that request', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, received('answer_correct', 'read'));

        expect(state.pending?.key).toBe('key-1');
        expect(state.snapshot?.state_version).toBe(4);
    });

    it('a read can settle an unconfirmed action when the server has moved past the version it was based on', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'action_unconfirmed' }, received('answer_correct', 'read'));

        expect(state.pending).toBeNull();
        expect(state.connection).toBe('ok');
        expect(state.answerStatus).toMatchObject({ status: 'accepted', outcome: 'correct', recovered: true });
    });

    it('a read that shows nothing changed leaves the action unconfirmed so the same key can still be replayed', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'action_unconfirmed' }, received('question_medium_issued', 'read'));

        expect(state.connection).toBe('unconfirmed');
        expect(state.pending?.key).toBe('key-1');
    });

    it('an older snapshot arriving late never rolls the game back', () => {
        const state = apply(initialGameState, received('answer_correct'), received('question_medium_issued', 'read'));

        expect(state.snapshot?.state_version).toBe(4);
        expect(state.ui).toBe('feedback');
    });

    it('a failed read keeps the last known game on screen and flags the connection', () => {
        const state = apply(answering(), { type: 'resync_failed' });

        expect(state.connection).toBe('unconfirmed');
        expect(state.snapshot?.phase).toBe('answering');
        expect(state.ui).toBe('answering');
        expect(state.error).toBeNull();
        expect(state.recovering).toBe(false);
    });

    it('a later successful read clears the connection trouble when there was no pending action', () => {
        const state = apply(answering(), { type: 'resync_failed' }, received('question_medium_issued', 'read'));

        expect(state.connection).toBe('ok');
    });

    it('a recovering screen is released by a failed read, not left spinning forever', () => {
        const recovering = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'action_failed', error: new ApiError(409, 'stale_state_version', 'x', false) });

        expect(recovering.ui).toBe('recovering');
        expect(apply(recovering, { type: 'resync_failed' }).ui).not.toBe('recovering');
    });
});

describe('what became of the answer', () => {
    it('is "sending" as soon as the answer is on its way', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending });

        expect(state.answerStatus).toEqual({ roundId: 'demo_rnd_01', optionId: 'demo_opt_m3', status: 'sending', outcome: null, recovered: false });
    });

    it('becomes "accepted" with the outcome once the server shows the result for that round', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, received('answer_correct'));

        expect(state.answerStatus).toMatchObject({ status: 'accepted', outcome: 'correct', recovered: false });
    });

    it('says "timed out" when the round ended without our answer', () => {
        const waiting: AnswerStatus = { roundId: 'demo_rnd_03', optionId: 'demo_opt_e2', status: 'unconfirmed', outcome: null, recovered: true };

        expect(resolveAnswerStatus(waiting, snapshotFixture('answer_timeout'))).toMatchObject({ status: 'timed_out', recovered: true });
    });

    it('says "not recorded" when the round resolved with a different answer, or the game moved on without it', () => {
        const other: AnswerStatus = { roundId: 'demo_rnd_01', optionId: 'demo_opt_m1', status: 'unconfirmed', outcome: null, recovered: true };
        const gone: AnswerStatus = { roundId: 'demo_rnd_99', optionId: 'demo_opt_m1', status: 'unconfirmed', outcome: null, recovered: true };

        expect(resolveAnswerStatus(other, snapshotFixture('answer_correct'))?.status).toBe('not_recorded');
        expect(resolveAnswerStatus(gone, snapshotFixture('answer_correct'))?.status).toBe('not_recorded');
    });

    it('keeps waiting while that round is still open, and never changes a final answer', () => {
        const waiting: AnswerStatus = { roundId: 'demo_rnd_01', optionId: 'demo_opt_m3', status: 'unconfirmed', outcome: null, recovered: true };
        const done: AnswerStatus = { ...waiting, status: 'accepted', outcome: 'correct' };

        expect(resolveAnswerStatus(waiting, snapshotFixture('question_medium_issued'))).toBe(waiting);
        expect(resolveAnswerStatus(done, snapshotFixture('answer_timeout'))).toBe(done);
        expect(resolveAnswerStatus(null, snapshotFixture('answer_correct'))).toBeNull();
    });

    it('a rejected answer is "not recorded" until a later snapshot shows what really happened', () => {
        const rejected = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'action_failed', error: new ApiError(409, 'invalid_phase', 'x', false) });

        expect(rejected.answerStatus?.status).toBe('not_recorded');

        // The refreshed snapshot shows the answer WAS counted after all (an earlier attempt had landed).
        expect(apply(rejected, received('answer_correct', 'read')).answerStatus).toMatchObject({ status: 'accepted', outcome: 'correct' });
    });

    it('starting the next action clears a finished answer story, and dismissing clears it too', () => {
        const done = apply(answering(), { type: 'action_started', pending: answerPending }, received('answer_correct'));
        const next = apply(done, { type: 'action_started', pending: { kind: 'open', key: 'k2', sessionId: 'demo_sess_0001', expectedVersion: 4 } });

        expect(done.answerStatus?.status).toBe('accepted');
        expect(next.answerStatus).toBeNull();
        expect(apply(done, { type: 'dismiss_answer_status' }).answerStatus).toBeNull();
    });

    it('replaying the same answer keeps the fact that it needed recovering', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'action_unconfirmed' }, { type: 'action_started', pending: answerPending });

        expect(state.answerStatus).toMatchObject({ status: 'sending', recovered: true });
    });

    it('boot can restore a status found after a reload', () => {
        const status: AnswerStatus = { roundId: 'demo_rnd_01', optionId: 'demo_opt_m3', status: 'accepted', outcome: 'correct', recovered: true };
        const state = apply(initialGameState, { type: 'booted', snapshot: snapshotFixture('answer_correct'), clock, answerStatus: status });

        expect(state.answerStatus).toEqual(status);
        expect(state.ui).toBe('feedback');
    });
});

describe('derived screen state', () => {
    it('shows submitting for an unconfirmed answer and the phase for everything else', () => {
        expect(deriveUi(snapshotFixture('question_medium_issued'), answerPending, null, false, 'ready')).toBe('submitting');
        expect(deriveUi(snapshotFixture('question_medium_issued'), null, null, false, 'ready')).toBe('answering');
    });

    it('a reset clears every piece of recovery state', () => {
        const state = apply(answering(), { type: 'action_started', pending: answerPending }, { type: 'action_unconfirmed' }, { type: 'reset' });

        expect(state).toMatchObject({ connection: 'ok', pending: null, answerStatus: null, snapshot: null, retryAttempt: 0 });
    });
});
