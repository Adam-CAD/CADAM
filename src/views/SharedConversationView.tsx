/**
 * Shared Conversation View
 *
 * Displays a publicly shared conversation via share token.
 * Anyone with the link can view and interact with the design.
 */

import { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

export function SharedConversationView() {
  const { token } = useParams<{ token: string }>();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSharedConversation() {
      if (!token) {
        setError('No share token provided');
        setLoading(false);
        return;
      }

      try {
        // Look up conversation by share_token
        const { data, error: fetchError } = await supabase
          .from('conversations')
          .select('id, is_public, share_token')
          .eq('share_token', token)
          .eq('is_public', true)
          .single();

        if (fetchError || !data) {
          setError('This share link is invalid or has been disabled');
          setLoading(false);
          return;
        }

        setConversationId(data.id);
      } catch (err) {
        setError('Failed to load shared conversation');
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadSharedConversation();
  }, [token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-adam-blue" />
          <p className="text-adam-neutral-300">Loading shared design...</p>
        </div>
      </div>
    );
  }

  if (error || !conversationId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark">
        <div className="max-w-md rounded-lg bg-adam-neutral-800 p-8 text-center">
          <h2 className="mb-4 text-xl font-semibold text-adam-neutral-100">
            Share link not found
          </h2>
          <p className="mb-6 text-sm text-adam-neutral-400">
            {error || 'This share link is invalid or has expired.'}
          </p>
          <a
            href="/cadam"
            className="inline-block rounded bg-adam-blue px-4 py-2 text-sm font-medium text-white hover:bg-adam-blue/90"
          >
            Go to CADAM
          </a>
        </div>
      </div>
    );
  }

  // Redirect to the normal editor view with the conversation ID
  return <Navigate to={`/editor/${conversationId}`} replace />;
}
