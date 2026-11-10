import { describe, expect, it } from 'vitest';
import { keyAction, type KeyContext } from './keys';

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({ ui: 'answering', boxCount: 3, optionCount: 4, lifelineAvailable: true, busy: false, targetIsButton: false, ...over });

describe('keyAction', () => {
    it('1-3 pick a chest while choosing, and nothing else does', () => {
        expect(keyAction('1', ctx({ ui: 'choosing' }))).toEqual({ type: 'box', index: 0 });
        expect(keyAction('3', ctx({ ui: 'choosing' }))).toEqual({ type: 'box', index: 2 });
        expect(keyAction('4', ctx({ ui: 'choosing' }))).toBeNull();
        expect(keyAction('l', ctx({ ui: 'choosing' }))).toBeNull();
        expect(keyAction('0', ctx({ ui: 'choosing' }))).toBeNull();
    });

    it('1-4 and A-D pick an answer, in either case', () => {
        expect(keyAction('1', ctx())).toEqual({ type: 'option', index: 0 });
        expect(keyAction('4', ctx())).toEqual({ type: 'option', index: 3 });
        expect(keyAction('a', ctx())).toEqual({ type: 'option', index: 0 });
        expect(keyAction('D', ctx())).toEqual({ type: 'option', index: 3 });
        expect(keyAction('5', ctx())).toBeNull();
        expect(keyAction('e', ctx())).toBeNull();
    });

    it('L uses the lifeline only while it is available', () => {
        expect(keyAction('l', ctx())).toEqual({ type: 'lifeline' });
        expect(keyAction('L', ctx())).toEqual({ type: 'lifeline' });
        expect(keyAction('l', ctx({ lifelineAvailable: false }))).toBeNull();
    });

    it('N or Enter starts the next round from a result, but Enter on a focused button is left to the button', () => {
        expect(keyAction('n', ctx({ ui: 'feedback' }))).toEqual({ type: 'next' });
        expect(keyAction('Enter', ctx({ ui: 'feedback' }))).toEqual({ type: 'next' });
        expect(keyAction('Enter', ctx({ ui: 'feedback', targetIsButton: true }))).toBeNull();
        expect(keyAction('n', ctx({ ui: 'feedback', targetIsButton: true }))).toEqual({ type: 'next' });
        expect(keyAction('Enter', ctx({ ui: 'answering' }))).toBeNull();
    });

    it('does nothing while busy (a request running or time up), like the disabled buttons', () => {
        expect(keyAction('1', ctx({ busy: true }))).toBeNull();
        expect(keyAction('n', ctx({ ui: 'feedback', busy: true }))).toBeNull();
    });

    it('does nothing in screens without shortcuts', () => {
        expect(keyAction('1', ctx({ ui: 'loading' }))).toBeNull();
        expect(keyAction('1', ctx({ ui: 'submitting' }))).toBeNull();
        expect(keyAction('1', ctx({ ui: 'completed' }))).toBeNull();
    });
});
