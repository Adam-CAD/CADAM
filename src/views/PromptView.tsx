import { useNavigate, Link } from '@tanstack/react-router';
import { ArrowUpRight, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, ssoProvider } from '@/lib/supabase';
import { signInWithSsoProvider } from '@/lib/ssoAuth';
import TextAreaChat from '@/components/TextAreaChat';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { useState, useMemo, useEffect } from 'react';
import { Model } from '@shared/types';
import { MessageItem } from '../types/misc.ts';
import { LimitReachedMessage } from '@/components/LimitReachedMessage';
import { LowPromptsWarningMessage } from '@/components/LowPromptsWarningMessage';
import { NewProductBanner } from '@/components/NewProductBanner';
import { FreePlanTrialPill } from '@/components/FreePlanTrialPill';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { SelectedItemsContext } from '@/contexts/SelectedItemsContext';
import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';
import { useProfile } from '@/services/profileService';
import { useLayoutContext } from '@/contexts/LayoutContext';
import { apiUrl } from '@/services/api';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import { createAndCacheAiChat } from '@/hooks/useCachedAiChat';
import type { AppUIMessage } from '@shared/chatAi';
import { ensureInputRecords } from '@/lib/aiMessages';
import { persistUserMessage } from '@/services/messageService';

const EXTENSION_PILLS = [
  {
    href: 'https://cad.onshape.com/appstore/apps/Design%20&%20Documentation/690a8dc864e816c112aa66a0',
    event: 'onshape_banner_click',
    label: 'Onshape extension',
  },
  {
    href: 'https://fusion.adam.new/install',
    event: 'fusion_banner_click',
    label: 'Fusion extension',
  },
] as const;

