import { RING_CIRCUMFERENCE, RING_RADIUS, gameClockTone, remainingFraction, ringDashOffset, secondsLabel, timerTone } from '../game/timerVisuals';

interface CircleTimerProps {
    remainingMs: number | null;
    totalMs: number;
    /** What is being counted: "Pick", "Answer" or "Game". */
    label: string;
    /** Demo only: timers are paused. */
    paused?: boolean;
    /**
     * The overall game clock: the ring stays full instead of draining. It is green, and turns red
     * when 20 seconds are left. The seconds are still counted down as a number.
     */
    still?: boolean;
}

/**
 * Circular countdown shown in the top corner. A display of the server's deadline, not a
 * source of truth: when it reaches zero the screen asks the server what happened.
 */
export function CircleTimer({ remainingMs, totalMs, label, paused = false, still = false }: CircleTimerProps) {
    // The draining ring for the overall game clock is switched off (`still`). To bring it back, stop passing `still`.
    const fraction = still ? 1 : remainingFraction(remainingMs, totalMs);
    const tone = still ? gameClockTone(remainingMs) : timerTone(remainingMs, totalMs);
    const seconds = secondsLabel(remainingMs);

    return (
        <div className="circle-timer" data-tone={tone} data-paused={paused} data-still={still} role="timer" aria-label={`${label}: ${seconds} seconds left${paused ? ' (paused)' : ''}`}>
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
