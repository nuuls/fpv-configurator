import { useState } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { DEFAULT_PATH, ROUTES } from '@/routes'

// Hash routing keeps deep links working on any static host without server rewrites.
// A data router (rather than <HashRouter>) is required for useBlocker → unsaved-changes prompts.
function createRouter() {
  return createHashRouter([
    {
      element: <AppShell />,
      children: [
        ...ROUTES.map((route) => ({ path: route.path, element: <route.component /> })),
        { path: '*', element: <Navigate to={DEFAULT_PATH} replace /> },
      ],
    },
  ])
}

export default function App() {
  const [router] = useState(createRouter)
  return <RouterProvider router={router} />
}
