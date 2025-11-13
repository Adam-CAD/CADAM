import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from 'react-router-dom';
import App from '@/App.tsx';
import '@/index.css';
import { ErrorView } from '@/views/ErrorView.tsx';
import { PromptView } from '@/views/PromptView.tsx';
import { HistoryView } from '@/views/HistoryView.tsx';
import EditorView from '@/views/EditorView.tsx';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/contexts/AuthProvider.tsx';
import { SettingsProvider } from '@/contexts/SettingsContext.tsx';
import { Toaster } from '@/components/ui/toaster.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';

const queryClient = new QueryClient();

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
      errorElement: <ErrorView />,
      children: [
        {
          path: '/',
          element: <PromptView />,
          errorElement: <ErrorView />,
        },
        {
          path: '/editor/:id',
          element: <EditorView />,
          errorElement: <ErrorView />,
        },
        {
          path: '/history',
          errorElement: <ErrorView />,
          element: <HistoryView />,
        },
        { path: '*', element: <Navigate to="/" replace /> },
      ],
    },
  ],
  { future: { v7_relativeSplatPath: true }, basename: '/cadam' },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SettingsProvider>
          <TooltipProvider delayDuration={0}>
            <Toaster />
            <RouterProvider
              router={router}
              future={{ v7_startTransition: true }}
            />
          </TooltipProvider>
        </SettingsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
