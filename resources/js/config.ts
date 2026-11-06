/**
 * Demo mode renders recorded fixtures instead of talking to Laravel. It must be explicit:
 * allowed only in development or when VITE_ALLOW_DEMO=true was set at build time, and
 * then only when the URL carries ?demo=1. The UI always labels it.
 */
export function isDemoAllowed(): boolean {
    return import.meta.env.DEV || import.meta.env.VITE_ALLOW_DEMO === 'true';
}

/**
 * The static demo site (Netlify) is built with VITE_DEMO_DEFAULT=true so "/" opens the demo with no
 * query string. The Laravel build never sets it, so the normal path is unchanged.
 */
export function isDemoDefault(): boolean {
    return import.meta.env.VITE_DEMO_DEFAULT === 'true';
}

/** The hosted demo site hides the demo labels (banner, badge, notes). Local demo (?demo=1) keeps them. */
export function isDemoQuiet(): boolean {
    return import.meta.env.VITE_DEMO_QUIET === 'true';
}

export function isDemoRequested(search: string = window.location.search): boolean {
    return isDemoAllowed() && (isDemoDefault() || new URLSearchParams(search).get('demo') === '1');
}

/** Developer-only 3D arena sandbox (synthetic events). Same gate as demo mode, plus ?arena=1. */
export function isArenaSandboxRequested(search: string = window.location.search): boolean {
    return isDemoAllowed() && new URLSearchParams(search).get('arena') === '1';
}

/**
 * Demo-only duration overrides from the URL, for trying expiry quickly:
 * ?demo=1&session=20&choice=2&answer=4 (seconds). Ignored outside demo mode.
 */
export function demoRuleOverrides(search: string = window.location.search): { session_seconds?: number; choice_seconds?: number; answer_seconds?: number } {
    if (!isDemoRequested(search)) return {};

    const params = new URLSearchParams(search);
    const read = (name: string): number | undefined => {
        const raw = params.get(name);
        const value = raw === null ? NaN : Number(raw);

        return Number.isFinite(value) && value >= 1 && value <= 600 ? Math.round(value) : undefined;
    };
    const overrides: { session_seconds?: number; choice_seconds?: number; answer_seconds?: number } = {};
    const session = read('session');
    const choice = read('choice');
    const answer = read('answer');

    if (session !== undefined) overrides.session_seconds = session;
    if (choice !== undefined) overrides.choice_seconds = choice;
    if (answer !== undefined) overrides.answer_seconds = answer;

    return overrides;
}
