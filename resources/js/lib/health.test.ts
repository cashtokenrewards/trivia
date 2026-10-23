import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHealth } from './health';

afterEach(() => vi.restoreAllMocks());

describe('fetchHealth', () => {
    it('returns the parsed body on success', async () => {
        const body = { status: 'ok', app: 'cashtoken-trivia', time: '2026-10-19T00:00:00.000Z' };
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

        await expect(fetchHealth()).resolves.toEqual(body);
    });

    it('throws when the server responds with an error', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));

        await expect(fetchHealth()).rejects.toThrow('status 503');
    });
});
