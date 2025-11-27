/**
 * Share Button Component
 *
 * Allows users to generate shareable links for their conversations.
 * Supports copy-to-clipboard and displays current collaborators.
 */

import { useState } from 'react';
import { Share2, Copy, Check, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface ShareButtonProps {
  conversationId: string;
  isPublic?: boolean;
  shareToken?: string | null;
  collaboratorCount?: number;
}

export function ShareButton({
  conversationId,
  isPublic = false,
  shareToken,
  collaboratorCount = 0,
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Generate share link mutation
  const generateShareLink = useMutation({
    mutationFn: async () => {
      // Use the database's secure token generator
      const { data: token, error: tokenError } = await supabase.rpc(
        'generate_share_token',
      );

      if (tokenError) throw tokenError;

      const { error } = await supabase
        .from('conversations')
        .update({
          share_token: token,
          is_public: true,
        })
        .eq('id', conversationId);

      if (error) throw error;

      return token;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId],
      });
      toast({
        title: 'Share link created',
        description:
          'Anyone with this link can view and interact with this design.',
      });
    },
    onError: () => {
      toast({
        title: 'Failed to create share link',
        description: 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  // Disable sharing mutation
  const disableSharing = useMutation({
    mutationFn: async () => {
      await supabase
        .from('conversations')
        .update({
          share_token: null,
          is_public: false,
        })
        .eq('id', conversationId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['conversation', conversationId],
      });
      toast({
        title: 'Sharing disabled',
        description: 'This conversation is now private.',
      });
      setOpen(false);
    },
  });

  const shareUrl = shareToken
    ? `${window.location.origin}/cadam/shared/${shareToken}`
    : '';

  const copyToClipboard = async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({
        title: 'Link copied!',
        description: 'Share link copied to clipboard.',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (_error) {
      toast({
        title: 'Failed to copy',
        description: 'Please copy the link manually.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-adam-neutral-300 hover:text-adam-neutral-100"
        >
          <Share2 className="h-4 w-4" />
          {collaboratorCount > 0 && (
            <span className="flex items-center gap-1 text-xs">
              <Users className="h-3 w-3" />
              {collaboratorCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this design</DialogTitle>
          <DialogDescription>
            {isPublic
              ? 'Anyone with this link can view and interact with this design in real-time.'
              : 'Create a shareable link for this conversation.'}
          </DialogDescription>
        </DialogHeader>

        {isPublic && shareToken ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="share-link">Share link</Label>
              <div className="flex gap-2">
                <Input
                  id="share-link"
                  value={shareUrl}
                  readOnly
                  className="flex-1"
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={copyToClipboard}
                  className="shrink-0"
                >
                  {copied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {collaboratorCount > 0 && (
              <div className="rounded-lg bg-adam-blue/10 p-3 text-sm text-adam-neutral-300">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-adam-blue" />
                  <span>
                    {collaboratorCount}{' '}
                    {collaboratorCount === 1 ? 'person' : 'people'} currently
                    viewing
                  </span>
                </div>
              </div>
            )}

            <Button
              variant="outline"
              onClick={() => disableSharing.mutate()}
              disabled={disableSharing.isPending}
              className="w-full"
            >
              Disable sharing
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-adam-neutral-400">
              Create a shareable link to collaborate with others in real-time.
              They'll be able to view the 3D model and adjust parameters
              together.
            </p>
            <Button
              onClick={() => generateShareLink.mutate()}
              disabled={generateShareLink.isPending}
              className="w-full"
            >
              {generateShareLink.isPending
                ? 'Creating link...'
                : 'Create share link'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
