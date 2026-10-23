import type { PendingAction } from './gameReducer';

/**
 * A reload or a crashed tab can lose the answer the player just sent before they learn what
 * happened. So the one action whose loss would matter most, the answer, leaves a small recovery
 * reference in sessionStorage: which round, which option, and the Idempotency-Key it was sent
 * with. After a reload the same key can be replayed safely: the server returns the saved outcome
 * if it already counted the answer, or counts it exactly once if it never arrived.
 *
 * Nothing secret is stored (an Idempotency-Key is only meaningful to the signed-in player's own
 * session), and the server rechecks ownership on every call. The snapshot remains the truth.
 * Storage may be blocked, so every access is guarded.
 */
export type AnswerReference = Extract<PendingAction, { kind: 'answer' }>;

const KEY = 'ct.recovery.v1';

function isReference(value: unknown): value is AnswerReference {
    if (!value || typeof value !== 'object') return false;

    const v = value as Record<string, unknown>;

    return (
        v.kind === 'answer' &&
        typeof v.key === 'string' &&
        v.key.length > 0 &&
        typeof v.sessionId === 'string' &&
        typeof v.roundId === 'string' &&
        typeof v.optionId === 'string' &&
        typeof v.expectedVersion === 'number' &&
        Number.isInteger(v.expectedVersion)
    );
}

export const recoveryStore = {
    save(reference: AnswerReference): void {
        try {
            window.sessionStorage.setItem(KEY, JSON.stringify(reference));
        } catch {
            // Without storage the game still works; only reload recovery of an in-flight answer is lost.
        }
    },

    load(): AnswerReference | null {
        try {
            const raw = window.sessionStorage.getItem(KEY);

            if (!raw) return null;

            const parsed: unknown = JSON.parse(raw);

            return isReference(parsed) ? parsed : null;
        } catch {
            return null;
        }
    },

    clear(): void {
        try {
            window.sessionStorage.removeItem(KEY);
        } catch {
            // Nothing to clear.
        }
    },
};

export type RecoveryStore = typeof recoveryStore;
