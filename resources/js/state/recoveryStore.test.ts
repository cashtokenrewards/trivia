import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoveryStore, type AnswerReference } from './recoveryStore';

const reference: AnswerReference = { kind: 'answer', key: 'k-1', sessionId: 's-1', roundId: 'r-1', optionId: 'o-1', expectedVersion: 4 };

afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
});

describe('recoveryStore', () => {
    it('round-trips an answer reference and clears it', () => {
        expect(recoveryStore.load()).toBeNull();

        recoveryStore.save(reference);
        expect(recoveryStore.load()).toEqual(reference);

        recoveryStore.clear();
        expect(recoveryStore.load()).toBeNull();
    });

    it('keeps only the logical action: ids and the key, nothing like a token or a name', () => {
        recoveryStore.save(reference);

        expect(Object.keys(JSON.parse(window.sessionStorage.getItem('ct.recovery.v1')!)).sort()).toEqual(['expectedVersion', 'key', 'kind', 'optionId', 'roundId', 'sessionId']);
    });

    it('ignores anything that is not a well-formed answer reference', () => {
        for (const bad of ['not json', '{}', JSON.stringify({ ...reference, kind: 'open' }), JSON.stringify({ ...reference, key: '' }), JSON.stringify({ ...reference, expectedVersion: 'four' }), JSON.stringify({ ...reference, expectedVersion: 1.5 }), 'null', '[]']) {
            window.sessionStorage.setItem('ct.recovery.v1', bad);

            expect(recoveryStore.load(), bad).toBeNull();
        }
    });

    it('survives blocked storage without throwing', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('blocked');
        });

        expect(() => recoveryStore.save(reference)).not.toThrow();
        expect(recoveryStore.load()).toBeNull();
        expect(() => recoveryStore.clear()).not.toThrow();
    });
});