export function PromptView() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, billing, isLoading } = useAuth();
  const totalTokens = billing?.tokens.total ?? 0;
  const { data: profile, isLoading: isProfileLoading } = useProfile();
  const { isSidebarOpen } = useLayoutContext();
  const queryClient = useQueryClient();

  const firstName = useMemo(() => {
    // Wait until the profile query resolves for signed-in users so the
    // greeting doesn't flash the email local-part before snapping to the
    // real first name.
    if (user && isProfileLoading) return '';
    const source = profile?.full_name || user?.email?.split('@')[0] || '';
    return source.trim().split(/\s+/)[0] || '';
  }, [profile?.full_name, user, isProfileLoading]);

  const [type, setType] = useState<'parametric' | 'creative'>('parametric');

  const [model, setModel] = useState<Model>('google/gemini-3.1-pro-preview');

  const handleTypeChange = (newType: 'parametric' | 'creative') => {
    setType(newType);
    // Reset model to the default for the new type
    if (newType === 'creative') {
      setModel('quality');
    } else {
      setModel('google/gemini-3.1-pro-preview');
    }
  };

  const [isLoaded, setIsLoaded] = useState(false);
  const isMobile = useIsMobile();
  const [images, setImages] = useState<MessageItem[]>([]);
  const [mesh, setMesh] = useState<MessageItem | null>(null);

  const [draftConversationId, setDraftConversationId] = useState(() =>
    crypto.randomUUID(),
  );

  const lowPrompts = useMemo(() => {
    if (isLoading) return false;
    return totalTokens > 0 && totalTokens <= 10;
  }, [totalTokens, isLoading]);

  const limitReached = useMemo(() => {
    if (isLoading) return false;
    return totalTokens <= 0;
  }, [totalTokens, isLoading]);

  // Trigger fade in on mount
  useEffect(() => {
    // Use requestAnimationFrame to ensure the initial render is complete
    const frame = requestAnimationFrame(() => {
      setIsLoaded(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Helper function to get time-based greeting (memoized for performance)
  const getTimeBasedGreeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) {
      return 'Good morning';
    } else if (hour < 18) {
      return 'Good afternoon';
    } else {
      return 'Good evening';
    }
  }, []); // Empty dependency array means it only calculates once per page load

  // In SSO mode the provider redirect IS the sign-in: the existing signed-out
  // affordances below fire it directly instead of navigating to the native
  // auth routes (which bounce back to root in this mode). Same UI, same
  // pixels — only where the click goes changes.
  const { mutate: signInWithSso } = useMutation({
    mutationFn: () => signInWithSsoProvider('/'),
    onError: (error) => {
      toast({
        title: 'Whoopsies',
        description:
          error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    },
  });

  const { mutate: handleGenerate, isPending: isGenerating } = useMutation({
    mutationFn: async (parts: AppUIMessage['parts']) => {
      if (!user?.id) throw new Error('User must be authenticated');
      const conversationId = draftConversationId;

      const text = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const imageCount = parts.filter(
        (p) => p.type === 'file' && p.mediaType.startsWith('image/'),
      ).length;
      const meshCount = parts.filter(
        (p) => p.type === 'data-mesh-context',
      ).length;

      posthog.capture('new_conversation', {
        type: type,
        model_name: model,
        text: text.trim().slice(0, 100),
        image_count: imageCount,
        mesh_count: meshCount,
        conversation_id: conversationId,
      });

      // Create conversation immediately with 'New Conversation'
      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .insert([
          {
            id: conversationId,
            user_id: user.id,
            title: 'New Conversation',
            type: type,
            settings: {
              model: model,
            },
          },
        ])
        .select()
        .single();

      if (conversationError) throw conversationError;

      await ensureInputRecords({
        parts,
        conversationId: conversation.id,
        userId: user.id,
      });
      if (parts.length === 0) throw new Error('No message parts to send');

      // Persist the user message before kicking off the chat. The
      // `update_leaf_trigger` on `public.messages` advances the
      // conversation's `current_message_leaf_id` to this row, which is
      // what the server-side chat handler walks to build the model
      // branch — so the row has to land first.
      const userMessageId = await persistUserMessage({
        conversationId: conversation.id,
        parts,
        metadata: { model },
        parentMessageId: null,
      });

      const chat = createAndCacheAiChat({
        id: conversation.id,
        generateId: () => crypto.randomUUID(),
        messages: [],
        transport: new DefaultChatTransport<AppUIMessage>({
          api: apiUrl(
            type === 'creative' ? 'creative-chat' : 'parametric-chat',
          ),
          headers: async (): Promise<Record<string, string>> => {
            const accessToken = (await supabase.auth.getSession()).data.session
              ?.access_token;
            const headers: Record<string, string> = {};
            if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
            return headers;
          },
          prepareSendMessagesRequest: ({ body }) => ({
            body: {
              conversationId: conversation.id,
              model,
              ...(body ?? {}),
            },
          }),
        }),
        sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      });
      void chat
        .sendMessage({ id: userMessageId, parts, metadata: { model } })
        .catch((error) => {
          Sentry.captureException(error, {
            extra: {
              hook: 'PromptView initial chat',
              conversationId: conversation.id,
            },
          });
        });

      return {
        conversationId: conversation.id,
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate({ to: '/editor/$id', params: { id: data.conversationId } });
    },
    onError: (error) => {
      setDraftConversationId(crypto.randomUUID());
      Sentry.captureException(error);
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to process prompt',
        variant: 'destructive',
      });
    },
  });

  return (
    <div
      className={cn(
        'relative h-full min-h-full w-full transition-all duration-300 ease-in-out',
        isSidebarOpen && !isMobile && user?.id && 'pb-6 pr-6 pt-6',
      )}
    >
      <div
        className={cn(
          'h-full min-h-full bg-adam-bg-secondary-dark',
          isSidebarOpen &&
            !isMobile &&
            user?.id &&
            'rounded-xl shadow-[0_0_15px_rgba(0,0,0,0.1)]',
        )}
      >
        {!user && (
          <div className="fixed right-4 top-4 z-10 flex flex-row gap-2">
            <Button
              variant="light"
              onClick={() =>
                ssoProvider ? signInWithSso() : navigate({ to: '/signup' })
              }
              className="w-auto"
            >
              Sign Up
            </Button>
            <Button
              onClick={() =>
                ssoProvider ? signInWithSso() : navigate({ to: '/signin' })
              }
              className="w-auto"
            >
              <LogIn className="mr-2 h-4 w-4" />
              Sign In
            </Button>
          </div>
        )}

        <main className="relative flex h-full w-full flex-col items-center justify-center px-4 md:px-8">
          <div className="mx-auto flex max-w-3xl flex-col items-center justify-center">
            {/* The pill floats above the greeting (absolute, out of flow) so
                it mounting after billing resolves — or never showing for paid
                users — never reflows the centered greeting. */}
            <div className="relative flex flex-col items-center">
              <div className="absolute bottom-full left-1/2 mb-16 w-max -translate-x-1/2">
                <FreePlanTrialPill />
              </div>
              <h1
                className={cn(
                  'mb-8 text-center text-2xl font-medium text-adam-text-primary md:text-3xl lg:text-4xl',
                  'motion-safe:transition-opacity motion-safe:duration-1000 motion-safe:ease-out',
                  isLoaded ? 'opacity-100' : 'opacity-0',
                )}
              >
                {getTimeBasedGreeting}
                {firstName ? `, ${firstName}` : ''}!
              </h1>
            </div>
          </div>
          <div className="flex w-full flex-col items-center">
            <div className="w-full max-w-3xl space-y-4 pb-12">
              <SelectedItemsContext.Provider
                value={{ images, setImages, mesh, setMesh }}
              >
                <TextAreaChat
                  onSubmit={handleGenerate}
                  conversation={{
                    id: draftConversationId,
                    user_id: user?.id ?? '',
                  }}
                  onFocus={() => {
                    if (!user) {
                      if (ssoProvider) {
                        signInWithSso();
                        return;
                      }
                      navigate({ to: '/signin' });
                      return;
                    }
                  }}
                  placeholder="Start building with Adam..."
                  type={type}
                  disabled={limitReached || isGenerating}
                  model={model}
                  setModel={setModel}
                  showPromptGenerator={true}
                  showFullLabels={true}
                  onTypeChange={handleTypeChange}
                />
              </SelectedItemsContext.Provider>
              <div className="relative">
                {isLoading && (
                  <div className="absolute left-0 right-0 top-0">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-adam-blue border-t-transparent" />
                  </div>
                )}
                {!isLoading && user && limitReached && (
                  <div className="absolute left-0 right-0 top-0">
                    <LimitReachedMessage />
                  </div>
                )}
                {!isLoading && user && lowPrompts && !limitReached && (
                  <div className="absolute left-0 right-0 top-0">
                    <LowPromptsWarningMessage tokensRemaining={totalTokens} />
                  </div>
                )}
              </div>
              {!isLoading && user && !limitReached && !lowPrompts && (
                <div className="flex flex-wrap justify-center gap-2">
                  {EXTENSION_PILLS.map(({ href, event, label }) => (
                    <a
                      key={event}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        try {
                          posthog.capture(event, { location: 'prompt_view' });
                        } catch {
                          // Analytics failures (e.g. blocked by ad-blocker)
                          // must never block the link's navigation.
                        }
                      }}
                      className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-adam-text-secondary transition-colors hover:border-adam-blue/40 hover:bg-adam-blue/10 hover:text-adam-text-primary"
                    >
                      <span>
                        Try our{' '}
                        <span className="font-medium text-adam-blue">
                          {label}
                        </span>
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </a>
                  ))}
                </div>
              )}
              {!user && (
                <p className="text-center text-sm text-gray-500">
                  <Link
                    to="/signin"
                    onClick={(e) => {
                      if (ssoProvider) {
                        e.preventDefault();
                        signInWithSso();
                      }
                    }}
                    className="!text-adam-blue hover:!text-adam-blue/80"
                  >
                    Sign in
                  </Link>{' '}
                  or{' '}
                  <Link
                    to="/signup"
                    onClick={(e) => {
                      if (ssoProvider) {
                        e.preventDefault();
                        signInWithSso();
                      }
                    }}
                    className="!text-adam-blue hover:!text-adam-blue/80"
                  >
                    create an account
                  </Link>{' '}
                  to start generating
                </p>
              )}
            </div>
          </div>

          {/* Float the banner in the gap between the (vertically centered)
              composer and the bottom edge: a band over the lower third, with
              the card centered inside it, instead of glued to bottom-0. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[55%] flex items-center justify-center px-4 md:px-8">
            <div className="pointer-events-auto w-full max-w-xl">
              <NewProductBanner />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
