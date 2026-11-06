import { describe, expect, it } from 'vitest';
import { GAME_URGENT_MS, RING_CIRCUMFERENCE, crossedThreshold, gameClockTone, remainingFraction, ringDashOffset, secondsLabel, spokenWarning, timerTone } from './timerVisuals';

describe('ring geometry', () => {
    it('clamps the remaining fraction and treats unknown time as empty', () => {
        expect(remainingFraction(5000, 10000)).toBe(0.5);
        expect(remainingFraction(20000, 10000)).toBe(1);
        expect(remainingFraction(-5, 10000)).toBe(0);
        expect(remainingFraction(null, 10000)).toBe(0);
        expect(remainingFraction(NaN, 10000)).toBe(0);
        expect(remainingFraction(5000, 0)).toBe(0);
    });

    it('draws a full ring at 1 and an empty ring at 0', () => {
        expect(ringDashOffset(1)).toBe(0);
        expect(ringDashOffset(0)).toBeCloseTo(RING_CIRCUMFERENCE);
        expect(ringDashOffset(0.5)).toBeCloseTo(RING_CIRCUMFERENCE / 2);
        expect(ringDashOffset(7)).toBe(0);
    });
});

describe('timerTone', () => {
    it('answer phase (10 s): calm, then amber, then red for the last three seconds', () => {
        expect(timerTone(9000, 10000)).toBe('calm');
        expect(timerTone(6000, 10000)).toBe('warn');
        expect(timerTone(3000, 10000)).toBe('danger');
        expect(timerTone(500, 10000)).toBe('danger');
    });

    it('choice phase (3 s) is not red from the start', () => {
        expect(timerTone(3000, 3000)).toBe('calm');
        expect(timerTone(1500, 3000)).toBe('warn');
        expect(timerTone(900, 3000)).toBe('danger');
    });

    it('game clock (90 s) only turns amber and red near the end', () => {
        expect(timerTone(80000, 90000)).toBe('calm');
        expect(timerTone(25000, 90000)).toBe('calm');
        expect(timerTone(18000, 90000)).toBe('warn');
        expect(timerTone(9000, 90000)).toBe('danger');
    });

    it('is calm when nothing is running', () => {
        expect(timerTone(null, 10000)).toBe('calm');
    });
});

describe('labels and warnings', () => {
    it('rounds up to whole seconds and never shows a negative number', () => {
        expect(secondsLabel(9100)).toBe('10');
        expect(secondsLabel(1)).toBe('1');
        expect(secondsLabel(0)).toBe('0');
        expect(secondsLabel(-300)).toBe('0');
        expect(secondsLabel(null)).toBe('–');
    });

    it('only speaks at the thresholds so screen readers are not flooded', () => {
        expect(spokenWarning(9000)).toBe('');
        expect(spokenWarning(5000)).toBe('5 seconds left');
        expect(spokenWarning(4200)).toBe('5 seconds left');
        expect(spokenWarning(3000)).toBe('3 seconds left');
        expect(spokenWarning(100)).toBe('3 seconds left');
        expect(spokenWarning(null)).toBe('');
    });

    it('reports a threshold exactly once as the countdown crosses it', () => {
        expect(crossedThreshold(3100, 2900, [3, 2, 1])).toBe(3);
        expect(crossedThreshold(2900, 2700, [3, 2, 1])).toBeNull();
        expect(crossedThreshold(2100, 1900, [3, 2, 1])).toBe(2);
        expect(crossedThreshold(3100, 900, [3, 2, 1])).toBe(1); // a long frame crossed several: report the nearest
        expect(crossedThreshold(null, 900, [3])).toBeNull();
        expect(crossedThreshold(900, null, [3])).toBeNull();
    });
});

describe('gameClockTone', () => {
    it('is calm (green) until 20 seconds are left, then danger (red)', () => {
        expect(GAME_URGENT_MS).toBe(20000);
        expect(gameClockTone(90000)).toBe('calm');
        expect(gameClockTone(20001)).toBe('calm');
        expect(gameClockTone(20000)).toBe('danger');
        expect(gameClockTone(5000)).toBe('danger');
        expect(gameClockTone(0)).toBe('danger');
    });

    it('stays calm when the time is not known yet', () => {
        expect(gameClockTone(null)).toBe('calm');
    });
});
