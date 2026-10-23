import { StrictMode, act, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoxId } from '../types/api';
import { useArenaScene, type ArenaModule, type UseArenaSceneOptions } from './useArenaScene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeScene {
    options: { onBoxSelected: (id: BoxId) => void; onContextLost?: () => void };
    disposed: number;
    dispose(): void;
}

function fakeModule(failOnCreate = false) {
    const scenes: FakeScene[] = [];

    class Unavailable extends Error {}

    const module = {
        ArenaUnavailableError: Unavailable,
        ArenaScene: {
            create: vi.fn((options: FakeScene['options']) => {
                if (failOnCreate) throw new Unavailable('no webgl');

                const scene: FakeScene = {
                    options,
                    disposed: 0,
                    dispose() {
                        this.disposed += 1;
                    },
                };
                scenes.push(scene);

                return scene;
            }),
        },
    } as unknown as ArenaModule;

    return { module, scenes };
}

type Latest = { status: string; failReason: string | null; hasScene: boolean };

function Harness(props: { load: () => Promise<ArenaModule>; report: (value: Latest) => void } & Partial<UseArenaSceneOptions>) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { status, failReason, sceneRef } = useArenaScene({
        canvasRef,
        quality: 'medium',
        reducedMotion: false,
        onBoxSelected: props.onBoxSelected ?? (() => {}),
        onContextLost: props.onContextLost,
        forceFailure: props.forceFailure,
        load: props.load,
    });

    useEffect(() => {
        props.report({ status, failReason, hasScene: sceneRef.current !== null });
    });

    return <canvas ref={canvasRef} />;
}

const flush = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });

async function mount(element: React.ReactElement) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(element);
    });
    await flush();

    return {
        async rerender(next: React.ReactElement) {
            await act(async () => root.render(next));
            await flush();
        },
        async unmount() {
            await act(async () => root.unmount());
            container.remove();
        },
    };
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('useArenaScene', () => {
    it('creates one scene per mount and disposes every one of them across ten mount/unmount cycles in Strict Mode', async () => {
        const { module, scenes } = fakeModule();
        const load = () => Promise.resolve(module);

        for (let i = 0; i < 10; i += 1) {
            const view = await mount(
                <StrictMode>
                    <Harness load={load} report={() => {}} />
                </StrictMode>,
            );
            await view.unmount();
        }

        expect(scenes).toHaveLength(10);
        expect(scenes.every((scene) => scene.disposed === 1)).toBe(true);
    });

    it('creates nothing when it unmounts before the module has loaded', async () => {
        const { module, scenes } = fakeModule();
        let release!: () => void;
        const load = () => new Promise<ArenaModule>((resolve) => (release = () => resolve(module)));

        const view = await mount(<Harness load={load} report={() => {}} />);
        await view.unmount();
        release();
        await flush();

        expect(scenes).toHaveLength(0);
    });

    it('reports ready once the scene exists and loading before that', async () => {
        const { module } = fakeModule();
        const seen: string[] = [];
        const view = await mount(<Harness load={() => Promise.resolve(module)} report={(value) => seen.push(value.status)} />);

        expect(seen[0]).toBe('loading');
        expect(seen.at(-1)).toBe('ready');
        await view.unmount();
    });

    it('falls back with a reason when WebGL cannot be created', async () => {
        const { module, scenes } = fakeModule(true);
        let latest: Latest | null = null;
        const view = await mount(<Harness load={() => Promise.resolve(module)} report={(value) => (latest = value)} />);

        expect(latest).toMatchObject({ status: 'fallback', failReason: 'no webgl', hasScene: false });
        expect(scenes).toHaveLength(0);
        await view.unmount();
    });

    it('falls back without creating a scene when failure is forced', async () => {
        const { module, scenes } = fakeModule();
        let latest: Latest | null = null;
        const view = await mount(<Harness load={() => Promise.resolve(module)} forceFailure report={(value) => (latest = value)} />);

        expect(latest).toMatchObject({ status: 'fallback' });
        expect(scenes).toHaveLength(0);
        await view.unmount();
    });

    it('disposes the scene, switches to fallback and tells the caller when the graphics context is lost', async () => {
        const { module, scenes } = fakeModule();
        const onContextLost = vi.fn();
        let latest: Latest | null = null;
        const view = await mount(<Harness load={() => Promise.resolve(module)} onContextLost={onContextLost} report={(value) => (latest = value)} />);

        await act(async () => scenes[0]!.options.onContextLost?.());

        expect(scenes[0]!.disposed).toBe(1);
        expect(onContextLost).toHaveBeenCalledTimes(1);
        expect(latest).toMatchObject({ status: 'fallback', failReason: 'The graphics context was lost.' });

        await view.unmount();
        expect(scenes[0]!.disposed).toBe(2); // dispose is idempotent in the real scene; unmount calls it again
    });

    it('always calls the latest onBoxSelected without rebuilding the scene', async () => {
        const { module, scenes } = fakeModule();
        const first = vi.fn();
        const second = vi.fn();
        const load = () => Promise.resolve(module);
        const view = await mount(<Harness load={load} onBoxSelected={first} report={() => {}} />);

        await view.rerender(<Harness load={load} onBoxSelected={second} report={() => {}} />);
        scenes[0]!.options.onBoxSelected('steady');

        expect(scenes).toHaveLength(1);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith('steady', expect.anything());
        await view.unmount();
    });
});

describe('useArenaScene when the 3D code cannot be downloaded', () => {
    it('falls back to 2D with a reason instead of waiting forever', async () => {
        let latest: Latest | null = null;
        const view = await mount(<Harness load={() => Promise.reject(new Error('Failed to fetch dynamically imported module'))} report={(value) => (latest = value)} />);

        expect(latest).toMatchObject({ status: 'fallback', failReason: 'Failed to fetch dynamically imported module', hasScene: false });
        await view.unmount();
    });

    it('does not report a failure for a component that has already gone away', async () => {
        let reject!: (error: Error) => void;
        const seen: string[] = [];
        const view = await mount(<Harness load={() => new Promise<ArenaModule>((_resolve, fail) => (reject = fail))} report={(value) => seen.push(value.status)} />);

        await view.unmount();
        reject(new Error('late failure'));
        await flush();

        expect(seen.includes('fallback')).toBe(false);
    });
});
