import { describeError, type ApiError } from '../api/errors';
import type { ActiveQuestion, BoxId, SessionMode, Snapshot } from '../types/api';
import { acceptSnapshot, type ClockSync } from './snapshot';

export type UiState =
    | 'idle'
    | 'loading'
    | 'ready'
    | 'starting'
    | 'choosing'
    | 'answering'
    | 'submitting'
    | 'feedback'
    | 'completed'
    | 'recovering';

/**
 * One logical player action. The Idempotency-Key is created once with the action and reused
 * by every retry; it is never regenerated per HTTP attempt.
 */
export type PendingAction =
    | { kind: 'start'; key: string; mode: SessionMode }
    | { kind: 'open'; key: string; sessionId: string; expectedVersion: number }
    | { kind: 'select'; key: string; sessionId: string; roundId: string; boxId: BoxId; expectedVersion: number }
    | { kind: 'lifeline'; key: string; sessionId: string; roundId: string; expectedVersion: number }
    | { kind: 'answer'; key: string; sessionId: string; roundId: string; optionId: string; expectedVersion: number };

/** The question most recently shown, kept so feedback can name the options after the round resolves. */
export interface RememberedQuestion {
    roundId: string;
    question: ActiveQuestion;
}

/**
 * ok          nothing is wrong
 * retrying    a request failed in a way that is safe to repeat, and we are repeating it (same key)
 * unconfirmed we cannot yet tell what the server did; we keep trying quietly and say so honestly
 */
export type ConnectionState = 'ok' | 'retrying' | 'unconfirmed';

/**
 * What became of the answer the player sent.
 *   sending      on its way
 *   unconfirmed  the reply was lost or the server was unreachable; we are checking
 *   accepted     the server counted it (outcome says correct or wrong)
 *   timed_out    it arrived too late, or never did, and the round timed out
 *   not_recorded the server did not count it
 */
export type AnswerStatusKind = 'sending' | 'unconfirmed' | 'accepted' | 'timed_out' | 'not_recorded';

export interface AnswerStatus {
    roundId: string;
    optionId: string;
    status: AnswerStatusKind;
    outcome: 'correct' | 'wrong' | null;
    /** True when the player had to wait for recovery, so the screen should explain what happened. */
    recovered: boolean;
}

export interface GameState {
    ui: UiState;
    snapshot: Snapshot | null;
    lastQuestion: RememberedQuestion | null;
    clock: ClockSync | null;
    pending: PendingAction | null;
    /** Blocking error shown as a full error view. */
    error: ApiError | null;
    /** Non-blocking message, for example after a silent re-sync. */
    notice: string | null;
    recovering: boolean;
    connection: ConnectionState;
    /** Which automatic retry is running (1 to MAX_AUTO_RETRIES) while connection is "retrying". */
    retryAttempt: number;
    answerStatus: AnswerStatus | null;
}

export type GameAction =
    | { type: 'boot' }
    | { type: 'booted'; snapshot: Snapshot | null; clock: ClockSync | null; notice?: string | null; connection?: ConnectionState; answerStatus?: AnswerStatus | null }
    | { type: 'action_started'; pending: PendingAction }
    | { type: 'retrying'; attempt: number }
    | { type: 'action_unconfirmed' }
    | {
          type: 'snapshot_received';
          snapshot: Snapshot;
          clock: ClockSync;
          /** "action" = the reply to the player's own request; "read" = a background re-sync. Defaults to "action". */
          source?: 'action' | 'read';
      }
    | { type: 'resync_failed' }
    | { type: 'action_failed'; error: ApiError }
    | { type: 'reset' }
    | { type: 'dismiss_error' }
    | { type: 'dismiss_notice' }
    | { type: 'dismiss_answer_status' };

export const initialGameState: GameState = {
    ui: 'idle',
    snapshot: null,
    lastQuestion: null,
    clock: null,
    pending: null,
    error: null,
    notice: null,
    recovering: false,
    connection: 'ok',
    retryAttempt: 0,
    answerStatus: null,
};

/** Maps the server phase (plus in-flight work) to the single UI state the screens render. */
export function deriveUi(
    snapshot: Snapshot | null,
    pending: PendingAction | null,
    error: ApiError | null,
    recovering: boolean,
    fallback: UiState,
): UiState {
    const inFlight = pending !== null && error === null;

    if (recovering) return 'recovering';
    if (pending?.kind === 'start' && inFlight) return 'starting';
    if (!snapshot) return fallback;

    switch (snapshot.phase) {
        case 'completed':
            return 'completed';
        case 'choosing':
            return 'choosing';
        case 'answering':
            return pending?.kind === 'answer' && inFlight ? 'submitting' : 'answering';
        case 'awaiting_round':
            return snapshot.last_result ? 'feedback' : 'ready';
    }
}

function remember(previous: RememberedQuestion | null, snapshot: Snapshot | null): RememberedQuestion | null {
    const round = snapshot?.round;

    return round?.question ? { roundId: round.round_id, question: round.question } : previous;
}

/** The snapshot version an action was based on. Starting a game has none. */
function baseVersion(pending: PendingAction): number {
    return pending.kind === 'start' ? 0 : pending.expectedVersion;
}

/**
 * Works out what became of the player's answer from the server's snapshot, which is the truth.
 * "Accepted" and "timed out" are final; anything else can still be settled by a later snapshot.
 */
