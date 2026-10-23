/**
 * Display helpers for the circular countdown. Presentation only: the server alone decides
 * deadlines and eligibility; these functions just turn "time left" into a ring and a colour.
 */

export const RING_RADIUS = 27;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Fraction of the phase still left, clamped to 0..1. Unknown time shows an empty ring. */
export function remainingFraction(remainingMs: number | null, totalMs: number): number {
    if (remainingMs === null || !Number.isFinite(remainingMs) || totalMs <= 0) {
        return 0;
    }

    return Math.min(1, Math.max(0, remainingMs / totalMs));
}

/** stroke-dashoffset that draws `fraction` of the ring (1 = full, 0 = empty). */
export function ringDashOffset(fraction: number): number {
    return RING_CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, fraction)));
}

export type TimerTone = 'calm' | 'warn' | 'danger';

/** Green while there is plenty of time, amber as it runs down, red for the last moments. */
export function timerTone(remainingMs: number | null, totalMs: number): TimerTone {
    if (remainingMs === null || totalMs <= 0) {
        return 'calm';
    }

    const fraction = remainingFraction(remainingMs, totalMs);
    const urgentMs = Math.min(3000, totalMs * 0.34);

    if (remainingMs <= urgentMs || (fraction <= 0.3 && remainingMs <= 10000)) {
        return 'danger';
    }

    if (fraction <= 0.6 && remainingMs <= 20000) {
        return 'warn';
    }

    return 'calm';
}

/** Whole seconds shown in the ring. */
export function secondsLabel(remainingMs: number | null): string {
    return remainingMs === null ? '–' : String(Math.max(0, Math.ceil(remainingMs / 1000)));
}

/**
 * Text for a screen-reader live region. It only changes when a threshold is crossed (not every
 * second), so assistive technology is not flooded with announcements.
 */
export function spokenWarning(remainingMs: number | null): string {
    if (remainingMs === null) return '';
    if (remainingMs <= 3000) return '3 seconds left';
    if (remainingMs <= 5000) return '5 seconds left';

    return '';
}

/**
 * The threshold (in seconds) the countdown has just crossed downwards, or null. Used to fire
 * the tick sound once per second in the last seconds.
 */
export function crossedThreshold(previousMs: number | null, currentMs: number | null, thresholdsSeconds: readonly number[]): number | null {
    if (previousMs === null || currentMs === null) {
        return null;
    }

    const crossed = thresholdsSeconds.filter((seconds) => previousMs > seconds * 1000 && currentMs <= seconds * 1000);

    return crossed.length > 0 ? Math.min(...crossed) : null;
}
