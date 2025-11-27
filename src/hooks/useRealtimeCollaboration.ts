/**
 * Real-time Collaboration Hook
 *
 * Enables live parameter updates and presence tracking for shared conversations.
 * Uses Supabase Realtime Broadcast for instant parameter synchronization.
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface CollaboratorPresence {
  userId: string;
  userName: string;
  color: string; // Assigned color for this user
  lastSeen: number;
}

export interface ParameterChangeEvent {
  parameterName: string;
  newValue: number | string | boolean;
  userId: string;
  timestamp: number;
}

interface UseRealtimeCollaborationOptions {
  conversationId: string | undefined;
  onParameterChange?: (event: ParameterChangeEvent) => void;
  enabled?: boolean;
}

const USER_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#14B8A6', // teal
];

/**
 * Hook for real-time collaboration features
 */
export function useRealtimeCollaboration({
  conversationId,
  onParameterChange,
  enabled = true,
}: UseRealtimeCollaborationOptions) {
  const [collaborators, setCollaborators] = useState<
    Record<string, CollaboratorPresence>
  >({});
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userColorRef = useRef<string>(
    USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
  );
  const anonymousNameRef = useRef<string>(
    `Anonymous ${Math.random().toString(36).substring(2, 6)}`,
  );

  // Broadcast a parameter change to all collaborators
  const broadcastParameterChange = useCallback(
    async (parameterName: string, newValue: number | string | boolean) => {
      if (!channelRef.current || !conversationId || !enabled) return;

      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user.id || 'anonymous';

      const event: ParameterChangeEvent = {
        parameterName,
        newValue,
        userId,
        timestamp: Date.now(),
      };

      await channelRef.current.send({
        type: 'broadcast',
        event: 'parameter_change',
        payload: event,
      });
    },
    [conversationId, enabled],
  );

  // Store onParameterChange in a ref to avoid recreating the effect
  const onParameterChangeRef = useRef(onParameterChange);
  useEffect(() => {
    onParameterChangeRef.current = onParameterChange;
  }, [onParameterChange]);

  // Set up real-time channel
  useEffect(() => {
    if (!conversationId || !enabled) {
      setIsConnected(false);
      return;
    }

    const channelName = `conversation:${conversationId}`;
    const channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: false }, // Don't receive own broadcasts
      },
    });

    // Handle parameter changes from other users
    channel.on('broadcast', { event: 'parameter_change' }, ({ payload }) => {
      onParameterChangeRef.current?.(payload as ParameterChangeEvent);
    });

    // Handle presence (who's online)
    channel.on('presence', { event: 'sync' }, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = channel.presenceState() as Record<string, any[]>;
      const presences: Record<string, CollaboratorPresence> = {};

      Object.entries(state).forEach(([userId, presenceArray]) => {
        const presence = presenceArray[0] as CollaboratorPresence;
        if (presence) {
          presences[userId] = presence;
        }
      });

      setCollaborators(presences);
    });

    // Track own presence
    const trackPresence = async () => {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user.id || 'anonymous';

      await channel.track({
        userId,
        userName:
          userId === 'anonymous'
            ? `Anonymous ${Math.random().toString(36).substring(2, 6)}`
            : `User ${userId.slice(0, 6)}`,
        color: userColorRef.current,
        lastSeen: Date.now(),
      });
    };

    // Subscribe and track presence
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        setIsConnected(true);
        await trackPresence();
      } else if (status === 'CLOSED') {
        setIsConnected(false);
      }
    });

    channelRef.current = channel;

    // Update presence every 30 seconds
    const presenceInterval = setInterval(trackPresence, 30000);

    return () => {
      clearInterval(presenceInterval);
      channel.unsubscribe();
      channelRef.current = null;
      setIsConnected(false);
      setCollaborators({});
    };
  }, [conversationId, enabled]);

  return {
    collaborators: Object.values(collaborators),
    collaboratorCount: Object.keys(collaborators).length,
    isConnected,
    broadcastParameterChange,
  };
}
