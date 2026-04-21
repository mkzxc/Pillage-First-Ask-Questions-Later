/// <reference lib="webworker" />

import { SW } from '@mkzxc/cross-tab-without-shared-worker--alpha/sw';
// import { clientsClaim } from 'workbox-core';
// import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { CUSTOM_HEADER } from './const';

// const sw = globalThis as unknown as ServiceWorkerGlobalScope;

// clientsClaim();
// cleanupOutdatedCaches();

// const handleInstall = async (): Promise<void> => {
//   try {
//     const allClients = await sw.clients.matchAll();

//     const isStandalone = allClients.some((client) => {
//       return (
//         client.url.includes('standalone=true') ||
//         client.frameType === 'top-level'
//       );
//     });

//     if (isStandalone) {
//       precacheAndRoute(sw.__WB_MANIFEST);
//     }
//   } catch (error) {
//     console.error('Service worker install controller failed:', error);
//   }
// };

// sw.addEventListener('install', (event) => {
//   event.waitUntil(handleInstall());
// });

// const handleInstall = async (sw: ServiceWorkerGlobalScope): Promise<void> => {
//   try {
//     const allClients = await sw.clients.matchAll();

//     const isStandalone = allClients.some((client) => {
//       return (
//         client.url.includes('standalone=true') ||
//         client.frameType === 'top-level'
//       );
//     });

//     if (isStandalone) {
//       precacheAndRoute(sw.__WB_MANIFEST);
//     }
//   } catch (error) {
//     console.error('Service worker install controller failed:', error);
//   }
// };

const customSW = new SW(CUSTOM_HEADER);

customSW.initializeSW(
  (sw) => {
    sw.skipWaiting();
    // event.waitUntil(handleInstall(sw));
  },
  //TODO Is this needed?
  (sw, event) => {
    event.waitUntil(sw.clients.claim());
  },
);
