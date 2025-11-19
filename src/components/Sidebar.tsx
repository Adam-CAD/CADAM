import { Link, useNavigate } from 'react-router-dom';
import { Plus, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { ConditionalWrapper } from './ConditionalWrapper';
import { Conversation } from '@shared/types';

interface SidebarProps {
  isSidebarOpen: boolean;
}

export function Sidebar({ isSidebarOpen }: SidebarProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: recentConversations } = useQuery<Conversation[]>({
    queryKey: ['conversations', 'recent'],
    initialData: [],
    queryFn: async () => {
      const { data: conversations, error } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .eq('user_id', user?.id ?? '')
        .limit(10);

      if (error) throw error;

      const conversationsWithTitles = await Promise.all(
        (conversations || []).map(async (conv) => {
          if (
            conv.title &&
            conv.title.toLowerCase() !== 'new conversation' &&
            conv.title.toLowerCase() !== 'untitled' &&
            conv.title.toLowerCase() !== 'conversation'
          ) {
            return conv;
          }

          const { data: messages } = await supabase
            .from('messages')
            .select('content')
            .eq('conversation_id', conv.id)
            .eq('role', 'user')
            .order('created_at', { ascending: true })
            .limit(1);

          if (messages && messages.length > 0) {
            const firstMessage = messages[0];
            let text = '';
            if (
              firstMessage.content &&
              typeof firstMessage.content === 'object' &&
              'text' in firstMessage.content
            ) {
              text = String(firstMessage.content.text || '');
            }
            const preview = text.substring(0, 40).trim();
            return {
              ...conv,
              title: preview || conv.title || 'Untitled Creation',
            };
          }

          return conv;
        }),
      );

      return conversationsWithTitles;
    },
  });

  return (
    <div
      className={`${isSidebarOpen ? 'w-64' : 'w-16'} flex h-full flex-shrink-0 flex-col bg-adam-bg-dark pb-2 transition-all duration-300 ease-in-out`}
    >
      <div className="p-4 dark:border-gray-800">
        <ConditionalWrapper
          condition={!isSidebarOpen}
          wrapper={(children) => (
            <Tooltip>
              <TooltipTrigger asChild>{children}</TooltipTrigger>
              <TooltipContent side="right" className="flex flex-col">
                <span className="font-semibold">Home</span>
                <span className="text-xs text-muted-foreground">Home Page</span>
              </TooltipContent>
            </Tooltip>
          )}
        >
          <Link to="/">
            <div className="flex cursor-pointer items-center space-x-2">
              {isSidebarOpen ? (
                <div className="flex w-full">
                  <img
                    className="mx-auto h-8 w-full"
                    src={`${import.meta.env.BASE_URL}/adam-logo-full.svg`}
                    alt="Logo"
                  />
                </div>
              ) : (
                <img
                  src={`${import.meta.env.BASE_URL}/adam-logo.svg`}
                  alt="Logo"
                  className="h-8 w-8 min-w-8"
                />
              )}
            </div>
          </Link>
        </ConditionalWrapper>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={`${isSidebarOpen ? 'px-4' : 'px-2'} flex-1 py-2 transition-all duration-300 ease-in-out`}
        >
          <ConditionalWrapper
            condition={!isSidebarOpen}
            wrapper={(children) => (
              <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent side="right" className="flex flex-col">
                  <span className="font-semibold">New Creation</span>
                  <span className="text-xs text-muted-foreground">
                    Start a new conversation
                  </span>
                </TooltipContent>
              </Tooltip>
            )}
          >
            <div className="ml-[9px]">
              <Button
                variant="secondary"
                className={` ${
                  isSidebarOpen
                    ? 'flex w-[216px] items-center justify-start gap-2 rounded-[100px] border border-adam-blue bg-adam-background-1 px-4 py-3 text-[#D7D7D7] hover:bg-adam-blue/40 hover:text-adam-text-primary'
                    : 'flex h-[30px] w-[30px] items-center justify-center rounded-[8px] border-2 border-adam-blue bg-[#191A1A] p-[2px] text-[#D7D7D7] shadow-[0px_4px_10px_0px_rgba(0,166,255,0.24)] hover:bg-adam-blue/40 hover:text-adam-text-primary'
                } mb-4`}
                onClick={() => navigate('/')}
              >
                <Plus
                  className={`h-5 w-5 ${!isSidebarOpen ? 'text-adam-neutral-300 hover:text-adam-text-primary' : ''}`}
                />
                {isSidebarOpen && (
                  <div className="text-sm font-semibold leading-[14px] tracking-[-0.14px] text-adam-neutral-200">
                    New Creation
                  </div>
                )}
              </Button>
            </div>
          </ConditionalWrapper>
          <nav className="space-y-1">
            {[
              {
                icon: LayoutGrid,
                label: 'Creations',
                href: '/history',
                description: 'View past creations',
                submenu: recentConversations,
              },
            ].map(({ icon: Icon, label, href, description, submenu }) => (
              <div key={label} className="space-y-1">
                <ConditionalWrapper
                  condition={!isSidebarOpen}
                  wrapper={(children) => (
                    <Tooltip>
                      <TooltipTrigger asChild>{children}</TooltipTrigger>
                      <TooltipContent side="right" className="flex flex-col">
                        <span className="font-semibold">{label}</span>
                        <span className="text-xs text-muted-foreground">
                          {description}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  )}
                >
                  <Link to={href}>
                    <Button
                      variant={
                        isSidebarOpen ? 'adam_dark' : 'adam_dark_collapsed'
                      }
                      className={`${isSidebarOpen ? 'w-full justify-start' : 'ml-[1px] h-[46px] w-[46px] p-0'}`}
                    >
                      <Icon
                        className={`${isSidebarOpen ? 'mr-2' : ''} h-[22px] w-[22px] min-w-[22px]`}
                      />
                      {isSidebarOpen && label}
                    </Button>
                  </Link>
                </ConditionalWrapper>
                {isSidebarOpen && submenu && (
                  <ul className="ml-7 flex list-none flex-col gap-1 border-l border-adam-neutral-500 px-2">
                    {submenu.map(
                      (
                        conversation: Omit<
                          Conversation,
                          'message_count' | 'last_message_at'
                        >,
                      ) => {
                        return (
                          <Link
                            to={`/editor/${conversation.id}`}
                            key={conversation.id}
                          >
                            <li key={conversation.id}>
                              <span className="line-clamp-1 text-ellipsis text-nowrap rounded-md p-1 text-xs font-medium text-adam-neutral-400 transition-colors duration-200 ease-in-out [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-10">
                                {conversation.title}
                              </span>
                            </li>
                          </Link>
                        );
                      },
                    )}
                  </ul>
                )}
              </div>
            ))}
          </nav>
        </div>
        <div
          className={`${isSidebarOpen ? 'px-4' : 'px-2'} py-2 transition-all duration-300 ease-in-out`}
        >
          <ConditionalWrapper
            condition={!isSidebarOpen}
            wrapper={(children) => (
              <Tooltip>
                <TooltipTrigger asChild>{children}</TooltipTrigger>
                <TooltipContent side="right" className="flex flex-col">
                  <span className="font-semibold">GitHub</span>
                  <span className="text-xs text-muted-foreground">
                    GitHub Repository
                  </span>
                </TooltipContent>
              </Tooltip>
            )}
          >
            <Link to="https://github.com/Adam-CAD/CADAM" target="_blank">
              <Button
                variant={isSidebarOpen ? 'adam_dark' : 'adam_dark_collapsed'}
                className={`${isSidebarOpen ? 'mb-1 w-full justify-start' : 'ml-[1px] h-[46px] w-[46px] p-0'}`}
              >
                <div
                  className={`${isSidebarOpen ? 'mr-2' : ''} h-[22px] w-[22px] min-w-[22px]`}
                >
                  <svg
                    role="img"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>GitHub</title>
                    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                  </svg>
                </div>
                {isSidebarOpen && 'GitHub'}
              </Button>
            </Link>
          </ConditionalWrapper>
        </div>
      </div>
    </div>
  );
}
