import { StrictMode, Suspense, lazy } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { isArenaSandboxRequested } from './config';

const container = document.getElementById('root');

if (!container) {
    throw new Error('Missing #root element in the Blade shell.');
}

// The sandbox is a developer tool: demo-allowed builds only, with ?arena=1. Loaded lazily.
const ArenaSandbox = lazy(() => import('./screens/ArenaSandbox'));

// In development, Vite hot reload can run this entry module a second time. Calling createRoot
// again on the same element would render the whole app twice, so the root is created once and
// reused.
const holder = window as Window & { __ctReactRoot?: Root };
holder.__ctReactRoot ??= createRoot(container);

holder.__ctReactRoot.render(
    <StrictMode>
        {isArenaSandboxRequested() ? (
            <Suspense fallback={null}>
                <ArenaSandbox />
            </Suspense>
        ) : (
            <App />
        )}
    </StrictMode>,
);
