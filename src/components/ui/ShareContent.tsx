import { Button } from '@/components/ui/button';
import { ClipboardCheck, CopyIcon, Loader2 } from 'lucide-react';
import { Suspense, useRef, useState } from 'react';
import {
  FacebookIcon,
  TwitterIcon,
  WhatsAppIcon,
} from '@/components/icons/CompanyIcons';
import {
  handleFacebookShare,
  handleTwitterShare,
  handleWhatsAppShare,
} from '@/utils/shareUtils';
import { MeshGifPreview } from '../viewer/MeshGifPreview';
import { OpenSCADGifPreview } from '../viewer/OpenSCADGifPreview';
import { cn } from '@/lib/utils';
import type React from 'react';

type ShareContentProps = {
  conversationId: string;
  privacy: 'public' | 'private';
  onPrivacyChange: (privacy: 'public' | 'private') => void;
  meshId?: string;
  openscadCode?: string;
};

export function ShareContent({
  conversationId,
  privacy,
  onPrivacyChange,
  meshId,
  openscadCode,
}: ShareContentProps) {
  const [justCopied, setJustCopied] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [readyToDownload, setReadyToDownload] = useState(false);

  const downloadGifRef = useRef<{ downloadGIF: () => Promise<void> } | null>(
    null,
  );

  const shareLink = `${window.location.origin}${import.meta.env.BASE_URL}/share/${conversationId}`;
  const isPublic = privacy === 'public';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareLink);
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 2000);
  };

  const handlePublicClick = () => {
    onPrivacyChange('public');
    copyToClipboard();
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-6">
        <div className="h-5 font-medium text-adam-neutral-100">
          Share public link to chat
        </div>
        <div className="flex items-center gap-3 text-xs text-adam-text-secondary">
          {isPublic ? (
            <div className="ml-1 h-1 w-1 rounded-full bg-[#64D557] outline outline-4 outline-[#79FF6B]/30" />
          ) : (
            <div className="h-3 w-3 rounded-full bg-[#FF392F] outline outline-2 outline-[#FF0000]/30" />
          )}
          {isPublic ? 'Anyone with the link can view' : 'Only you can view'}
        </div>

        {/* Local Suspense boundary — anything inside the preview (the
            OpenSCAD worker via `useOpenSCAD`, the mesh blob fetch in
            `MeshGifPreview`, react-query effects, etc.) can throw a
            promise during a normal page load. Without this fence, that
            suspension bubbles up to TanStack StartClient's `<Await>` and
            tears the whole popover subtree down — including the worker
            that's mid-compile — so the OpenSCAD STL never lands and the
            canvas stays black. Hot reload happens to skip the doomed
            path, which is why it appears to "work" after HMR. */}
        {meshId ? (
          <Suspense
            fallback={
              <div className="h-56 overflow-hidden rounded-lg border border-adam-neutral-700 bg-adam-neutral-950" />
            }
          >
            <MeshGifPreview
              ref={downloadGifRef}
              meshId={meshId}
              setIsGenerating={setIsGenerating}
              setProgress={setProgress}
              setReadyToDownload={setReadyToDownload}
            />
          </Suspense>
        ) : openscadCode ? (
          <Suspense
            fallback={
              <div className="h-56 overflow-hidden rounded-lg border border-adam-neutral-700 bg-adam-neutral-950" />
            }
          >
            <div className="h-56 overflow-hidden rounded-lg border border-adam-neutral-700 bg-adam-neutral-950">
              <OpenSCADGifPreview
                ref={downloadGifRef}
                code={openscadCode}
                setIsGenerating={setIsGenerating}
                setProgress={setProgress}
                setReadyToDownload={setReadyToDownload}
              />
            </div>
          </Suspense>
        ) : null}

        <div
          className={cn(
            'flex w-full flex-col gap-6 overflow-hidden transition-all duration-300 ease-in-out',
            isPublic && 'h-44 opacity-100',
            !isPublic && 'h-0 opacity-0',
          )}
        >
          <div className="flex w-full items-center justify-between gap-4 rounded-full bg-adam-neutral-950 py-2 pl-6 pr-3">
            <span className="line-clamp-1 text-sm text-adam-neutral-100">
              {shareLink}
            </span>
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-2 rounded-full border-2 border-black bg-white px-4 py-2 text-sm font-medium text-black focus:outline-none"
            >
              {justCopied ? (
                <ClipboardCheck className="h-4 w-4" />
              ) : (
                <CopyIcon className="h-4 w-4" />
              )}
              {justCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="grid w-full grid-cols-3 justify-between text-adam-neutral-300">
            <ShareButton
              label="WhatsApp"
              onClick={() => handleWhatsAppShare(conversationId)}
              icon={<WhatsAppIcon className="h-5 w-5" />}
            />
            <ShareButton
              label="X"
              onClick={() => handleTwitterShare(conversationId)}
              icon={<TwitterIcon className="h-5 w-5" />}
            />
            <ShareButton
              label="Facebook"
              onClick={() => handleFacebookShare(conversationId)}
              icon={<FacebookIcon className="h-5 w-5" />}
            />
          </div>
        </div>
      </div>

      {readyToDownload && (meshId || openscadCode) ? (
        <Button
          onClick={() => downloadGifRef.current?.downloadGIF()}
          disabled={isGenerating}
          className="relative overflow-hidden disabled:opacity-100"
          variant="light"
          style={
            isGenerating
              ? {
                  background: `linear-gradient(90deg, #CCCCCC ${progress * 100}%, #FFFFFF ${progress * 100}%)`,
                }
              : undefined
          }
        >
          {isGenerating ? (
            <div className="flex items-center gap-2">
              Generating...
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            'Download GIF'
          )}
        </Button>
      ) : null}

      {isPublic ? (
        <Button
          variant="destructive"
          onClick={() => onPrivacyChange('private')}
        >
          Make Private
        </Button>
      ) : (
        <Button variant="light" onClick={handlePublicClick}>
          Share
        </Button>
      )}
    </div>
  );
}

function ShareButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={onClick}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-adam-neutral-950 text-adam-neutral-100"
      >
        {icon}
      </button>
      <span className="text-xs">{label}</span>
    </div>
  );
}
