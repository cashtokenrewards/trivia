import { useEffect, useRef, useState, type RefObject } from 'react';
import type { BoxId } from '../types/api';
import type { ArenaScene, QualityProfile } from './ArenaScene';

export type ArenaModule = typeof import('./ArenaScene');
export type ArenaStatus = 'loading' | 'ready' | 'fallback';

/** Babylon is loaded on demand so it never bloats the first page load. */
export const loadArenaModule = (): Promise<ArenaModule> => import('./ArenaScene');

export interface UseArenaSceneOptions {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    quality: QualityProfile;
    reducedMotion: boolean;
    /** Fired once per round when the player taps a chest in 3D. */
    onBoxSelected: (boxId: BoxId, scene: ArenaScene) => void;
    /** Fired when the browser drops the WebGL context. The scene is already disposed. */
    onContextLost?: () => void;
    /** Developer switch: pretend WebGL is unavailable. */
    forceFailure?: boolean;
    /** Injectable for tests. */
    load?: () => Promise<ArenaModule>;
}

interface Result {
    key: string;
    status: ArenaStatus;
    reason: string | null;
}

/**
 * Scene adapter. Creates the Babylon scene when the canvas mounts and disposes everything
 * when it unmounts or the scene fails. Babylon objects (meshes, materials, the engine) live in
 * a ref, never in React state: they change every frame, React cannot diff them, and putting
 * them in state would re-render the whole tree 60 times a second for no benefit.
 *
 * It never starts a session, sends an answer or touches the server.
 */
export function useArenaScene(options: UseArenaSceneOptions) {
    const { canvasRef, forceFailure = false, load = loadArenaModule } = options;
    const sceneRef = useRef<ArenaScene | null>(null);
    const key = forceFailure ? 'forced-failure' : 'normal';
    const [result, setResult] = useState<Result>({ key, status: 'loading', reason: null });

    // Always call the latest handlers without rebuilding the scene when they change.
    const latest = useRef(options);
    useEffect(() => {
        latest.current = options;
    });

    useEffect(() => {
        let cancelled = false;
        let created: ArenaScene | null = null;

        load()
            .then((module) => {
                const canvas = canvasRef.current;

                // Strict Mode and fast navigation unmount before the module arrives: create nothing.
                if (cancelled || !canvas) return;

                try {
                    if (forceFailure) {
                        throw new module.ArenaUnavailableError('Simulated WebGL failure.');
                    }

                    const scene = module.ArenaScene.create({
                        canvas,
                        quality: latest.current.quality,
                        reducedMotion: latest.current.reducedMotion,
                        onBoxSelected: (boxId) => latest.current.onBoxSelected(boxId, scene),
                        onContextLost: () => {
                            scene.dispose();

                            if (sceneRef.current === scene) sceneRef.current = null;

                            setResult({ key, status: 'fallback', reason: 'The graphics context was lost.' });
                            latest.current.onContextLost?.();
                        },
                    });

                    created = scene;
                    sceneRef.current = scene;
                    setResult({ key, status: 'ready', reason: null });
                } catch (error) {
                    setResult({ key, status: 'fallback', reason: error instanceof Error ? error.message : 'Unknown error' });
                }
            })
            .catch((error: unknown) => {
                // The 3D code itself could not be downloaded (offline, a flaky network): the game is fully playable in 2D.
                if (!cancelled) setResult({ key, status: 'fallback', reason: error instanceof Error ? error.message : 'The 3D view could not be loaded.' });
            });

        return () => {
            cancelled = true;
            created?.dispose();

            if (sceneRef.current === created) sceneRef.current = null;
        };
    }, [canvasRef, forceFailure, key, load]);

    // A result from a previous key (the failure switch flipped) is stale: report loading until the new one lands.
    const current = result.key === key ? result : { key, status: 'loading' as const, reason: null };

    return { sceneRef, status: current.status, failReason: current.reason };
}
