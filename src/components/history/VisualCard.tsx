import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  MessageSquare,
  MoreVertical,
  Trash2,
  Pencil,
  Box,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatDistanceToNow } from 'date-fns';
import { HistoryConversation } from '@/types/misc';
import { supabase } from '@/lib/supabase';
import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { Canvas } from '@react-three/fiber';
import {
  OrbitControls,
  Stage,
  Environment,
  PerspectiveCamera,
} from '@react-three/drei';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { BufferGeometry } from 'three';

interface VisualCardProps {
  conversation: HistoryConversation;
  onDelete: (conversationId: string) => void;
  onRename: (conversationId: string, newTitle: string) => void;
}

function ThreePreview({ geometry }: { geometry: BufferGeometry }) {
  return (
    <Canvas className="h-full w-full">
      <color attach="background" args={['#1a1a1a']} />
      <PerspectiveCamera
        makeDefault
        position={[-100, 100, 100]}
        fov={45}
        near={0.1}
        far={1000}
        zoom={0.4}
      />
      <Stage environment={null} intensity={0.6} position={[0, 0, 0]}>
        <Environment files={`${import.meta.env.BASE_URL}/city.hdr`} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <directionalLight position={[-5, 5, 5]} intensity={0.2} />
        <mesh
          geometry={geometry}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
        >
          <meshStandardMaterial
            color="#00A6FF"
            metalness={0.6}
            roughness={0.3}
            envMapIntensity={0.3}
          />
        </mesh>
      </Stage>
      <OrbitControls
        makeDefault
        enableDamping={false}
        enableZoom={false}
        autoRotate={true}
        autoRotateSpeed={1}
      />
    </Canvas>
  );
}

export function VisualCard({
  conversation,
  onDelete,
  onRename,
}: VisualCardProps) {
  const [artifactCode, setArtifactCode] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { compileScad, isCompiling, output, isError } = useOpenSCAD();

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { rootMargin: '100px' },
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      if (cardRef.current) {
        observer.unobserve(cardRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const fetchLastArtifact = async () => {
      try {
        const { data: messages, error } = await supabase
          .from('messages')
          .select('content')
          .eq('conversation_id', conversation.id)
          .eq('role', 'assistant')
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;

        const messageWithArtifact = messages?.find(
          (msg) =>
            msg.content &&
            typeof msg.content === 'object' &&
            'artifact' in msg.content &&
            msg.content.artifact,
        );

        if (
          messageWithArtifact &&
          messageWithArtifact.content &&
          typeof messageWithArtifact.content === 'object' &&
          'artifact' in messageWithArtifact.content
        ) {
          const artifact = messageWithArtifact.content.artifact;
          if (
            artifact &&
            typeof artifact === 'object' &&
            'code' in artifact &&
            typeof artifact.code === 'string'
          ) {
            setArtifactCode(artifact.code);
          }
        }
      } catch (error) {
        console.error('Error fetching artifact:', error);
      }
    };

    fetchLastArtifact();
  }, [conversation.id]);

  useEffect(() => {
    if (artifactCode) {
      compileScad(artifactCode);
    }
  }, [artifactCode, compileScad]);

  useEffect(() => {
    let isMounted = true;

    if (output && output instanceof Blob) {
      output
        .arrayBuffer()
        .then((buffer) => {
          if (isMounted) {
            const loader = new STLLoader();
            const geom = loader.parse(buffer);
            geom.center();
            geom.computeVertexNormals();
            setGeometry(geom);
          }
        })
        .catch((error) => {
          console.error('Error loading STL:', error);
        });
    } else {
      setGeometry(null);
    }

    return () => {
      isMounted = false;
    };
  }, [output]);

  return (
    <div
      ref={cardRef}
      className="group relative overflow-hidden rounded-xl border-2 border-adam-neutral-700 bg-adam-background-2 transition-all duration-200 hover:border-adam-blue hover:shadow-[0_0_20px_rgba(0,166,255,0.3)]"
    >
      <Link to={`/editor/${conversation.id}`}>
        <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-adam-background-1 to-adam-background-2">
          {!isVisible ? (
            <div className="flex h-full w-full items-center justify-center">
              <Box className="text-adam-neutral-600 h-16 w-16 opacity-30" />
            </div>
          ) : isCompiling ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-adam-blue" />
                <span className="text-xs text-adam-neutral-400">
                  Compiling...
                </span>
              </div>
            </div>
          ) : isError || !geometry ? (
            <div className="flex h-full w-full items-center justify-center">
              <Box className="text-adam-neutral-600 h-16 w-16 opacity-50" />
            </div>
          ) : (
            <ThreePreview geometry={geometry} />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-adam-background-2/90 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        </div>

        <div className="p-4">
          <h3 className="mb-2 line-clamp-2 text-base font-medium text-adam-neutral-50">
            {conversation.title}
          </h3>
          <div className="flex items-center gap-3 text-xs text-adam-neutral-400">
            <span className="flex items-center">
              <Clock className="mr-1 h-3 w-3" />
              {formatDistanceToNow(new Date(conversation.updated_at), {
                addSuffix: true,
              })}
            </span>
            <span className="flex items-center">
              <MessageSquare className="mr-1 h-3 w-3" />
              {conversation.message_count}
            </span>
          </div>
        </div>
      </Link>

      <div className="absolute right-2 top-2">
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 rounded-full bg-adam-background-1/80 p-0 backdrop-blur-sm transition-colors duration-200 hover:bg-adam-neutral-950"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4 text-adam-neutral-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#191A1A]">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(conversation.id, conversation.title);
                }}
                className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 focus:bg-adam-neutral-950"
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 hover:text-red-500 focus:bg-adam-neutral-950 focus:text-red-500">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </AlertDialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialogContent className="border-[2px] border-adam-neutral-700 bg-adam-background-1">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-adam-neutral-100">
                Delete Creation
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this creation? This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conversation.id);
                }}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
