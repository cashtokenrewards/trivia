import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { GameApi } from '../api/client';
import { ApiError, describeError, toApiError } from '../api/errors';
import type { BoxId, SessionMode, Snapshot } from '../types/api';
import { gameReducer, initialGameState, resolveAnswerStatus, type AnswerStatus, type PendingAction } from './gameReducer';
import { recoveryStore, type RecoveryStore } from './recoveryStore';
import { MAX_AUTO_RETRIES, MAX_RECOVERY_TRIES, RECOVERY_INTERVAL_MS, backoffMs, isRetryable } from './retryPolicy';
import { syncClock, type ClockSync } from './snapshot';

const newKey = () => crypto.randomUUID();
const defaultSleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function clockFor(api: GameApi, snapshot: Snapshot, startedMono: number): ClockSync {
    return syncClock(snapshot, startedMono, performance.now(), api.isClockFrozen?.() ?? false);
}

export interface UseGameOptions {
    /** Waiting between automatic retries. Injectable so tests do not really wait. */
    sleep?: (ms: number) => Promise<void>;
    /** Where the in-flight answer's recovery reference is kept. */
    recovery?: RecoveryStore;
    /** Turn off the quiet retry loop and the resume/online triggers (tests drive them by hand). */
    autoRecover?: boolean;
}

/**
 * Owns the game state machine for one player. Components call the action methods; every
 * server answer flows through the reducer's snapshot adapter. Nothing here decides a rule.
 *
 * Failure handling, in plain words:
 *  - One request at a time. A second tap while one is running is ignored, so a double tap can
 *    never become two actions, and Retry can never duplicate one.
 *  - If a request fails in a way that is safe to repeat (no connection, a server hiccup), it is
 *    repeated a few times with the SAME Idempotency-Key. The server then either returns the saved
 *    outcome (it had already counted it) or counts it once.
 *  - If it still cannot be confirmed, the game stays on screen, says so honestly, and keeps trying
 *    quietly. Nothing here pauses or extends the clock: that runs on the server.
 *  - The server's snapshot is always the truth: after a reload, a return from the background or a
 *    reconnect, the screen re-reads it.
 */
