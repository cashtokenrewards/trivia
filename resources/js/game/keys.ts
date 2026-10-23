import type { UiState } from '../state/gameReducer';

/**
 * Keyboard shortcuts for the game. They are an addition, never the only way: every action also
 * has a visible, focusable button. Pure so it can be tested without a browser.
 *
 *   choosing:  1, 2, 3  pick a chest
 *   answering: 1-4 or A-D pick an answer, L uses the lifeline
 *   result:    N (or Enter when no button is focused) starts the next round
 */
export type KeyAction = { type: 'box'; index: number } | { type: 'option'; index: number } | { type: 'lifeline' } | { type: 'next' };

export interface KeyContext {
    ui: UiState;
    boxCount: number;
    optionCount: number;
    lifelineAvailable: boolean;
    /** A request is running or the time is up: ignore keys, exactly like the buttons are disabled. */
    busy: boolean;
    /** Enter and Space on a focused button already click it; do not trigger twice. */
    targetIsButton: boolean;
}

const LETTERS = ['a', 'b', 'c', 'd'];

export function keyAction(rawKey: string, context: KeyContext): KeyAction | null {
    if (context.busy) {
        return null;
    }

    const key = rawKey.length === 1 ? rawKey.toLowerCase() : rawKey;

    if (context.ui === 'choosing') {
        const index = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;

        return index >= 0 && index < context.boxCount ? { type: 'box', index } : null;
    }

    if (context.ui === 'answering') {
        if (key === 'l') {
            return context.lifelineAvailable ? { type: 'lifeline' } : null;
        }

        const index = /^[1-9]$/.test(key) ? Number(key) - 1 : LETTERS.indexOf(key);

        return index >= 0 && index < context.optionCount ? { type: 'option', index } : null;
    }

    if (context.ui === 'feedback' || context.ui === 'ready') {
        if (key === 'n') return { type: 'next' };
        if (key === 'Enter' && !context.targetIsButton) return { type: 'next' };
    }

    return null;
}
