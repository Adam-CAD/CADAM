import { Button } from '@/components/ui/button';
import { useNavigate, useRouteError } from 'react-router-dom';

export function ErrorView() {
  const navigate = useNavigate();
  const error = useRouteError() as Error;

  // Log error to console for debugging
  console.error('Route error:', error);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-adam-bg-secondary-dark">
      <h1 className="text-2xl font-bold text-adam-text-primary">
        Oops! Something went wrong.
      </h1>
      <p className="text-center text-adam-text-secondary">
        We're sorry, but an error occurred while loading this page.
        <br />
        Please feel free to reach out to us so that we can resolve this issue.
      </p>
      {error && (
        <details className="max-w-lg rounded bg-adam-neutral-800 p-4 text-sm">
          <summary className="cursor-pointer text-adam-neutral-400">
            Error details
          </summary>
          <pre className="mt-2 overflow-auto text-xs text-red-400">
            {error.message || String(error)}
          </pre>
        </details>
      )}
      <Button onClick={() => navigate('/')}>Go to Home</Button>
    </div>
  );
}
