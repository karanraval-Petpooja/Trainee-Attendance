/** @type {import('next').NextConfig} */
// Version stamp of this build: the Git commit on Vercel, otherwise the build time.
// Phones compare it with /api/version to offer "Update now" after a new deployment.
const APP_VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || `local-${Date.now()}`;

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
  // The service worker must never be cached, so phones always get the latest version of the app
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/manifest.webmanifest', headers: [{ key: 'Content-Type', value: 'application/manifest+json' }] },
      { source: '/api/version', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};
export default nextConfig;
