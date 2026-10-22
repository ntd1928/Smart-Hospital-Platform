// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// Based on Medplum's app bootstrap; see docs/architecture/UPSTREAM.md.
import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import { MedplumClient } from '@medplum/core';
import { MedplumProvider } from '@medplum/react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { App } from './App';
import './style.css';

export const medplum = new MedplumClient({
  baseUrl: import.meta.env.VITE_MEDPLUM_BASE_URL ?? 'http://localhost:8103/',
  storagePrefix: 'smart-hospital:',
  cacheTime: 1000,
  onUnauthenticated: () => {
    if (location.pathname !== '/signin') location.assign('/signin');
  },
});
const router = createBrowserRouter([{ path: '*', element: <App /> }]);
createRoot(document.getElementById('root')!).render(
  <MedplumProvider medplum={medplum} navigate={(path) => router.navigate(path)}>
    <MantineProvider theme={{ primaryColor: 'teal', defaultRadius: 'md' }}>
      <Notifications />
      <RouterProvider router={router} />
    </MantineProvider>
  </MedplumProvider>
);
