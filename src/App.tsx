import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PanelLeft, Loader2 } from 'lucide-react';

import { Sidebar } from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog';

import { useAuth } from '@/contexts/AuthContext';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

export default function App() {
  const { isLoading } = useAuth();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    localStorage.getItem('sidebarOpen') !== 'false',
  );
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false);

  // Register global keyboard shortcuts
  useKeyboardShortcuts({
    handlers: [
      {
        action: 'toggle-sidebar',
        handler: () => setIsSidebarOpen((prev) => !prev),
      },
      {
        action: 'show-shortcuts',
        handler: () => setShowShortcutsDialog(true),
      },
    ],
  });

  useEffect(() => {
    // Function to check if the viewport width is mobile-sized
    const checkIsMobile = () => {
      setIsMobile(window.innerWidth < 640); // 640px is the 'sm' breakpoint in Tailwind
    };
    // Add event listener for window resize
    window.addEventListener('resize', checkIsMobile);

    // Clean up event listener
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  useEffect(() => {
    localStorage.setItem('sidebarOpen', isSidebarOpen.toString());
  }, [isSidebarOpen]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-secondary-dark">
        <Loader2 className="h-8 w-8 animate-spin text-adam-blue" />
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden">
      {isMobile ? (
        <div className="flex h-dvh w-full items-center justify-center bg-adam-bg-dark text-adam-text-primary">
          Please use a desktop browser to access this app.
        </div>
      ) : (
        <div className="flex h-dvh transition-all ease-in-out">
          <Sidebar isSidebarOpen={isSidebarOpen} />
          <div className="relative flex-1 overflow-auto bg-adam-bg-dark">
            {/* Toggle Sidebar Button - Positioned on main content area */}
            <Button
              variant="ghost"
              size="icon"
              className={`bg-adam-neutral-3000 fixed z-10 h-7 w-7 rounded-md text-gray-400 transition-all duration-300 [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-10 ${
                isSidebarOpen ? 'left-[272px]' : 'left-20'
              } ${
                location.pathname === '/' && isSidebarOpen
                  ? 'top-[2.25rem]'
                  : 'top-3.5'
              }`}
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <div className="h-full bg-adam-bg-dark">
              <Outlet context={{ isSidebarOpen }} />
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help Dialog */}
      <KeyboardShortcutsDialog
        open={showShortcutsDialog}
        onOpenChange={setShowShortcutsDialog}
      />
    </div>
  );
}
