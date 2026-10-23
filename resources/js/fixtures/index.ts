import type { ApiErrorBody, DemoFixture, SessionResult, Snapshot } from '../types/api';

/**
 * Demo fixtures for frontend development before the backend exists.
 * Every file is DEMO DATA (synthetic, no real players or tokens). Use only in an
 * explicit, visibly labelled demo mode; the normal path talks to Laravel.
 */
const modules = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<
    string,
    DemoFixture<unknown>
>;

export const fixtures: Record<string, DemoFixture<unknown>> = Object.fromEntries(
    Object.entries(modules).map(([path, value]) => [path.replace(/^\.\/|\.json$/g, ''), value]),
);

function get(name: string): DemoFixture<unknown> {
    const fixture = fixtures[name];

    if (!fixture) {
        throw new Error(`Unknown demo fixture "${name}"`);
    }

    return fixture;
}

export const snapshotFixture = (name: string): Snapshot => get(name).response as Snapshot;
export const resultFixture = (name: string): SessionResult => get(name).response as SessionResult;
export const errorFixture = (name: string): ApiErrorBody => get(name).response as ApiErrorBody;
