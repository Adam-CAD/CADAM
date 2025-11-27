import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { useCallback, useEffect, useState } from 'react';
import { ThreeScene } from '@/components/viewer/ThreeScene';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { BufferGeometry } from 'three';
import { Loader2, CircleAlert, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OpenSCADError from '@/lib/OpenSCADError';
import { cn } from '@/lib/utils';
import { useConversation } from '@/services/conversationService';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { Content } from '@shared/types';
import { useSendContentMutation } from '@/services/messageService';
import { useBlob } from '@/contexts/BlobContext';

export function OpenSCADViewer() {
  const { conversation } = useConversation();
  const { currentMessage } = useCurrentMessage();
  const { setBlob } = useBlob();
  const { compileScad, isCompiling, output, isError, error } = useOpenSCAD();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const { mutate: sendMessage } = useSendContentMutation({ conversation });

  const scadCode = currentMessage?.content.artifact?.code;

  useEffect(() => {
    if (scadCode) {
      compileScad(scadCode);
    }
  }, [scadCode, compileScad]);

  useEffect(() => {
    setBlob(output ?? null);
    if (output && output instanceof Blob) {
      output.arrayBuffer().then((buffer) => {
        const loader = new STLLoader();
        const geom = loader.parse(buffer);
        geom.center();
        geom.computeVertexNormals();
        setGeometry(geom);
      });
    } else {
      setGeometry(null);
    }
  }, [output, setBlob]);

  useEffect(() => {
    if (isError && error) {
      console.log('OpenSCAD Error:', error);
      if (error instanceof OpenSCADError) {
        console.log('Error details:', error.stdErr);
      }
    }
  }, [isError, error]);

  const fixError = useCallback(
    async (error: OpenSCADError) => {
      const newContent: Content = {
        text: 'Fix with AI',
        error: error.stdErr.join('\n'),
      };

      sendMessage(newContent);
    },
    [sendMessage],
  );

  const isLastMessage =
    conversation.current_message_leaf_id === currentMessage?.id;

  return (
    <div className="h-full w-full bg-adam-neutral-700/50 shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out">
      <div className="h-full w-full">
        {geometry ? (
          <div className="h-full w-full">
            <ThreeScene geometry={geometry} />
          </div>
        ) : (
          <>
            {isError && (
              <div className="flex h-full items-center justify-center">
                <FixWithAIButton
                  error={error}
                  fixError={isLastMessage ? fixError : undefined}
                />
              </div>
            )}
          </>
        )}
        {isCompiling && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-adam-neutral-700/30 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-adam-blue" />
              <p className="text-xs font-medium text-adam-text-primary/70">
                Compiling...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FixWithAIButton({
  error,
  fixError,
}: {
  error?: OpenSCADError | Error;
  fixError?: (error: OpenSCADError) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-adam-blue/20" />
          <CircleAlert className="h-8 w-8 text-adam-blue" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-adam-blue">
            Error Compiling Model
          </p>
          <p className="mt-1 text-xs text-adam-text-primary/60">
            Adam encountered an error while compiling
          </p>
        </div>
      </div>
      {fixError && error && error.name === 'OpenSCADError' && (
        <Button
          variant="ghost"
          className={cn(
            'group relative flex items-center gap-2 rounded-lg border',
            'bg-gradient-to-br from-adam-blue/20 to-adam-neutral-800/70 p-3',
            'border-adam-blue/30 text-adam-text-primary',
            'transition-all duration-300 ease-in-out',
            'hover:border-adam-blue/70 hover:bg-adam-blue/50 hover:text-white',
            'hover:shadow-[0_0_25px_rgba(0,166,255,0.4)]',
            'focus:outline-none focus:ring-2 focus:ring-adam-blue/30',
          )}
          onClick={() => {
            if (error && error.name === 'OpenSCADError') {
              fixError?.(error as OpenSCADError);
            }
          }}
        >
          <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-adam-blue/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <Wrench className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12" />
          <span className="relative text-sm font-medium">Fix with AI</span>
        </Button>
      )}
    </div>
  );
}
