import { afterEach, describe, expect, it, vi } from 'vitest';
import { isArenaSandboxRequested, isDemoQuiet, isDemoRequested } from './config';

afterEach(() => vi.unstubAllEnvs());

describe('demo gating', () => {
    it('needs ?demo=1 when the build has no demo default', () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('VITE_ALLOW_DEMO', 'true');
        vi.stubEnv('VITE_DEMO_DEFAULT', '');

        expect(isDemoRequested('')).toBe(false);
        expect(isDemoRequested('?demo=1')).toBe(true);
    });

    it('opens the demo with no query string when the static build sets the default', () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('VITE_ALLOW_DEMO', 'true');
        vi.stubEnv('VITE_DEMO_DEFAULT', 'true');

        expect(isDemoRequested('')).toBe(true);
    });

    it('never turns demo on in a build that does not allow it, even with the default set', () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('VITE_ALLOW_DEMO', '');
        vi.stubEnv('VITE_DEMO_DEFAULT', 'true');

        expect(isDemoRequested('?demo=1')).toBe(false);
        expect(isDemoRequested('')).toBe(false);
    });

    it('hides the demo labels only when the static build asks for it', () => {
        vi.stubEnv('VITE_DEMO_QUIET', '');
        expect(isDemoQuiet()).toBe(false);

        vi.stubEnv('VITE_DEMO_QUIET', 'true');
        expect(isDemoQuiet()).toBe(true);
    });

    it('keeps the arena sandbox behind ?arena=1', () => {
        vi.stubEnv('DEV', false);
        vi.stubEnv('VITE_ALLOW_DEMO', 'true');
        vi.stubEnv('VITE_DEMO_DEFAULT', 'true');

        expect(isArenaSandboxRequested('')).toBe(false);
        expect(isArenaSandboxRequested('?arena=1')).toBe(true);
    });
});
