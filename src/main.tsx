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
import { Toaster } from '@/components/ui/toaster.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';
import { isSupabaseConfigMissing } from '@/lib/supabase';

const queryClient = new QueryClient();

const MissingConfig = () => (
  <div className="flex min-h-screen items-center justify-center bg-adam-bg-secondary-dark">
    <div className="max-w-xl px-4 text-center text-red-500">
      Missing API Keys. Please copy .env.local.template to .env.local and
      restart.
    </div>
  </div>
);

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
  isSupabaseConfigMissing ? (
    <MissingConfig />
  ) : (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider delayDuration={0}>
            <Toaster />
            <RouterProvider
              router={router}
              future={{ v7_startTransition: true }}
            />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>
  ),
);
