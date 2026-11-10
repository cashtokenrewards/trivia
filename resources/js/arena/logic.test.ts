import { describe, expect, it } from 'vitest';
import { BOX_IDS, BOX_LAYOUT, MAX_COINS, QUALITY, Spring, approach, boxIdFromMetadata, coinsForLevel, easeInOutCubic, easeOutBack, hardwareScalingLevel, isBoxId, isTap, pickQuality, towerLevel } from './logic';

describe('hardwareScalingLevel', () => {
    it('caps the rendered pixel ratio per quality profile', () => {
        expect(hardwareScalingLevel(3, 'low')).toBe(1);
        expect(hardwareScalingLevel(3, 'medium')).toBeCloseTo(1 / QUALITY.medium.maxPixelRatio);
    });

    it('never renders more than the device pixel ratio and never scales below 1', () => {
        expect(hardwareScalingLevel(1.25, 'medium')).toBeCloseTo(1 / 1.25);
        expect(hardwareScalingLevel(0.5, 'medium')).toBe(1);
    });

    it('survives nonsense input', () => {
        expect(hardwareScalingLevel(NaN, 'medium')).toBe(1);
        expect(hardwareScalingLevel(-2, 'low')).toBe(1);
    });
});

describe('box identity', () => {
    it('uses exactly the contract box ids', () => {
        expect([...BOX_IDS]).toEqual(['quick_win', 'steady', 'high_roller']);
        expect(BOX_LAYOUT.map((b) => b.difficulty)).toEqual(['easy', 'medium', 'hard']);
    });

    it('reads a box id from mesh metadata and rejects everything else', () => {
        expect(boxIdFromMetadata({ boxId: 'steady' })).toBe('steady');
        expect(boxIdFromMetadata({ boxId: 'nope' })).toBeNull();
        expect(boxIdFromMetadata({})).toBeNull();
        expect(boxIdFromMetadata(null)).toBeNull();
        expect(boxIdFromMetadata('steady')).toBeNull();
        expect(isBoxId('high_roller')).toBe(true);
        expect(isBoxId(3)).toBe(false);
    });

    it('lays the boxes out left to right without overlap', () => {
        const xs = BOX_LAYOUT.map((b) => b.x);

        expect([...xs].sort((a, b) => a - b)).toEqual(xs);
        expect(xs[1]! - xs[0]!).toBeGreaterThan(2);
    });
});

describe('isTap', () => {
    it('accepts small drift and rejects a drag', () => {
        expect(isTap(100, 100, 100, 100)).toBe(true);
        expect(isTap(100, 100, 108, 106)).toBe(true);
        expect(isTap(100, 100, 160, 100)).toBe(false);
        expect(isTap(0, 0, 30, 0, 40)).toBe(true);
    });
});

describe('approach', () => {
    it('moves toward the target at the given speed and never overshoots', () => {
        expect(approach(0, 10, 5, 1)).toBe(5);
        expect(approach(0, 10, 5, 3)).toBe(10);
        expect(approach(10, 0, 4, 1)).toBe(6);
        expect(approach(2, 2, 4, 1)).toBe(2);
    });

    it('does not move for zero time or negative speed', () => {
        expect(approach(1, 5, 5, 0)).toBe(1);
        expect(approach(1, 5, -5, 1)).toBe(1);
    });
});

describe('towerLevel', () => {
    it('is a clamped fraction of the 2000 point maximum', () => {
        expect(towerLevel(0)).toBe(0);
        expect(towerLevel(1000)).toBe(0.5);
        expect(towerLevel(2000)).toBe(1);
        expect(towerLevel(99999)).toBe(1);
        expect(towerLevel(-5)).toBe(0);
        expect(towerLevel(NaN)).toBe(0);
    });
});

describe('coinsForLevel', () => {
    it('maps the 0..1 level onto 20 coins of 100 points each', () => {
        expect(coinsForLevel(0)).toBe(0);
        expect(coinsForLevel(0.15)).toBe(3);
        expect(coinsForLevel(0.5)).toBe(10);
        expect(coinsForLevel(1)).toBe(MAX_COINS);
        expect(coinsForLevel(9)).toBe(MAX_COINS);
        expect(coinsForLevel(-1)).toBe(0);
        expect(coinsForLevel(NaN)).toBe(0);
    });
});

describe('easing', () => {
    it('easeOutBack starts at 0, ends at 1 and overshoots in between', () => {
        expect(easeOutBack(0)).toBeCloseTo(0);
        expect(easeOutBack(1)).toBeCloseTo(1);
        expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => easeOutBack(t)))).toBeGreaterThan(1);
    });

    it('easeInOutCubic is monotonic between 0 and 1', () => {
        let previous = -1;

        for (let t = 0; t <= 1; t += 0.1) {
            const value = easeInOutCubic(t);
            expect(value).toBeGreaterThanOrEqual(previous);
            previous = value;
        }

        expect(easeInOutCubic(0)).toBe(0);
        expect(easeInOutCubic(1)).toBe(1);
    });
});

describe('Spring', () => {
    const run = (spring: Spring, seconds: number, peak = { max: -Infinity }) => {
        for (let t = 0; t < seconds; t += 1 / 60) {
            spring.step(1 / 60);
            peak.max = Math.max(peak.max, spring.value);
        }

        return peak.max;
    };

    it('settles on its target', () => {
        const spring = new Spring(0, 140, 12);
        spring.target = 1;
        run(spring, 3);

        expect(spring.value).toBeCloseTo(1, 2);
        expect(spring.settled).toBe(true);
    });

    it('overshoots when under-damped, which gives the bounce', () => {
        const spring = new Spring(0, 140, 8);
        spring.target = 1;

        expect(run(spring, 2)).toBeGreaterThan(1.05);
    });

    it('does not overshoot when heavily damped', () => {
        const spring = new Spring(0, 60, 30);
        spring.target = 1;

        expect(run(spring, 4)).toBeLessThanOrEqual(1.001);
    });

    it('stays stable with a huge frame time and snaps instantly', () => {
        const spring = new Spring(0, 300, 14);
        spring.target = 1;
        spring.step(5);

        expect(Number.isFinite(spring.value)).toBe(true);

        spring.target = 7;
        spring.snap();

        expect(spring.value).toBe(7);
        expect(spring.velocity).toBe(0);
    });

    it('kick pushes the value without moving the target', () => {
        const spring = new Spring(1, 140, 12);
        spring.kick(-6);
        spring.step(0.05);

        expect(spring.value).toBeLessThan(1);
        expect(spring.target).toBe(1);
    });
});

describe('pickQuality', () => {
    it('picks low for weak devices and medium otherwise', () => {
        expect(pickQuality({ cores: 4 })).toBe('low');
        expect(pickQuality({ memoryGb: 2 })).toBe('low');
        expect(pickQuality({ cores: 8, memoryGb: 8 })).toBe('medium');
        expect(pickQuality({})).toBe('medium');
        expect(pickQuality({ cores: 0 })).toBe('medium');
    });
});
