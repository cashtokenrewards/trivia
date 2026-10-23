import { RING_CIRCUMFERENCE, RING_RADIUS, remainingFraction, ringDashOffset, secondsLabel, timerTone } from '../game/timerVisuals';

interface CircleTimerProps {
    remainingMs: number | null;
    totalMs: number;
    /** What is being counted: "Pick", "Answer" or "Game". */
    label: string;
    /** Demo only: timers are paused. */
    paused?: boolean;
}

/**
 * Circular countdown shown in the top corner. A display of the server's deadline, not a
 * source of truth: when it reaches zero the screen asks the server what happened.
 */
export function CircleTimer({ remainingMs, totalMs, label, paused = false }: CircleTimerProps) {
    const fraction = remainingFraction(remainingMs, totalMs);
    const tone = timerTone(remainingMs, totalMs);
    const seconds = secondsLabel(remainingMs);

    return (
        <div className="circle-timer" data-tone={tone} data-paused={paused} role="timer" aria-label={`${label}: ${seconds} seconds left${paused ? ' (paused)' : ''}`}>
            <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle className="ring-track" cx="32" cy="32" r={RING_RADIUS} />
                <circle className="ring-progress" cx="32" cy="32" r={RING_RADIUS} strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={ringDashOffset(fraction)} />
            </svg>
            <span className="ring-seconds" aria-hidden="true">
                {seconds}
            </span>
            <span className="ring-label" aria-hidden="true">
                {paused ? 'Paused' : label}
            </span>
        </div>
    );
}
