import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Static build of the DEMO for hosting (Netlify). It has no Laravel plugin and no backend: the
 * game runs against the in-browser simulated server. Demo mode is switched on here, in this
 * config only, so the normal Laravel build (vite.config.ts) can never contain it.
 */
export default defineConfig({
    plugins: [react()],
    // Netlify serves the site from the domain root, and unknown paths fall back to index.html, so assets need absolute URLs.
    base: '/',
    // Laravel's public/ folder (index.php, build output) must not be copied into the site.
    publicDir: false,
    define: {
        'import.meta.env.VITE_ALLOW_DEMO': JSON.stringify('true'),
        'import.meta.env.VITE_DEMO_DEFAULT': JSON.stringify('true'),
        'import.meta.env.VITE_DEMO_QUIET': JSON.stringify('true'),
    },
    build: {
        outDir: 'dist-static',
        emptyOutDir: true,
    },
});
