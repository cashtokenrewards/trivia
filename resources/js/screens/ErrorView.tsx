import { useEffect, useState } from 'react';
import { Screen } from '../components/Common';
import { describeError, type ApiError } from '../api/errors';
import { retryAfterSeconds } from '../state/retryPolicy';

/** Whole seconds left of a server-requested wait (0 when there is none, or it is over). Ticks once a second. */
function useWaitSeconds(error: ApiError): number {
    const total = retryAfterSeconds(error);
    const remaining = () => (total === null ? 0 : Math.max(0, Math.ceil(total - (Date.now() - error.occurredAt) / 1000)));
    const [left, setLeft] = useState(remaining);

    useEffect(() => {
        if (total === null) return;

        const id = window.setInterval(() => setLeft(remaining()), 250);

        return () => window.clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [error, total]);

    return total === null ? 0 : left;
}

interface ErrorViewProps {
    error: ApiError;
    onRetry: () => void;
    onRefresh: () => void;
    onHome: () => void;
    onSignIn: () => void;
    onPracticeOnly: () => void;
}

export function ErrorView({ error, onRetry, onRefresh, onHome, onSignIn, onPracticeOnly }: ErrorViewProps) {
    const description = describeError(error);
    const waitLeft = useWaitSeconds(error);
    const waiting = description.action === 'wait' && waitLeft > 0;

    return (
        <Screen label="Problem">
            <div className="center-stack" role="alert">
                <h2>{description.title}</h2>
                <p>{description.message}</p>
                {description.action === 'retry' && <p className="caption">Trying again is safe: it cannot count the same move twice.</p>}

                <div className="actions">
                    {(description.action === 'retry' || description.action === 'wait') && (
                        <button className="btn btn-primary" onClick={onRetry} disabled={waiting}>
                            {waiting ? `Try again in ${waitLeft} s` : 'Try again'}
                        </button>
                    )}
                    {(description.action === 'refresh' || description.action === 'resume') && (
                        <button className="btn btn-primary" onClick={onRefresh}>
                            {description.action === 'resume' ? 'Resume my game' : 'Refresh'}
                        </button>
                    )}
                    {description.action === 'sign_in' && (
                        <button className="btn btn-primary" onClick={onSignIn}>
                            Sign in
                        </button>
                    )}
                    {description.action === 'reload' && (
                        <button className="btn btn-primary" onClick={() => window.location.reload()}>
                            Reload page
                        </button>
                    )}
                    {description.action === 'practice_only' && (
                        <button className="btn btn-primary" onClick={onPracticeOnly}>
                            Practise instead
                        </button>
                    )}
                    <button className="btn" onClick={onHome}>
                        Home
                    </button>
                </div>

                {error.correlationId && <p className="caption">Reference: {error.correlationId}</p>}
            </div>
        </Screen>
    );
}
