import type { ErrorCode } from '../types/api';

/** Codes that only the browser can produce. */
export type ClientErrorCode = ErrorCode | 'network_error' | 'unknown_error';

export class ApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: ClientErrorCode,
        message: string,
        public readonly retryable: boolean,
        public readonly details?: Record<string, unknown>,
        public readonly correlationId?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }

    /** When this error was created, so a Retry-After countdown can be worked out from it. */
    readonly occurredAt: number = Date.now();
}

export function toApiError(error: unknown): ApiError {
    if (error instanceof ApiError) {
        return error;
    }

    return new ApiError(0, 'unknown_error', 'Something went wrong.', true);
}

/** What the screen should offer the player for an error. Mirrors docs/API_CONTRACT.md section 6. */
export type ErrorAction =
    | 'retry' // same logical action, same Idempotency-Key
    | 'refresh' // re-fetch the snapshot
    | 'resume' // open the session named in details.session_id
    | 'sign_in'
    | 'reload'
    | 'wait' // retry later; never auto-spam
    | 'landing'
    | 'practice_only'
    | 'none';

export interface ErrorDescription {
    title: string;
    message: string;
    action: ErrorAction;
    /** Silent re-fetch instead of a blocking error screen. */
    autoRefresh: boolean;
}

const refresh = (message: string): ErrorDescription => ({
    title: 'Updating…',
    message,
    action: 'refresh',
    autoRefresh: true,
});

export function describeError(error: ApiError): ErrorDescription {
    switch (error.code) {
        case 'unauthenticated':
            return { title: 'Please sign in', message: 'Sign in to play.', action: 'sign_in', autoRefresh: false };
        case 'forbidden':
            return { title: 'Not available', message: 'You cannot do that right now.', action: 'none', autoRefresh: false };
        case 'session_not_found':
        case 'no_active_session':
            return { title: 'No game in progress', message: 'Start a new game from the home screen.', action: 'landing', autoRefresh: false };
        case 'round_not_found':
        case 'invalid_phase':
        case 'phase_expired':
        case 'session_not_finished':
        case 'option_not_in_round':
            return refresh('The game moved on. Showing the latest state.');
        case 'stale_state_version':
        case 'idempotency_conflict':
            return refresh('Your screen was out of date. Showing the latest state.');
        case 'session_completed':
            return refresh('This game has finished. Loading your result.');
        case 'idempotency_in_progress':
            return { title: 'One moment', message: 'Your last tap is still being processed.', action: 'wait', autoRefresh: false };
        case 'active_session_exists':
            return { title: 'Game already open', message: 'You already have a game in progress.', action: 'resume', autoRefresh: false };
        case 'already_participated':
            return {
                title: 'Already played',
                message: 'You have already played the competition. You can still practise.',
                action: 'practice_only',
                autoRefresh: false,
            };
        case 'campaign_not_open':
            return { title: 'Not open yet', message: 'The competition has not opened yet.', action: 'none', autoRefresh: false };
        case 'campaign_closed':
            return { title: 'Competition closed', message: 'The competition has ended.', action: 'none', autoRefresh: false };
        case 'sessions_paused':
            return { title: 'Back soon', message: 'New games are paused for a short while.', action: 'none', autoRefresh: false };
        case 'csrf_mismatch':
            return { title: 'Session expired', message: 'Please reload the page and try again.', action: 'reload', autoRefresh: false };
        case 'validation_failed':
        case 'idempotency_key_required':
        case 'box_invalid':
            return { title: 'Something went wrong', message: 'That request was not accepted. Please try again.', action: 'none', autoRefresh: false };
        case 'rate_limited':
            return { title: 'Slow down', message: 'Too many requests. Please wait a moment and try again.', action: 'wait', autoRefresh: false };
        case 'content_unavailable':
            return { title: 'Game unavailable', message: 'The game is unavailable right now. Please try again later.', action: 'landing', autoRefresh: false };
        case 'network_error':
            return { title: 'No connection', message: 'We could not reach the server. Your game clock keeps running on the server.', action: 'retry', autoRefresh: false };
        case 'server_error':
        case 'service_unavailable':
        case 'unknown_error':
        default:
            return { title: 'Something went wrong', message: 'Please try again.', action: 'retry', autoRefresh: false };
    }
}
