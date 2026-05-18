import { cn } from '@/lib/utils';

interface AdamLoadingProps {
  label?: string;
  size?: number;
  className?: string;
}

export function AdamLoading({ label, size = 48, className }: AdamLoadingProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3',
        className,
      )}
    >
      <img
        src={`${import.meta.env.BASE_URL}adam-logo.svg`}
        alt="Loading"
        width={size}
        height={size}
        className="animate-adam-bounce"
        style={{ height: size, width: size }}
      />
      {label ? (
        <span className="text-sm text-adam-text-secondary">{label}</span>
      ) : null}
      <style>{`
        @keyframes adam-bounce {
          0%, 100% { transform: translateY(0) scale(1); }
          50%      { transform: translateY(-8px) scale(1.05); }
        }
        .animate-adam-bounce {
          animation: adam-bounce 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
