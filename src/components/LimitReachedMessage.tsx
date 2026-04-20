import { getLevel, useAuth } from '@/contexts/AuthContext';
import { Link } from 'react-router-dom';
import { TrialDialog } from './auth/TrialDialog';
import { useState, useEffect } from 'react';

const TRIAL_DIALOG_SHOWN_KEY = 'adam_trial_dialog_shown';

export function LimitReachedMessage() {
  const { billing } = useAuth();
  const level = getLevel(billing);
  const hasTrialed = billing?.user.hasTrialed ?? false;
  const [showTrialDialog, setShowTrialDialog] = useState(false);

  // Automatically open trial dialog for free users who haven't trialed
  useEffect(() => {
    if (level === 'free' && !hasTrialed) {
      // Check if dialog has been shown before
      const hasDialogBeenShown =
        localStorage.getItem(TRIAL_DIALOG_SHOWN_KEY) === 'true';

      if (!hasDialogBeenShown) {
        // Wait 1 second before showing the trial dialog
        const timer = setTimeout(() => {
          setShowTrialDialog(true);
          // Mark dialog as shown in localStorage
          localStorage.setItem(TRIAL_DIALOG_SHOWN_KEY, 'true');
        }, 1000);

        return () => clearTimeout(timer);
      }
    }
  }, [level, hasTrialed]);

  const handleTrialClick = () => {
    setShowTrialDialog(true);
  };

  return (
    <div className="p-3 text-center text-sm text-adam-text-secondary">
      <LimitReachedSpan onTrialClick={handleTrialClick} />
      {level === 'free' && !hasTrialed && (
        <TrialDialog open={showTrialDialog} onOpenChange={setShowTrialDialog} />
      )}
    </div>
  );
}

function LimitReachedSpan({ onTrialClick }: { onTrialClick?: () => void }) {
  const { billing } = useAuth();
  const level = getLevel(billing);
  const hasTrialed = billing?.user.hasTrialed ?? false;

  // Free tier with trial already used
  if (level === 'free' && hasTrialed) {
    return (
      <span>
        You've used all your tokens.{' '}
        <Link to="/subscription" className="text-adam-blue hover:underline">
          Upgrade
        </Link>{' '}
        for more tokens, or{' '}
        <Link to="/settings" className="text-adam-blue hover:underline">
          buy a token pack
        </Link>
        .
      </span>
    );
  }

  // Free tier without trial
  if (level === 'free' && !hasTrialed) {
    return (
      <span>
        You've used all your tokens.{' '}
        <span
          className="cursor-pointer text-adam-blue hover:underline"
          onClick={onTrialClick}
        >
          Start a trial
        </span>{' '}
        to experience all Pro features for 7 days, completely free.
      </span>
    );
  }

  // Standard or Pro tier
  return (
    <span>
      You've used all your tokens for this period.{' '}
      <Link to="/settings" className="text-adam-blue hover:underline">
        Buy more tokens
      </Link>{' '}
      or{' '}
      <Link to="/subscription" className="text-adam-blue hover:underline">
        upgrade your plan
      </Link>
      .
    </span>
  );
}
