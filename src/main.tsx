import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { initSentry } from './utils/sentry';

import { routes } from './routes.ts';
import './index.css';

// Suppress benign Monaco TS-worker race: model disposed before diagnostics finish.
window.addEventListener('unhandledrejection', (event) => {
    const msg: string = (event?.reason as { message?: string })?.message ?? '';
    if (msg.includes("Could not find source file: 'inmemory://model/")) {
        event.preventDefault();
    }
});

// Initialize Sentry before rendering
initSentry();

// Type for React Router hydration data  
import type { RouterState } from 'react-router';

declare global {
  interface Window {
    __staticRouterHydrationData?: Partial<Pick<RouterState, 'loaderData' | 'actionData' | 'errors'>>;
  }
}

const router = createBrowserRouter(routes, {
        hydrationData: window.__staticRouterHydrationData,
});

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
);
