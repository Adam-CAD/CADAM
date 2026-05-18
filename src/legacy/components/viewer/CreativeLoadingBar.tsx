import { CreativeModel } from '@shared/types';
import { useLoadingProgress } from '@/hooks/useLoadingProgress';
import { useGlbPreview } from '@/hooks/useGlbPreview';
import { useMemo, useState, useEffect } from 'react';
import { GlbPreview } from './GlbPreview';
import { StageProgress } from './StageProgress';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { NotificationPrompt } from '@/components/chat/NotificationPrompt';

interface CreativeLoadingBarProps {
  modelType?: 'image' | 'mesh';
  startTime?: number;
  modelName?: CreativeModel;
  meshId?: string;
}

export function CreativeLoadingBar({
  modelType,
  startTime,
  modelName,
  meshId,
}: CreativeLoadingBarProps) {
  const isMobile = useIsMobile();
  const [notificationPromptDismissed, setNotificationPromptDismissed] =
    useState(localStorage.getItem('notificationPromptDismissed') === 'true');

  const actualStartTime = useMemo(() => {
    if (startTime) {
      return startTime;
    }
    return Date.now();
  }, [startTime]);

  const { progress, remainingTime, stage } = useLoadingProgress(
    modelType ?? 'mesh',
    actualStartTime,
    modelName,
  );

  // Query for preview status and GLB URL
  const { data: previewBlob, updatedAt } = useGlbPreview({
    id: meshId,
  });

  const actualUpdatedAt = useMemo(() => {
    if (updatedAt) {
      return new Date(updatedAt).getTime();
    }
    return undefined;
  }, [updatedAt]);

  const [showPercentage, setShowPercentage] = useState(false);

  // Toggle between percentage and time left every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setShowPercentage((prev) => !prev);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Show notification prompt for mesh generation after initialization
  const shouldShowNotificationPrompt =
    !notificationPromptDismissed &&
    modelType === 'mesh' &&
    stage >= 2 &&
    !isMobile; // Show after initialization is complete

  const timeLeft = useMemo(() => {
    const clampedRemainingTime = Math.max(15000, remainingTime);
    const minutes = Math.floor(clampedRemainingTime / 60000);
    const seconds = Math.floor((clampedRemainingTime % 60000) / 1000);
    if (minutes > 0) {
      if (isMobile) {
        return `${minutes} min`;
      }
      return `${minutes} minute${minutes > 1 ? 's' : ''} left`;
    }
    if (isMobile) {
      return `${seconds} s`;
    }
    return `${seconds} second${seconds > 1 ? 's' : ''} left`;
  }, [remainingTime, isMobile]);

  return (
    <div className="relative flex h-full max-h-dvh w-full flex-col items-center justify-center gap-2">
      {/* Notification prompt for mesh generation */}
      <NotificationPrompt
        shouldShow={shouldShowNotificationPrompt}
        onDismiss={() => {
          setNotificationPromptDismissed(true);
          localStorage.setItem('notificationPromptDismissed', 'true');
        }}
      />

      <div
        className={cn('w-full', isMobile ? 'aspect-square h-fit' : 'h-full')}
      >
        <GlbPreview
          glbBlob={stage !== 1 ? (previewBlob ?? undefined) : undefined}
          model={modelName}
          startTime={actualStartTime}
          updatedAt={actualUpdatedAt}
        />
      </div>
      <div
        className={cn(
          'flex h-8 w-full max-w-2xl items-center justify-center transition-all duration-300 ease-in-out',
          !isMobile && 'absolute top-3/4',
        )}
      >
        <div className="relative flex h-full w-full gap-2">
          {modelType && (
            <>
              <div
                className={`absolute right-0 top-0 text-xs text-white/60 transition-opacity duration-300 ease-in-out ${
                  showPercentage ? 'opacity-100 delay-150' : 'opacity-0'
                }`}
              >
                {`${Math.round(progress)}%`}
              </div>
              <div
                className={`absolute right-0 top-0 w-max text-xs text-white/60 transition-opacity duration-300 ease-in-out ${
                  showPercentage ? 'opacity-0' : 'opacity-100 delay-150'
                }`}
              >
                {timeLeft}
              </div>
            </>
          )}
          <div className="flex w-full gap-2">
            <div className="flex w-1/3 flex-col gap-2">
              <StageProgress
                stage={1}
                currentStage={stage}
                progress={progress}
                modelType={modelType ?? 'mesh'}
                title="Initialize"
              />
            </div>
            <div className="flex w-full flex-col gap-2">
              <StageProgress
                stage={2}
                currentStage={modelType === 'image' && stage === 3 ? 2 : stage}
                progress={progress}
                modelType={modelType ?? 'image'}
                title={
                  modelType
                    ? modelType === 'mesh'
                      ? 'Mesh'
                      : 'Processing'
                    : ''
                }
              />
            </div>
            {modelType === 'mesh' && (
              <div className="flex w-full flex-col gap-2">
                <StageProgress
                  stage={3}
                  currentStage={stage}
                  progress={progress}
                  modelType={modelType}
                  title="Texture"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
