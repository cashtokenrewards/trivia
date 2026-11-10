/** Source of "now" for the demo server. Injectable so tests control time exactly. */
export interface Clock {
    now(): number;
}

/**
 * DEMO ONLY. A clock that can be paused, so someone exploring the demo can stop the timers and
 * take their time. The real server has no such thing: its clock never stops.
 */
export class PausableClock implements Clock {
    private offset = 0;
    private frozenAt: number | null = null;

    get paused(): boolean {
        return this.frozenAt !== null;
    }

    now(): number {
        return this.frozenAt ?? Date.now() - this.offset;
    }

    setPaused(paused: boolean): void {
        if (paused && this.frozenAt === null) {
            this.frozenAt = this.now();
        } else if (!paused && this.frozenAt !== null) {
            this.offset = Date.now() - this.frozenAt;
            this.frozenAt = null;
        }
    }
}

export const demoClock = new PausableClock();
