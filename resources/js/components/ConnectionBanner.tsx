import type { ConnectionNotice } from '../game/connectionNotice';

interface ConnectionBannerProps {
    notice: ConnectionNotice;
    onRetry: () => void;
    onRefresh: () => void;
    onDismiss: () => void;
}

/** One calm message about the connection or the fate of the last answer, with at most one button. */
export function ConnectionBanner({ notice, onRetry, onRefresh, onDismiss }: ConnectionBannerProps) {
    const handlers = { retry: onRetry, refresh: onRefresh, dismiss: onDismiss } as const;

    return (
        <div className="conn-banner" data-tone={notice.tone} data-kind={notice.kind} role="status" aria-live="polite">
            <span>{notice.message}</span>
            {notice.action && notice.actionLabel && (
                <button className="link" onClick={handlers[notice.action]}>
                    {notice.actionLabel}
                </button>
            )}
        </div>
    );
}

/**
 * Shown on the screens before a game (home, how to play, ready). There is no game clock yet, so
 * it only says what the player needs to know: they need a connection to play.
 */
export function StatusStrip({ online, checking }: { online: boolean; checking: boolean }) {
    if (online && !checking) return null;

    return (
        <div className="banner-stack" data-pregame="true">
            <div className="conn-banner" data-tone="warn" data-kind={online ? 'unconfirmed' : 'offline'} role="status" aria-live="polite">
                {!online
                    ? 'You are offline. Playing for rewards needs a connection. You can start as soon as you are back online.'
                    : 'We could not check whether you have a game in progress. We keep trying.'}
            </div>
        </div>
    );
}
