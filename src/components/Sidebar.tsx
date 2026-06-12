import { useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Menu, Plus, LogOut, Crown, Settings, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useQuery } from '@tanstack/react-query';
import { ConditionalWrapper } from './ConditionalWrapper';
import { DiscordIcon, GitHubIcon } from './icons/CompanyIcons';
import { cn } from '@/lib/utils';
import { Conversation, ConversationSettings } from '@shared/types';
import { UserAvatar } from '@/components/chat/UserAvatar';
import { SidebarConversationItem } from '@/components/sidebar/SidebarConversationItem';
import { RenameDialogDrawer } from '@/components/history/RenameDialogDrawer';
import {
  useDeleteConversation,
  useRenameConversation,
} from '@/services/conversationService';
import { useProfile } from '@/services/profileService';
import { useToast } from '@/hooks/use-toast';

interface SidebarProps {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
}

type SidebarPath = '/' | '/history' | '/subscription';

function DesktopSidebar({ isSidebarOpen, setIsSidebarOpen }: SidebarProps) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const isMobile = useIsMobile();
  const { data: profile } = useProfile();
  const { toast } = useToast();
  const activeEditorId = useRouterState({
    select: (state) => state.location.pathname.match(/^\/editor\/([^/]+)/)?.[1],
  });
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);

  const deleteConversation = useDeleteConversation({
    onDeleted: (conversationId) => {
      if (activeEditorId === conversationId) {
        navigate({ to: '/' });
      }
    },
  });

  const renameConversation = useRenameConversation({
    onRenamed: () => {
      setRenameOpen(false);
      setRenameTarget(null);
    },
  });

  // Get 10 most recent conversations
  const { data: recentConversations } = useQuery<Conversation[]>({
    queryKey: ['conversations', 'recent'],
    initialData: [],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .eq('user_id', user?.id ?? '')
        .limit(10)
        .overrideTypes<Array<{ settings: ConversationSettings }>>();

      if (error) throw error;

      return data;
    },
  });

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate({ to: '/signin' });
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const sidebarNavigate = (path: SidebarPath) => {
    if (isMobile) {
      setIsSidebarOpen(false); // setIsSidebarOpen is actually setOpen from Sheet component
    }
    navigate({ to: path });
  };

  const closeMobileSidebar = () => {
    if (isMobile) {
      setIsSidebarOpen(false);
    }
  };

  const handleRenameRequest = (
    conversationId: string,
    currentTitle: string,
  ) => {
    const conversation = recentConversations?.find(
      (item) => item.id === conversationId,
    );
    if (!conversation) return;
    setRenameTarget(conversation);
    setRenameTitle(currentTitle || conversation.title);
    setRenameOpen(true);
  };

  const handleRenameSave = () => {
    if (!renameTarget) return;
    if (!renameTitle.trim()) {
      toast({
        title: 'Title cannot be empty',
        variant: 'default',
      });
      return;
    }
    renameConversation.mutate({
      conversationId: renameTarget.id,
      newTitle: renameTitle.trim(),
    });
  };

  const renderUserSectionTrigger = () => {
    if (isSidebarOpen) {
      return (
        <div className="flex cursor-pointer items-center space-x-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent-foreground">
          <UserAvatar />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-adam-text-primary">
              {profile?.full_name || user?.email?.split('@')[0] || 'User'}
            </span>
            <span className="text-xs text-adam-text-tertiary dark:text-gray-400">
              {user?.email}
            </span>
          </div>
        </div>
      );
    }

    return (
      <Button
        variant="adam_dark_collapsed_avatar"
        className="group ml-[1px] h-[46px] w-[46px] px-0 py-6"
      >
        <UserAvatar className="h-[30px] w-[30px] transition-all duration-200 ease-in-out group-hover:h-[26px] group-hover:w-[26px] group-hover:ring-2 group-hover:ring-adam-neutral-500" />
      </Button>
    );
  };

  return (
    <div
      className={`${isSidebarOpen ? 'w-64' : 'w-16'} flex h-full flex-shrink-0 flex-col bg-adam-bg-dark pb-2 transition-all duration-300 ease-in-out dark:bg-gray-950`}
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
          <button
            type="button"
            className="flex w-full cursor-pointer items-center space-x-2"
            onClick={() => sidebarNavigate('/')}
          >
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
          </button>
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
                onClick={() => sidebarNavigate('/')}
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
                href: '/history' as const,
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
                  <Button
                    variant={
                      isSidebarOpen ? 'adam_dark' : 'adam_dark_collapsed'
                    }
                    onClick={() => sidebarNavigate(href)}
                    className={`${isSidebarOpen ? 'w-full justify-start' : 'ml-[1px] h-[46px] w-[46px] p-0'}`}
                  >
                    <Icon
                      className={`${isSidebarOpen ? 'mr-2' : ''} h-[22px] w-[22px] min-w-[22px]`}
                    />
                    {isSidebarOpen && label}
                  </Button>
                </ConditionalWrapper>
                {isSidebarOpen && submenu && (
                  <div className="ml-7 border-l border-adam-neutral-500 px-2">
                    {submenu.length === 0 ? (
                      <p className="px-1 py-1.5 text-xs text-adam-neutral-500">
                        No creations yet
                      </p>
                    ) : (
                      <ul className="flex list-none flex-col gap-0.5">
                        {submenu.map((conversation) => (
                          <SidebarConversationItem
                            key={conversation.id}
                            conversation={conversation}
                            onDelete={(id) => deleteConversation.mutate(id)}
                            onRename={handleRenameRequest}
                            onNavigate={closeMobileSidebar}
                          />
                        ))}
                      </ul>
                    )}
                    {submenu.length > 0 && (
                      <Link
                        to="/history"
                        onClick={closeMobileSidebar}
                        className="mt-1 block px-1 py-1 text-xs font-medium text-adam-blue transition-colors [@media(hover:hover)]:hover:text-adam-blue/80"
                      >
                        View all creations
                      </Link>
                    )}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div
          className={`${isSidebarOpen ? 'px-4' : 'px-2'} py-4 transition-all duration-300 ease-in-out dark:border-gray-800`}
        >
          <div className={cn('flex flex-col gap-2', isSidebarOpen && 'gap-3')}>
            {/* GitHub Button - Collapsed state */}
            {!isSidebarOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://github.com/Adam-CAD/CADAM"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant="adam_dark_collapsed"
                      className="mb-0 ml-[1px] h-[46px] w-[46px] p-0"
                    >
                      <GitHubIcon className="h-[22px] w-[22px]" />
                    </Button>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex flex-col">
                  <span className="font-semibold">GitHub</span>
                  <span className="text-xs text-muted-foreground">
                    View source code
                  </span>
                </TooltipContent>
              </Tooltip>
            )}

            {/* GitHub Button - Expanded state */}
            {isSidebarOpen && (
              <a
                href="https://github.com/Adam-CAD/CADAM"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="adam_dark"
                  className="flex h-10 w-full items-center justify-start gap-2"
                >
                  <GitHubIcon className="h-[22px] w-[22px] min-w-[22px]" />
                  GitHub
                </Button>
              </a>
            )}

            {/* Discord Button - Collapsed state */}
            {!isSidebarOpen && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href="https://discord.com/invite/HKdXDqAHCs"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button
                      variant="adam_dark_collapsed"
                      className="mb-0 ml-[1px] h-[46px] w-[46px] p-0"
                    >
                      <DiscordIcon className="h-[22px] w-[22px]" />
                    </Button>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex flex-col">
                  <span className="font-semibold">Discord</span>
                  <span className="text-xs text-muted-foreground">
                    Join our community
                  </span>
                </TooltipContent>
              </Tooltip>
            )}

            {/* Discord Button - Expanded state */}
            {isSidebarOpen && (
              <a
                href="https://discord.com/invite/HKdXDqAHCs"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button
                  variant="adam_dark"
                  className="flex h-10 w-full items-center justify-start gap-2"
                >
                  <DiscordIcon className="h-[22px] w-[22px] min-w-[22px]" />
                  Discord
                </Button>
              </a>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {renderUserSectionTrigger()}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-56"
                align="end"
                side={isMobile ? 'top' : 'right'}
              >
                <div className="flex items-center space-x-2 p-2">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium text-adam-text-primary">
                      {profile?.full_name ||
                        user?.email?.split('@')[0] ||
                        'User'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {user?.email}
                    </p>
                  </div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuGroup className="text-adam-text-primary">
                  <DropdownMenuItem asChild>
                    <Link to="/settings" className="flex items-center">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Settings</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => sidebarNavigate('/subscription')}
                  >
                    <Crown className="mr-2 h-4 w-4" />
                    <span>Subscriptions</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4 text-adam-text-primary" />
                  <span className="text-adam-text-primary">Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <RenameDialogDrawer
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) setRenameTarget(null);
        }}
        newTitle={renameTitle}
        onNewTitleChange={setRenameTitle}
        onRename={handleRenameSave}
      />
    </div>
  );
}

function MobileSidebar({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isSidebarOpen,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setIsSidebarOpen,
}: SidebarProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="fixed left-2 top-2.5 z-50 hover:bg-adam-neutral-700 md:hidden"
        >
          <Menu className="h-5 w-5 text-adam-text-primary" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="bg-adam-bg-dark p-0 [&>button]:text-white"
      >
        {/* For aria stuff */}
        <SheetHeader className="hidden">
          <SheetTitle className="text-adam-text-primary">AdamCAD</SheetTitle>
          <SheetDescription>
            AI-powered CAD software for everyone
          </SheetDescription>
        </SheetHeader>
        <DesktopSidebar isSidebarOpen={true} setIsSidebarOpen={setOpen} />
      </SheetContent>
    </Sheet>
  );
}

export function Sidebar({ isSidebarOpen, setIsSidebarOpen }: SidebarProps) {
  const isMobile = useIsMobile();
  const { user } = useAuth();

  // Don't display the sidebar if the user isn't logged in
  if (user == null) {
    return <></>;
  }

  return isMobile ? (
    <MobileSidebar
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
    />
  ) : (
    <DesktopSidebar
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
    />
  );
}
