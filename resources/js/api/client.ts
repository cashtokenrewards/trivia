import type { BoxId, SessionMode, SessionResult, Snapshot, ApiErrorBody, ErrorCode } from '../types/api';
import { ERROR_CODES } from '../types/api';
import { ApiError, type ClientErrorCode } from './errors';

export interface ActionOptions {
    /** One key per logical action. Every retry of that action reuses it. */
    idempotencyKey: string;
    signal?: AbortSignal;
}

/** Transport-neutral game API. Real = Laravel over HTTP; demo = recorded fixtures. */
export interface GameApi {
    readonly kind: 'http' | 'demo';
    /** Demo only: true while the demo clock is paused, so the screen can freeze its countdown. */
    isClockFrozen?(): boolean;
    startSession(mode: SessionMode, options: ActionOptions): Promise<Snapshot>;
    getActiveSession(signal?: AbortSignal): Promise<Snapshot>;
    getSnapshot(sessionId: string, signal?: AbortSignal): Promise<Snapshot>;
    openRound(sessionId: string, expectedStateVersion: number, options: ActionOptions): Promise<Snapshot>;
    selectBox(sessionId: string, roundId: string, boxId: BoxId, expectedStateVersion: number, options: ActionOptions): Promise<Snapshot>;
    applyLifeline(sessionId: string, roundId: string, expectedStateVersion: number, options: ActionOptions): Promise<Snapshot>;
    submitAnswer(sessionId: string, roundId: string, optionId: string, expectedStateVersion: number, options: ActionOptions): Promise<Snapshot>;
    getResult(sessionId: string, signal?: AbortSignal): Promise<SessionResult>;
}

const BASE = '/api/v1';

function readXsrfToken(): string | null {
    const cookie = document.cookie.split('; ').find((part) => part.startsWith('XSRF-TOKEN='));

    return cookie ? decodeURIComponent(cookie.slice('XSRF-TOKEN='.length)) : null;
}

function isKnownCode(code: unknown): code is ErrorCode {
    return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code);
}

function fallbackCode(status: number): ClientErrorCode {
    if (status === 401) return 'unauthenticated';
    if (status === 403) return 'forbidden';
    if (status === 419) return 'csrf_mismatch';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'server_error';

    return 'unknown_error';
}

/** Seconds from a Retry-After header (the numeric form), or undefined. */
function retryAfterFrom(response: Response): number | undefined {
    const raw = response.headers.get('Retry-After');
    const value = raw === null ? NaN : Number(raw);

    return Number.isFinite(value) && value > 0 ? value : undefined;
}

export async function parseError(response: Response): Promise<ApiError> {
    const body = await response.json().then(
        (value: unknown) => value as Partial<ApiErrorBody> | null,
        () => null,
    );

    const envelope = body?.error;
    const retryAfter = retryAfterFrom(response);

    if (envelope && isKnownCode(envelope.code)) {
        // A Retry-After header tells the screen how long to wait; the body's own details are kept too.
        const details = retryAfter === undefined ? envelope.details : { retry_after_seconds: retryAfter, ...envelope.details };

        return new ApiError(response.status, envelope.code, String(envelope.message ?? ''), Boolean(envelope.retryable), details, envelope.correlation_id);
    }

    // Not our envelope (HTML error page, proxy error, route not found): never show raw text.
    return new ApiError(
        response.status,
        fallbackCode(response.status),
        'Unexpected server response.',
        response.status >= 500,
        retryAfter === undefined ? undefined : { retry_after_seconds: retryAfter },
    );
}

export class HttpGameApi implements GameApi {
    readonly kind = 'http' as const;

    private async request<T>(
        method: 'GET' | 'POST',
        path: string,
        options: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal } = {},
    ): Promise<T> {
        const headers: Record<string, string> = { Accept: 'application/json' };

        if (method === 'POST') {
            headers['Content-Type'] = 'application/json';

            const xsrf = readXsrfToken();
            if (xsrf) headers['X-XSRF-TOKEN'] = xsrf;
            if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
        }

        let response: Response;

        try {
            response = await fetch(`${BASE}${path}`, {
                method,
                headers,
                credentials: 'same-origin',
                body: method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
                signal: options.signal,
            });
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                throw error;
            }

            throw new ApiError(0, 'network_error', 'Network request failed.', true);
        }

        if (!response.ok) {
            throw await parseError(response);
        }

        return (await response.json()) as T;
    }

    startSession(mode: SessionMode, o: ActionOptions) {
        return this.request<Snapshot>('POST', '/sessions', {
            body: { mode, client_ready: true },
            idempotencyKey: o.idempotencyKey,
            signal: o.signal,
        });
    }

    getActiveSession(signal?: AbortSignal) {
        return this.request<Snapshot>('GET', '/sessions/active', { signal });
    }

    getSnapshot(sessionId: string, signal?: AbortSignal) {
        return this.request<Snapshot>('GET', `/sessions/${encodeURIComponent(sessionId)}`, { signal });
    }

    openRound(sessionId: string, v: number, o: ActionOptions) {
        return this.request<Snapshot>('POST', `/sessions/${encodeURIComponent(sessionId)}/rounds`, {
            body: { expected_state_version: v },
            idempotencyKey: o.idempotencyKey,
            signal: o.signal,
        });
    }

    selectBox(sessionId: string, roundId: string, boxId: BoxId, v: number, o: ActionOptions) {
        return this.request<Snapshot>('POST', `/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/box`, {
            body: { box_id: boxId, expected_state_version: v },
            idempotencyKey: o.idempotencyKey,
            signal: o.signal,
        });
    }

    applyLifeline(sessionId: string, roundId: string, v: number, o: ActionOptions) {
        return this.request<Snapshot>('POST', `/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/lifeline`, {
            body: { expected_state_version: v },
            idempotencyKey: o.idempotencyKey,
            signal: o.signal,
        });
    }

    submitAnswer(sessionId: string, roundId: string, optionId: string, v: number, o: ActionOptions) {
        return this.request<Snapshot>('POST', `/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/answer`, {
            body: { option_id: optionId, expected_state_version: v },
            idempotencyKey: o.idempotencyKey,
            signal: o.signal,
        });
    }

    getResult(sessionId: string, signal?: AbortSignal) {
        return this.request<SessionResult>('GET', `/sessions/${encodeURIComponent(sessionId)}/result`, { signal });
    }
}