export function resolveAnswerStatus(previous: AnswerStatus | null, snapshot: Snapshot): AnswerStatus | null {
    if (!previous || previous.status === 'accepted' || previous.status === 'timed_out') {
        return previous;
    }

    const result = snapshot.last_result;

    if (result && result.round_id === previous.roundId) {
        if (result.outcome === 'timeout') {
            return { ...previous, status: 'timed_out', outcome: null };
        }

        if (result.selected_option_id === previous.optionId) {
            return { ...previous, status: 'accepted', outcome: result.outcome === 'correct' ? 'correct' : 'wrong' };
        }

        return { ...previous, status: 'not_recorded', outcome: null };
    }

    // That round is still open: keep waiting. Anything else means the game moved on without counting it.
    if (snapshot.round?.round_id === previous.roundId) {
        return previous;
    }

    return { ...previous, status: 'not_recorded', outcome: null };
}

export function gameReducer(state: GameState, action: GameAction): GameState {
    switch (action.type) {
        case 'boot':
            return { ...initialGameState, ui: 'loading' };

        case 'booted': {
            const snapshot = action.snapshot;

            return {
                ...initialGameState,
                snapshot,
                lastQuestion: remember(null, snapshot),
                clock: action.clock,
                notice: action.notice ?? null,
                connection: action.connection ?? 'ok',
                answerStatus: action.answerStatus ?? null,
                ui: deriveUi(snapshot, null, null, false, 'ready'),
            };
        }

        case 'action_started': {
            const previous = state.answerStatus;
            let answerStatus: AnswerStatus | null;

            if (action.pending.kind === 'answer') {
                // A replay of the same answer (same round and option) keeps its "recovered" history.
                const same = previous && previous.roundId === action.pending.roundId && previous.optionId === action.pending.optionId;

                answerStatus = { roundId: action.pending.roundId, optionId: action.pending.optionId, status: 'sending', outcome: null, recovered: same ? previous.recovered : false };
            } else {
                // Moving on to something else: a finished answer story no longer needs to be shown.
                answerStatus = previous && (previous.status === 'sending' || previous.status === 'unconfirmed') ? previous : null;
            }

            const next = { ...state, pending: action.pending, error: null, notice: null, connection: 'ok' as const, retryAttempt: 0, answerStatus };

            return { ...next, ui: deriveUi(next.snapshot, next.pending, null, false, next.ui) };
        }

        case 'retrying':
            return { ...state, connection: 'retrying', retryAttempt: action.attempt };

        case 'action_unconfirmed': {
            const previous = state.answerStatus;
            const answerStatus = state.pending?.kind === 'answer' && previous ? { ...previous, status: 'unconfirmed' as const, recovered: true } : previous;

            return {
                ...state,
                connection: 'unconfirmed',
                retryAttempt: 0,
                error: null,
                recovering: false,
                answerStatus,
                ui: deriveUi(state.snapshot, state.pending, null, false, state.ui),
            };
        }

        case 'snapshot_received': {
            const snapshot = acceptSnapshot(state.snapshot, action.snapshot);
            const accepted = snapshot === action.snapshot;
            const fromAction = (action.source ?? 'action') === 'action';

            let pending = state.pending;
            let connection = state.connection;
            let retryAttempt = state.retryAttempt;

            if (fromAction) {
                pending = null;
                connection = 'ok';
                retryAttempt = 0;
            } else if (state.connection === 'unconfirmed') {
                // A background read can settle an action we were unsure about: if the server moved on past the
                // version the action was based on, it was applied (or overtaken); either way stop waiting for it.
                if (!pending || (pending.kind !== 'start' && snapshot.state_version > baseVersion(pending))) {
                    pending = null;
                    connection = 'ok';
                    retryAttempt = 0;
                }
            }
            // A read that arrives while a request is still running must not clear that request.

            const answerStatus = resolveAnswerStatus(state.answerStatus, snapshot);

            return {
                ...state,
                snapshot,
                lastQuestion: accepted ? remember(state.lastQuestion, snapshot) : state.lastQuestion,
                // A stale response must not move the clock backwards either.
                clock: accepted ? action.clock : state.clock,
                pending,
                connection,
                retryAttempt,
                answerStatus,
                error: null,
                recovering: false,
                ui: deriveUi(snapshot, pending, null, false, 'ready'),
            };
        }

        case 'resync_failed':
            // A background read could not reach the server. Keep showing the last known game, say so, and keep trying.
            return {
                ...state,
                recovering: false,
                connection: 'unconfirmed',
                retryAttempt: 0,
                ui: deriveUi(state.snapshot, state.pending, null, false, state.snapshot ? state.ui : 'ready'),
            };

        case 'action_failed': {
            const description = describeError(action.error);
            const settledAnswer: AnswerStatus | null =
                state.pending?.kind === 'answer' && state.answerStatus && (state.answerStatus.status === 'sending' || state.answerStatus.status === 'unconfirmed')
                    ? { ...state.answerStatus, status: 'not_recorded', outcome: null }
                    : state.answerStatus;

            if (description.autoRefresh) {
                return { ...state, pending: null, error: null, notice: description.message, recovering: true, connection: 'ok', retryAttempt: 0, answerStatus: settledAnswer, ui: 'recovering' };
            }

            // Retryable failures keep the pending action so Retry reuses the same key.
            const keepPending = description.action === 'retry' || description.action === 'wait';
            const pending = keepPending ? state.pending : null;

            return {
                ...state,
                pending,
                error: action.error,
                recovering: false,
                connection: 'ok',
                retryAttempt: 0,
                answerStatus: keepPending ? state.answerStatus : settledAnswer,
                ui: deriveUi(state.snapshot, pending, action.error, false, state.snapshot ? state.ui : 'ready'),
            };
        }

        case 'dismiss_error': {
            return { ...state, error: null, pending: null, ui: deriveUi(state.snapshot, null, null, false, 'ready') };
        }

        case 'dismiss_notice':
            return { ...state, notice: null };

        case 'dismiss_answer_status':
            return { ...state, answerStatus: null };

        case 'reset':
            return { ...initialGameState, ui: 'ready' };
    }
}
