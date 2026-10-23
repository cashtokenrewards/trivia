import { useEffect, useState } from 'react';

/**
 * Whether the browser thinks it has a network connection. This is only a hint: a phone can be
 * "online" with no usable signal, and the real test is whether a request succeeds. It is used to
 * tell the player the truth sooner and to retry the moment a connection returns.
 */
export function useOnlineStatus(): boolean {
    const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

    useEffect(() => {
        const goOnline = () => setOnline(true);
        const goOffline = () => setOnline(false);

        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);

        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);

    return online;
}
