import type { Snapshot } from '../types/api';

/**
 * Central snapshot adapter. Every snapshot from every source (action response, refresh,
 * recovery) passes through here so an older response can never overwrite a newer one.
 */
export function acceptSnapshot(current: Snapshot | null, incoming: Snapshot): Snapshot {
    if (!current || current.session_id !== incoming.session_id) {
        return incoming;
    }

    return incoming.state_version >= current.state_version ? incoming : current;
}

/**
 * How the browser's monotonic clock relates to server time.
 * `offsetMs` is added to performance.now() to estimate server time. It only drives the
 * display: the server alone decides deadlines and eligibility.
 */
export interface ClockSync {
    offsetMs: number;
    /** Demo mode: recorded timestamps, so the clock is frozen at the snapshot's server_now. */
    frozenServerNowMs: number | null;
}

/**
 * `server_now` was stamped while the server built the response, so by the time it arrived
 * roughly half the round trip has passed.
 */
export function syncClock(snapshot: Snapshot, requestStartedMono: number, responseMono: number, frozen: boolean): ClockSync {
    const serverNowMs = Date.parse(snapshot.server_now);
    const roundTrip = Math.max(0, responseMono - requestStartedMono);

    return {
        offsetMs: serverNowMs + roundTrip / 2 - responseMono,
        frozenServerNowMs: frozen ? serverNowMs : null,
    };
}

export function estimatedServerNowMs(clock: ClockSync, monoNow: number): number {
    return clock.frozenServerNowMs ?? clock.offsetMs + monoNow;
}

export function remainingMs(deadlineIso: string | null, clock: ClockSync | null, monoNow: number): number | null {
    if (!deadlineIso || !clock) {
        return null;
    }

    return Math.max(0, Date.parse(deadlineIso) - estimatedServerNowMs(clock, monoNow));
}