export function useGame(api: GameApi, options: UseGameOptions = {}) {
    const { sleep = defaultSleep, recovery = recoveryStore, autoRecover = true } = options;
    const [state, dispatch] = useReducer(gameReducer, initialGameState);
    const stateRef = useRef(state);
    const busyRef = useRef(false);
    const mountedRef = useRef(true);
    const readRef = useRef<Promise<void> | null>(null);
    const triesRef = useRef<{ id: string; count: number }>({ id: '', count: 0 });

    // Options are read through refs so a caller passing a new inline function can never restart the effects below.
    const sleepRef = useRef(sleep);
    const recoveryRef = useRef(recovery);
    useEffect(() => {
        sleepRef.current = sleep;
        recoveryRef.current = recovery;
    });

    // Event handlers read the latest committed state from here (never during render).
    useEffect(() => {
        stateRef.current = state;
    });

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
        };
    }, []);

    const call = useCallback(
        (pending: PendingAction): Promise<Snapshot> => {
            const o = { idempotencyKey: pending.key };

            switch (pending.kind) {
                case 'start':
                    return api.startSession(pending.mode, o);
                case 'open':
                    return api.openRound(pending.sessionId, pending.expectedVersion, o);
                case 'select':
                    return api.selectBox(pending.sessionId, pending.roundId, pending.boxId, pending.expectedVersion, o);
                case 'lifeline':
                    return api.applyLifeline(pending.sessionId, pending.roundId, pending.expectedVersion, o);
                case 'answer':
                    return api.submitAnswer(pending.sessionId, pending.roundId, pending.optionId, pending.expectedVersion, o);
            }
        },
        [api],
    );

    const perform = useCallback(
        async (pending: PendingAction): Promise<Snapshot | null> => {
            if (busyRef.current) return null; // one request at a time

            busyRef.current = true;

            try {
                dispatch({ type: 'action_started', pending });

                if (pending.kind === 'answer') recoveryRef.current.save(pending);

                let lastError: ApiError | null = null;

                for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt += 1) {
                    if (attempt > 0) {
                        dispatch({ type: 'retrying', attempt });
                        await sleepRef.current(backoffMs(attempt - 1, lastError ?? undefined));

                        if (!mountedRef.current) return null;
                    }

                    const startedMono = performance.now();

                    try {
                        const snapshot = await call(pending); // the SAME pending action, so the SAME Idempotency-Key

                        if (!mountedRef.current) return snapshot;

                        triesRef.current = { id: '', count: 0 };
                        if (pending.kind === 'answer') recoveryRef.current.clear();
                        dispatch({ type: 'snapshot_received', snapshot, clock: clockFor(api, snapshot, startedMono), source: 'action' });

                        return snapshot;
                    } catch (raw) {
                        lastError = toApiError(raw);

                        if (!isRetryable(lastError)) break;
                    }
                }

                if (!mountedRef.current) return null;

                const error = lastError ?? new ApiError(0, 'unknown_error', 'Something went wrong.', true);

                if (isRetryable(error) && stateRef.current.snapshot && pending.kind !== 'start') {
                    // We cannot tell what the server did. Stay in the game, say so, and keep the key for the quiet retries.
                    dispatch({ type: 'action_unconfirmed' });

                    return null;
                }

                if (pending.kind === 'answer' && !isRetryable(error)) recoveryRef.current.clear();

                dispatch({ type: 'action_failed', error });

                return null;
            } finally {
                busyRef.current = false;
            }
        },
        [api, call],
    );

    /** Re-read the server's snapshot. Shares one request if several triggers fire together. */
    const refresh = useCallback((): Promise<void> => {
        if (readRef.current) return readRef.current;

        const run = async () => {
            const current = stateRef.current.snapshot;
            const startedMono = performance.now();

            try {
                const snapshot = current ? await api.getSnapshot(current.session_id) : await api.getActiveSession();

                if (!mountedRef.current) return;

                triesRef.current = { id: '', count: 0 };
                dispatch({ type: 'snapshot_received', snapshot, clock: clockFor(api, snapshot, startedMono), source: 'read' });
            } catch (raw) {
                if (!mountedRef.current) return;

                const error = toApiError(raw);

                if (!current && (error.code === 'no_active_session' || error.status === 404)) {
                    dispatch({ type: 'booted', snapshot: null, clock: null }); // nothing to resume

                    return;
                }

                if (isRetryable(error)) {
                    dispatch({ type: 'resync_failed' }); // keep showing the last known game; the quiet loop tries again

                    return;
                }

                // A re-sync that fails for a real reason must not trigger another re-sync: show an error instead.
                dispatch({ type: 'action_failed', error: describeError(error).autoRefresh ? new ApiError(0, 'server_error', 'Could not refresh.', true) : error });
            }
        };

        const promise = run().finally(() => {
            readRef.current = null;
        });

        readRef.current = promise;

        return promise;
    }, [api]);

    // On load or reload: ask the server for the game in progress. This only READS: it can never create an attempt.
    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;

        dispatch({ type: 'boot' });

        void (async () => {
            let lastError: ApiError | null = null;

            for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt += 1) {
                if (attempt > 0) await sleepRef.current(backoffMs(attempt - 1, lastError ?? undefined));

                if (cancelled) return;

                const startedMono = performance.now();

                try {
                    const snapshot = await api.getActiveSession(controller.signal);

                    if (cancelled) return;

                    // Did the player send an answer that we never heard back about before the reload?
                    const reference = recoveryRef.current.load();
                    let answerStatus: AnswerStatus | null = null;
                    let replay: typeof reference = null;

                    if (reference) {
                        const waiting: AnswerStatus = { roundId: reference.roundId, optionId: reference.optionId, status: 'unconfirmed', outcome: null, recovered: true };

                        if (reference.sessionId !== snapshot.session_id) {
                            recoveryRef.current.clear();
                        } else if (snapshot.last_result?.round_id === reference.roundId) {
                            answerStatus = resolveAnswerStatus(waiting, snapshot); // the server already settled it
                            recoveryRef.current.clear();
                        } else if (snapshot.round?.round_id === reference.roundId && snapshot.round.status === 'answering') {
                            replay = reference; // never arrived: send it again, with its original key
                            answerStatus = waiting; // so the player is told it was recovered
                        } else {
                            recoveryRef.current.clear();
                        }
                    }

                    dispatch({ type: 'booted', snapshot, clock: clockFor(api, snapshot, startedMono), answerStatus });

                    if (replay) void perform(replay);

                    return;
                } catch (raw) {
                    if ((raw as Error).name === 'AbortError' || cancelled) return;

                    lastError = toApiError(raw);

                    if (lastError.code === 'no_active_session' || lastError.status === 404) {
                        recoveryRef.current.clear();
                        dispatch({ type: 'booted', snapshot: null, clock: null });

                        return;
                    }

                    if (!isRetryable(lastError)) break;
                }
            }

            if (cancelled) return;

            // Could not check. Do not strand the player on a spinner: show the home screen, say so, and keep checking quietly.
            dispatch({
                type: 'booted',
                snapshot: null,
                clock: null,
                connection: lastError && isRetryable(lastError) ? 'unconfirmed' : 'ok',
                notice: lastError && !isRetryable(lastError) ? 'We could not check for a game in progress.' : null,
            });
        })();

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [api, perform]);

    // Silent re-sync after a stale/phase error. A read, never a mutation.
    useEffect(() => {
        if (state.ui === 'recovering') {
            void refresh();
        }
    }, [state.ui, refresh]);

    // While we cannot confirm something, quietly try again: the same action with the same key, or a plain read.
    const troubled = state.connection !== 'ok';

    useEffect(() => {
        if (!troubled || !autoRecover) return;

        const attempt = () => {
            if (busyRef.current) return;
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // wait for the online event

            const pending = stateRef.current.pending;
            const id = pending?.key ?? 'read';

            if (triesRef.current.id !== id) triesRef.current = { id, count: 0 };

            if (triesRef.current.count >= MAX_RECOVERY_TRIES) return; // stop nagging; the player can tap Try again

            triesRef.current.count += 1;
            void (pending ? perform(pending) : refresh());
        };

        const id = window.setInterval(attempt, RECOVERY_INTERVAL_MS);

        return () => window.clearInterval(id);
    }, [troubled, autoRecover, perform, refresh]);

    // Coming back (from the background, a restored tab, or a lost connection): the clock never paused, so re-read the truth.
    useEffect(() => {
        if (!autoRecover) return;

        const resync = () => {
            const current = stateRef.current;

            if (busyRef.current || current.snapshot?.status === 'completed') return;
            if (!current.snapshot && current.connection === 'ok') return;

            triesRef.current = { id: '', count: 0 };
            void (current.connection === 'unconfirmed' && current.pending ? perform(current.pending) : refresh());
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') resync();
        };
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) resync();
        };

        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('pageshow', onPageShow);
        window.addEventListener('online', resync);

        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('pageshow', onPageShow);
            window.removeEventListener('online', resync);
        };
    }, [autoRecover, perform, refresh]);

    const requireSnapshot = (): Snapshot => {
        const snapshot = stateRef.current.snapshot;

        if (!snapshot) {
            throw new ApiError(409, 'invalid_phase', 'No game in progress.', false);
        }

        return snapshot;
    };

    /** Start is one logical action, then the first round opens as a second, separately keyed action. */
    const runStart = async (pending: Extract<PendingAction, { kind: 'start' }>) => {
        const started = await perform(pending);

        if (started) {
            await perform({ kind: 'open', key: newKey(), sessionId: started.session_id, expectedVersion: started.state_version });
        }
    };

    return {
        state,
        start: (mode: SessionMode) => runStart({ kind: 'start', key: newKey(), mode }),
        openRound: () => {
            const s = requireSnapshot();
            return perform({ kind: 'open', key: newKey(), sessionId: s.session_id, expectedVersion: s.state_version });
        },
        selectBox: (boxId: BoxId) => {
            const s = requireSnapshot();
            if (!s.round) return Promise.resolve();
            return perform({ kind: 'select', key: newKey(), sessionId: s.session_id, roundId: s.round.round_id, boxId, expectedVersion: s.state_version });
        },
        lifeline: () => {
            const s = requireSnapshot();
            if (!s.round) return Promise.resolve();
            return perform({ kind: 'lifeline', key: newKey(), sessionId: s.session_id, roundId: s.round.round_id, expectedVersion: s.state_version });
        },
        answer: (optionId: string) => {
            const s = requireSnapshot();
            if (!s.round) return Promise.resolve();
            return perform({ kind: 'answer', key: newKey(), sessionId: s.session_id, roundId: s.round.round_id, optionId, expectedVersion: s.state_version });
        },
        /** Retry the unconfirmed or failed logical action with its ORIGINAL Idempotency-Key (or just re-read). Cannot duplicate it. */
        retry: () => {
            triesRef.current = { id: '', count: 0 };

            const pending = stateRef.current.pending;

            if (pending?.kind === 'start') return runStart(pending); // a retried start must go on to open the first round

            return pending ? perform(pending) : refresh();
        },
        refresh,
        reset: () => {
            recoveryRef.current.clear();
            dispatch({ type: 'reset' });
        },
        dismissError: () => dispatch({ type: 'dismiss_error' }),
        dismissNotice: () => dispatch({ type: 'dismiss_notice' }),
        dismissAnswerStatus: () => dispatch({ type: 'dismiss_answer_status' }),
    };
}

export type GameController = ReturnType<typeof useGame>;
