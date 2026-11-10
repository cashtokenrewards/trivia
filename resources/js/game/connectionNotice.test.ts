import { describe, expect, it } from 'vitest';
import type { AnswerStatus } from '../state/gameReducer';
import { connectionNotice, type NoticeInput } from './connectionNotice';

const input = (over: Partial<NoticeInput> = {}): NoticeInput => ({ online: true, connection: 'ok', retryAttempt: 0, answerStatus: null, hasPending: false, ...over });
const status = (over: Partial<AnswerStatus> = {}): AnswerStatus => ({ roundId: 'r1', optionId: 'o1', status: 'sending', outcome: null, recovered: false, ...over });

describe('connectionNotice', () => {
    it('says nothing when everything is fine, including while an answer is simply on its way', () => {
        expect(connectionNotice(input())).toBeNull();
        expect(connectionNotice(input({ answerStatus: status() }))).toBeNull();
    });

    it('offline: explains the clock keeps running and never promises offline play', () => {
        const notice = connectionNotice(input({ online: false }))!;

        expect(notice.kind).toBe('offline');
        expect(notice.message).toMatch(/clock keeps running on the server/);
        expect(notice.message).toMatch(/needs a connection/);
        expect(notice.message).not.toMatch(/offline mode|play offline|saved/i);
        expect(notice.action).toBeNull();
    });

    it('offline also mentions an answer that has not been confirmed', () => {
        expect(connectionNotice(input({ online: false, answerStatus: status({ status: 'unconfirmed', recovered: true }) }))!.message).toMatch(/last answer has not been confirmed/);
    });

    it('retrying shows which automatic attempt is running, never beyond the maximum', () => {
        expect(connectionNotice(input({ connection: 'retrying', retryAttempt: 2 }))!.message).toBe('Connection problem. Trying again (2 of 3)…');
        expect(connectionNotice(input({ connection: 'retrying', retryAttempt: 9 }))!.message).toContain('3 of 3');
    });

    it('an unconfirmed answer is described honestly: not lost, not doubled, clock running, with a Try again button', () => {
        const notice = connectionNotice(input({ connection: 'unconfirmed', hasPending: true, answerStatus: status({ status: 'unconfirmed', recovered: true }) }))!;

        expect(notice.message).toMatch(/could not confirm your answer/);
        expect(notice.message).toMatch(/not be counted twice/);
        expect(notice.message).toMatch(/clock keeps running/);
        expect(notice.message).not.toMatch(/lost|failed/i);
        expect(notice).toMatchObject({ action: 'retry', actionLabel: 'Try again now' });
    });

    it('another unconfirmed action, and a failed refresh, each get their own wording and button', () => {
        expect(connectionNotice(input({ connection: 'unconfirmed', hasPending: true }))).toMatchObject({ action: 'retry', message: expect.stringContaining('could not reach the server') });
        expect(connectionNotice(input({ connection: 'unconfirmed', hasPending: false }))).toMatchObject({ action: 'refresh', actionLabel: 'Refresh now', message: expect.stringContaining('out of date') });
    });

    it('after recovery it tells the player what happened to the last answer', () => {
        expect(connectionNotice(input({ answerStatus: status({ status: 'accepted', outcome: 'correct', recovered: true }) }))!.message).toBe('Your last answer was received: correct.');
        expect(connectionNotice(input({ answerStatus: status({ status: 'accepted', outcome: 'wrong', recovered: true }) }))!.message).toBe('Your last answer was received: not correct.');
        expect(connectionNotice(input({ answerStatus: status({ status: 'timed_out', recovered: true }) }))!.message).toMatch(/did not arrive in time/);
        expect(connectionNotice(input({ answerStatus: status({ status: 'not_recorded', recovered: true }) }))).toMatchObject({ tone: 'warn', message: 'We could not record your last answer.', action: 'dismiss' });
    });

    it('stays quiet about an answer that went through normally (no recovery was needed)', () => {
        expect(connectionNotice(input({ answerStatus: status({ status: 'accepted', outcome: 'correct', recovered: false }) }))).toBeNull();
        expect(connectionNotice(input({ answerStatus: status({ status: 'timed_out', recovered: false }) }))).toBeNull();
    });

    it('trouble takes priority over history', () => {
        const notice = connectionNotice(input({ connection: 'retrying', retryAttempt: 1, answerStatus: status({ status: 'accepted', outcome: 'correct', recovered: true }) }))!;

        expect(notice.kind).toBe('retrying');
    });
});
