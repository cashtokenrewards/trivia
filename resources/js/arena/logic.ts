import type { BoxId, Difficulty } from '../types/api';

/**
 * Pure helpers for the 3D arena. No Babylon imports, so they run (and are tested) anywhere.
 * The arena is presentation only: nothing here knows about correctness, scoring or rewards.
 */

export type QualityProfile = 'low' | 'medium';

export interface QualitySettings {
    /** Upper bound for devicePixelRatio. Lower means fewer pixels to shade on phones. */
    maxPixelRatio: number;
    antialias: boolean;
    /** How many sparkle and spill-coin particles may be alive at once. */
    sparkles: number;
    spillCoins: number;
}

export const QUALITY: Record<QualityProfile, QualitySettings> = {
    low: { maxPixelRatio: 1, antialias: false, sparkles: 10, spillCoins: 3 },
    medium: { maxPixelRatio: 1.75, antialias: true, sparkles: 28, spillCoins: 6 },
};

/** Babylon's hardware scaling level is the inverse of the pixel ratio actually rendered. */
export function hardwareScalingLevel(devicePixelRatio: number, quality: QualityProfile): number {
    const ratio = Math.min(Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1, QUALITY[quality].maxPixelRatio);

    return 1 / Math.max(1, ratio);
}

export interface BoxLayout {
    id: BoxId;
    label: string;
    difficulty: Difficulty;
    x: number;
    /** Linear RGB, 0 to 1. */
    color: [number, number, number];
}

/** Matches the box ids in docs/API_CONTRACT.md. Labels and points come from the server snapshot in real play. */
export const BOX_LAYOUT: readonly BoxLayout[] = [
    { id: 'quick_win', label: 'Quick Win', difficulty: 'easy', x: -2.65, color: [0.24, 0.86, 0.59] },
    { id: 'steady', label: 'Steady', difficulty: 'medium', x: 0, color: [0.25, 0.6, 1] },
    { id: 'high_roller', label: 'High Roller', difficulty: 'hard', x: 2.65, color: [1, 0.42, 0.42] },
];

export const BOX_IDS: readonly BoxId[] = BOX_LAYOUT.map((box) => box.id);

export function isBoxId(value: unknown): value is BoxId {
    return typeof value === 'string' && (BOX_IDS as readonly string[]).includes(value);
}

/** Reads the box id stamped on a picked mesh, or null for anything else (stage, tower, ...). */
export function boxIdFromMetadata(metadata: unknown): BoxId | null {
    if (metadata && typeof metadata === 'object' && 'boxId' in metadata) {
        const id = (metadata as { boxId: unknown }).boxId;

        return isBoxId(id) ? id : null;
    }

    return null;
}

/** Moves `current` toward `target` by at most `speedPerSecond * dtSeconds`, never overshooting. */
export function approach(current: number, target: number, speedPerSecond: number, dtSeconds: number): number {
    const step = Math.max(0, speedPerSecond * dtSeconds);

    if (Math.abs(target - current) <= step) {
        return target;
    }

    return current + Math.sign(target - current) * step;
}

/** A press-and-release that moved less than this many CSS pixels counts as a tap, however long it lasted. */
export const TAP_SLOP_PX = 18;

export function isTap(downX: number, downY: number, upX: number, upY: number, slop: number = TAP_SLOP_PX): boolean {
    return Math.hypot(upX - downX, upY - downY) <= slop;
}

export const MAX_SCORE = 2000;

/** Tower height as a 0..1 fraction of the maximum possible score. */
export function towerLevel(score: number, max: number = MAX_SCORE): number {
    if (!Number.isFinite(score) || max <= 0) {
        return 0;
    }

    return Math.min(1, Math.max(0, score / max));
}

export type Outcome = 'correct' | 'wrong' | 'timeout';

/** Stage flash colour per confirmed outcome (linear RGB). */
export const OUTCOME_COLOR: Record<Outcome, [number, number, number]> = {
    correct: [0.24, 0.86, 0.59],
    wrong: [1, 0.3, 0.3],
    timeout: [1, 0.55, 0.2],
};

export class ArenaUnavailableError extends Error {
    constructor(message = 'WebGL is not available on this device.') {
        super(message);
        this.name = 'ArenaUnavailableError';
    }
}

/** One coin in the stack is worth this many points, so a full stack is the 2,000 point maximum. */
export const MAX_COINS = 20;

/** How many coins the stack shows for a 0..1 score level. */
export function coinsForLevel(level: number): number {
    if (!Number.isFinite(level)) {
        return 0;
    }

    return Math.min(MAX_COINS, Math.max(0, Math.round(level * MAX_COINS)));
}

/** Overshooting ease-out, used for pops and bounces. t is clamped to 0..1. */
export function easeOutBack(t: number, overshoot = 1.70158): number {
    const x = Math.min(1, Math.max(0, t)) - 1;

    return 1 + (overshoot + 1) * x * x * x + overshoot * x * x;
}

export function easeInOutCubic(t: number): number {
    const x = Math.min(1, Math.max(0, t));

    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/**
 * A damped spring. Moving `target` makes `value` chase it with natural overshoot, which is
 * what gives the animation its bouncy, physical feel. Presentation only.
 */
export class Spring {
    value: number;
    velocity = 0;
    target: number;

    constructor(
        value = 0,
        public stiffness = 140,
        public damping = 12,
    ) {
        this.value = value;
        this.target = value;
    }

    step(dtSeconds: number): void {
        let left = Math.min(Math.max(dtSeconds, 0), 0.1);
        const h = 1 / 120; // fixed sub-steps keep the integration stable at any frame rate

        while (left > 1e-6) {
            const s = Math.min(h, left);
            const acceleration = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
            this.velocity += acceleration * s;
            this.value += this.velocity * s;
            left -= s;
        }
    }

    /** Jump straight to the target (used for reduced motion). */
    snap(): void {
        this.value = this.target;
        this.velocity = 0;
    }

    /** Give the spring a push without moving its target. */
    kick(velocity: number): void {
        this.velocity += velocity;
    }

    get settled(): boolean {
        return Math.abs(this.target - this.value) < 1e-3 && Math.abs(this.velocity) < 1e-3;
    }
}

/** Weak devices get the lighter profile (lower resolution, fewer particles). Unknown values count as capable. */
export function pickQuality(input: { cores?: number; memoryGb?: number }): QualityProfile {
    const weakCpu = input.cores !== undefined && input.cores > 0 && input.cores <= 4;
    const weakMemory = input.memoryGb !== undefined && input.memoryGb > 0 && input.memoryGb <= 2;

    return weakCpu || weakMemory ? 'low' : 'medium';
}
