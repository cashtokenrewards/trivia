import type { AnswerStatus, ConnectionState } from '../state/gameReducer';
import { MAX_AUTO_RETRIES } from '../state/retryPolicy';

/**
 * What to tell the player when the connection is poor or an answer's fate is uncertain. The
 * rules, in plain words:
 *  - never promise offline competitive play: the server runs the clock and decides every result;
 *  - never say a failed answer "was lost" when we do not know: say we are checking;
 *  - always say the clock keeps running, because it does;
 *  - after the truth is known, say what happened to the last answer.
 */
export type NoticeKind = 'offline' | 'retrying' | 'unconfirmed' | 'answer';
export type NoticeTone = 'warn' | 'info';
export type NoticeAction = 'retry' | 'refresh' | 'dismiss' | null;

export interface ConnectionNotice {
    kind: NoticeKind;
    tone: NoticeTone;
    message: string;
    action: NoticeAction;
    actionLabel: string | null;
}

export interface NoticeInput {
    online: boolean;
    connection: ConnectionState;
    retryAttempt: number;
    answerStatus: AnswerStatus | null;
    /** An action is waiting to be confirmed (as opposed to a plain refresh that failed). */
    hasPending: boolean;
}

export function connectionNotice({ online, connection, retryAttempt, answerStatus, hasPending }: NoticeInput): ConnectionNotice | null {
    const answerUnknown = answerStatus?.status === 'unconfirmed';

    if (!online) {
        return {
            kind: 'offline',
            tone: 'warn',
            message: `You are offline. The game clock keeps running on the server and playing for rewards needs a connection. We will reconnect as soon as you are back online.${answerUnknown ? ' Your last answer has not been confirmed yet.' : ''}`,
            action: null,
            actionLabel: null,
        };
    }

    if (connection === 'retrying') {
        return { kind: 'retrying', tone: 'warn', message: `Connection problem. Trying again (${Math.min(retryAttempt, MAX_AUTO_RETRIES)} of ${MAX_AUTO_RETRIES})…`, action: null, actionLabel: null };
    }

    if (connection === 'unconfirmed') {
        if (answerUnknown) {
            return {
                kind: 'unconfirmed',
                tone: 'warn',
                message: 'We could not confirm your answer yet. It will not be counted twice, and the game clock keeps running. We keep trying.',
                action: 'retry',
                actionLabel: 'Try again now',
            };
        }

        return hasPending
            ? { kind: 'unconfirmed', tone: 'warn', message: 'We could not reach the server yet. The game clock keeps running. We keep trying.', action: 'retry', actionLabel: 'Try again now' }
            : { kind: 'unconfirmed', tone: 'warn', message: 'We could not refresh the game, so what you see may be out of date. We keep trying.', action: 'refresh', actionLabel: 'Refresh now' };
    }

    // The truth is known. Only explain when the player had to wait for it.
    if (answerStatus?.recovered) {
        switch (answerStatus.status) {
            case 'accepted':
                return { kind: 'answer', tone: 'info', message: `Your last answer was received: ${answerStatus.outcome === 'correct' ? 'correct' : 'not correct'}.`, action: 'dismiss', actionLabel: 'OK' };
            case 'timed_out':
                return { kind: 'answer', tone: 'info', message: 'Your last answer did not arrive in time, so that round timed out.', action: 'dismiss', actionLabel: 'OK' };
            case 'not_recorded':
                return { kind: 'answer', tone: 'warn', message: 'We could not record your last answer.', action: 'dismiss', actionLabel: 'OK' };
            default:
                return null;
        }
    }

    return null;
}
