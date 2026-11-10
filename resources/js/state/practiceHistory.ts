const KEY = 'ct.practised.v1';

/**
 * Whether this browser has finished a practice game. It only decides whether to repeat the
 * "practise first?" advice. It is a convenience, not a rule: the one-competitive-game limit is
 * enforced by the server. Storage can be blocked, so every access is guarded.
 */
export function hasPractised(): boolean {
    try {
        return window.localStorage.getItem(KEY) === 'yes';
    } catch {
        return false;
    }
}

export function markPractised(): void {
    try {
        window.localStorage.setItem(KEY, 'yes');
    } catch {
        // Storage unavailable: the advice will simply be shown again next time.
    }
}
