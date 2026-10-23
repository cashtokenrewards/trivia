import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { ERROR_CODES } from '../types/api';
import { MAX_AUTO_RETRIES, MAX_RECOVERY_TRIES, RECOVERY_INTERVAL_MS, backoffMs, isRetryable, retryAfterSeconds } from './retryPolicy';

const err = (status: number, code: ConstructorParameters<typeof ApiError>[1], details?: Record<string, unknown>) => new ApiError(status, code, 'x', false, details);

describe('isRetryable', () => {
    it('retries transient failures: no connection, server errors, an identical request still running', () => {
        expect(isRetryable(err(0, 'network_error'))).toBe(true);
        expect(isRetryable(err(500, 'server_error'))).toBe(true);
        expect(isRetryable(err(503, 'service_unavailable'))).toBe(true);
        expect(isRetryable(err(409, 'idempotency_in_progress'))).toBe(true);
        expect(isRetryable(err(0, 'unknown_error'))).toBe(true);
        expect(isRetryable(err(502, 'unknown_error'))).toBe(true);
    });

    it('never retries a decision the server has already made', () => {
        const never = ['unauthenticated', 'forbidden', 'session_not_found', 'stale_state_version', 'invalid_phase', 'phase_expired', 'idempotency_conflict', 'active_session_exists', 'already_participated', 'validation_failed', 'box_invalid', 'option_not_in_round', 'rate_limited', 'content_unavailable', 'csrf_mismatch'] as const;

        for (const code of never) {
            expect(isRetryable(err(409, code)), code).toBe(false);
        }
    });

    it('every contract error code has a deliberate answer', () => {
        const retryable = ERROR_CODES.filter((code) => isRetryable(err(500, code)));

        expect(retryable.sort()).toEqual(['idempotency_in_progress', 'server_error', 'service_unavailable']);
    });

    it('a 4xx with an unknown code is not retried', () => {
        expect(isRetryable(err(404, 'unknown_error'))).toBe(false);
    });
});

describe('backoff', () => {
    it('waits a little longer each time and never more than the last step', () => {
        expect([0, 1, 2, 3, 9].map((attempt) => backoffMs(attempt))).toEqual([400, 1200, 2500, 2500, 2500]);
        expect(backoffMs(-4)).toBe(400);
    });

    it('honours a short Retry-After and caps a long one', () => {
        expect(backoffMs(0, err(409, 'idempotency_in_progress', { retry_after_seconds: 1 }))).toBe(1000);
        expect(backoffMs(0, err(503, 'service_unavailable', { retry_after_seconds: 3 }))).toBe(3000);
        expect(backoffMs(0, err(503, 'service_unavailable', { retry_after_seconds: 600 }))).toBe(5000);
    });

    it('reads Retry-After only when it is a positive number', () => {
        expect(retryAfterSeconds(err(429, 'rate_limited', { retry_after_seconds: 4.2 }))).toBe(5);
        expect(retryAfterSeconds(err(429, 'rate_limited', { retry_after_seconds: 0 }))).toBeNull();
        expect(retryAfterSeconds(err(429, 'rate_limited', { retry_after_seconds: 'soon' }))).toBeNull();
        expect(retryAfterSeconds(err(429, 'rate_limited'))).toBeNull();
    });

    it('limits automatic effort so the player is told the truth quickly', () => {
        expect(MAX_AUTO_RETRIES).toBe(3);
        expect(RECOVERY_INTERVAL_MS * MAX_RECOVERY_TRIES).toBeLessThanOrEqual(30000);
    });
});
