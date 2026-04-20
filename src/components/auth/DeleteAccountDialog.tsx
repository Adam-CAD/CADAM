import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogContent,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { supabase } from '@/lib/supabase';
import * as Sentry from '@sentry/react';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';
import posthog from 'posthog-js';

type CancellationFeedback =
  | 'customer_service'
  | 'low_quality'
  | 'missing_features'
  | 'other'
  | 'switched_service'
  | 'too_complex'
  | 'too_expensive'
  | 'unused';

export const DeleteAccountDialog = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [confirmText, setConfirmText] = useState('');
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedReason, setSelectedReason] =
    useState<CancellationFeedback | null>(null);
  const { mutate: deleteUser, isPending: isDeleting } = useMutation({
    mutationFn: async () => {
      posthog.capture('delete_account_called', {
        reason: selectedReason,
      });
      const { error } = await supabase.functions.invoke('delete-user', {
        method: 'POST',
        body: { reason: selectedReason },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // Sign out locally and redirect after deletion
      supabase.auth.signOut();
    },
    onError: (error) => {
      Sentry.captureException(error);
      toast({
        title: 'Delete failed',
        description:
          'We could not delete your account. Please try again or contact support.',
        variant: 'destructive',
      });
    },
  });

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-md rounded-3xl">
        {step === 1 ? (
          <div className="flex flex-col gap-16">
            <AlertDialogHeader className="text-center sm:text-center">
              <AlertDialogTitle className="w-full">
                We're sad to see you go :(
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div className="flex flex-col gap-6">
              <div className="text-sm">What made you cancel your plan?</div>
              <RadioGroup
                value={selectedReason}
                className="flex flex-col gap-6"
              >
                <label className="flex items-center gap-3 text-sm">
                  <RadioGroupItem
                    onClick={() => setSelectedReason('too_expensive')}
                    value="too_expensive"
                  />
                  Too Expensive
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <RadioGroupItem
                    onClick={() => setSelectedReason('missing_features')}
                    value="missing_features"
                  />
                  Missing features
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <RadioGroupItem
                    onClick={() => setSelectedReason('low_quality')}
                    value="low_quality"
                  />
                  Low quality or bugs
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <RadioGroupItem
                    onClick={() => setSelectedReason('unused')}
                    value="unused"
                  />
                  I don't need it anymore
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <RadioGroupItem
                    onClick={() => setSelectedReason('switched_service')}
                    value="switched_service"
                  />
                  I've found another tool
                </label>
              </RadioGroup>
            </div>
            <div className="grid w-full grid-cols-2 gap-5">
              <Button
                variant="secondary"
                className="w-full rounded-full"
                onClick={() => {
                  setIsOpen(false);
                  setConfirmText('');
                  setSelectedReason(null);
                  setStep(1);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="black"
                className="w-full rounded-full"
                onClick={() => setStep(2)}
                disabled={!selectedReason}
              >
                Next
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-16">
            <AlertDialogHeader className="text-center sm:text-center">
              <AlertDialogTitle className="w-full">
                Are you sure?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <div className="space-y-4">
              <p>Deleting your account means:</p>
              <div className="rounded-lg bg-adam-neutral-950 p-4 text-adam-neutral-100">
                <ul className="list-disc space-y-2 pl-5 text-sm">
                  <li>
                    Deleting your account is permanent and cannot be undone.
                  </li>
                  <li>
                    Your data will be deleted within 30 days, except we may
                    retain a limited set of data for longer where required or
                    permitted by law.
                  </li>
                </ul>
              </div>
            </div>
            <div className="space-y-2">
              <p>
                Type <span className="font-semibold text-red-500">DELETE</span>{' '}
                to confirm
              </p>
              <Input
                className="rounded-none border-x-0 border-b border-t-0 border-adam-neutral-200 shadow-none ring-0 focus:border-adam-neutral-200 focus:ring-0"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
              />
            </div>
            <div className="grid w-full grid-cols-2 gap-5">
              <Button
                variant="secondary"
                className="w-full rounded-full"
                onClick={() => {
                  setIsOpen(false);
                  setConfirmText('');
                  setSelectedReason(null);
                  setStep(1);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="w-full rounded-full"
                disabled={confirmText !== 'DELETE' || isDeleting}
                onClick={() => deleteUser()}
              >
                DELETE
              </Button>
            </div>
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
};
