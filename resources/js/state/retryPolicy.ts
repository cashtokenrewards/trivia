import type { ApiError } from '../api/errors';

/**
 * When and how to retry a failed request. A retry is always the SAME logical action with the
 * SAME Idempotency-Key, so the server returns the saved outcome instead of doing it twice.
 * Retrying never pauses or extends the game clock: that runs on the server regardless.
 */

/** Immediate tries (with a short wait between) before the player is told we cannot confirm yet. */
export const MAX_AUTO_RETRIES = 3;

/** While an action is unconfirmed, how often the screen quietly tries again, and how many times before it stops and asks the player. */
export const RECOVERY_INTERVAL_MS = 3000;
export const MAX_RECOVERY_TRIES = 10;

const BACKOFF_MS = [400, 1200, 2500] as const;
const TRANSIENT_CODES = new Set<string>(['network_error', 'server_error', 'service_unavailable', 'idempotency_in_progress']);

/** Transient failures where trying the same thing again is safe and likely to help. */
export function isRetryable(error: ApiError): boolean {
    if (TRANSIENT_CODES.has(error.code)) return true;

    // An unrecognised failure with no HTTP status (a thrown non-API error) or a server-side status.
    return error.code === 'unknown_error' && (error.status === 0 || error.status >= 500);
}

/** Seconds the server asked us to wait (from a Retry-After header), if it said so. */
export function retryAfterSeconds(error: ApiError): number | null {
    const value = error.details?.retry_after_seconds;

    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

/** How long to wait before automatic try number `attempt` (0 = the first retry). Honours a short Retry-After. */
export function backoffMs(attempt: number, error?: ApiError): number {
    const base = BACKOFF_MS[Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)]!;
    const asked = error ? retryAfterSeconds(error) : null;

    return asked === null ? base : Math.min(5000, Math.max(base, asked * 1000));
}
