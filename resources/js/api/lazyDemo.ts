import { demoClock } from '../demo/demoClock';
import type { BoxId, Rules, SessionMode, SessionResult, Snapshot } from '../types/api';
import type { ActionOptions, GameApi } from './client';

/**
 * Loads the demo player (and its fixtures) on first use, so normal visitors never download
 * demo code. Behaves exactly like DemoGameApi.
 */
export class LazyDemoGameApi implements GameApi {
    readonly kind = 'demo' as const;

    private instance: Promise<GameApi> | null = null;

    constructor(private readonly rules?: Partial<Rules>) {}

    isClockFrozen(): boolean {
        return demoClock.paused;
    }

    private api(): Promise<GameApi> {
        this.instance ??= import('./demoApi').then((module) => new module.DemoGameApi(this.rules));

        return this.instance;
    }

    async startSession(mode: SessionMode, o: ActionOptions): Promise<Snapshot> {
        return (await this.api()).startSession(mode, o);
    }

    async getActiveSession(signal?: AbortSignal): Promise<Snapshot> {
        return (await this.api()).getActiveSession(signal);
    }

    async getSnapshot(sessionId: string, signal?: AbortSignal): Promise<Snapshot> {
        return (await this.api()).getSnapshot(sessionId, signal);
    }

    async openRound(sessionId: string, v: number, o: ActionOptions): Promise<Snapshot> {
        return (await this.api()).openRound(sessionId, v, o);
    }

    async selectBox(sessionId: string, roundId: string, boxId: BoxId, v: number, o: ActionOptions): Promise<Snapshot> {
        return (await this.api()).selectBox(sessionId, roundId, boxId, v, o);
    }

    async applyLifeline(sessionId: string, roundId: string, v: number, o: ActionOptions): Promise<Snapshot> {
        return (await this.api()).applyLifeline(sessionId, roundId, v, o);
    }

    async submitAnswer(sessionId: string, roundId: string, optionId: string, v: number, o: ActionOptions): Promise<Snapshot> {
        return (await this.api()).submitAnswer(sessionId, roundId, optionId, v, o);
    }

    async getResult(sessionId: string, signal?: AbortSignal): Promise<SessionResult> {
        return (await this.api()).getResult(sessionId, signal);
    }
}
