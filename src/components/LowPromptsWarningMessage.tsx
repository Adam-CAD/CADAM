import { getLevel, useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { TrialDialog } from './auth/TrialDialog';
import { cn } from '@/lib/utils';

export function LowPromptsWarningMessage({
  tokensRemaining,
  layout = 'inline',
}: {
  tokensRemaining: number;
  layout?: 'inline' | 'stacked';
}) {
  return (
    <div className="p-3 text-center text-sm text-adam-text-secondary">
      <LowTokensWarningContent
        tokensRemaining={tokensRemaining}
        layout={layout}
      />
    </div>
  );
}

function LowTokensWarningContent({
  tokensRemaining,
  layout,
}: {
  tokensRemaining: number;
  layout: 'inline' | 'stacked';
}) {
  const { billing } = useAuth();
  const level = getLevel(billing);
  const hasTrialed = billing?.user.hasTrialed ?? false;

  const tokensText = `You have ${tokensRemaining} token${tokensRemaining === 1 ? '' : 's'} remaining`;

  // Free tier with trial already used
  if (level === 'free' && hasTrialed) {
    return (
      <span>
        {tokensText}.{' '}
        <Link to="/subscription" className="text-adam-blue hover:underline">
          Upgrade
        </Link>{' '}
        for more tokens.
      </span>
    );
  }

  // Free tier without trial - pure CSS layout control
  if (level === 'free' && !hasTrialed) {
    return (
      <div
        className={cn(
          'flex justify-center',
          layout === 'stacked' ? 'flex-col gap-1' : 'flex-wrap gap-1',
        )}
      >
        <span>{tokensText}.</span>
        <TrialDialog>
          <span className="cursor-pointer text-adam-blue hover:underline">
            Start a free trial of Pro
          </span>
        </TrialDialog>
      </div>
    );
  }

  // Paid tier
  return (
    <span>
      {tokensText}.{' '}
      <Link to="/settings" className="text-adam-blue hover:underline">
        Buy more tokens
      </Link>{' '}
      or{' '}
      <Link to="/subscription" className="text-adam-blue hover:underline">
        upgrade
      </Link>
      .
    </span>
  );
}
