import { useEffect, useState } from 'react';
import { remainingMs, type ClockSync } from './snapshot';

/**
 * Display-only countdown to a server deadline. It reads the monotonic clock rather than
 * counting frames or ticks, and it never decides eligibility: the server does.
 */
export function useCountdown(deadlineIso: string | null, clock: ClockSync | null): number | null {
    const [remaining, setRemaining] = useState<number | null>(() => remainingMs(deadlineIso, clock, performance.now()));

    useEffect(() => {
        const tick = () => setRemaining(remainingMs(deadlineIso, clock, performance.now()));

        tick();

        if (!deadlineIso || !clock || clock.frozenServerNowMs !== null) {
            return;
        }

        const id = window.setInterval(tick, 100);

        return () => window.clearInterval(id);
    }, [deadlineIso, clock]);

    return remaining;
}
