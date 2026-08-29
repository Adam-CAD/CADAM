import { Canvas, ThreeEvent } from '@react-three/fiber';
import {
  OrbitControls,
  Stage,
  Environment,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import * as THREE from 'three';
import { Suspense, useMemo, useRef, useState } from 'react';
import { OrthographicPerspectiveToggle } from '@/components/viewer/OrthographicPerspectiveToggle';
import { ViewGizmo } from '@/components/viewer/ViewGizmo';
import { cn } from '@/lib/utils';

interface ThreeSceneProps {
  geometry: THREE.BufferGeometry | null;
  color: string;
  isMobile?: boolean;
  backgroundColor?: string;
  coloredGroup?: THREE.Group | null;
  partsGroup?: THREE.Group | null;
  onSelectPart?: (name: string | null) => void;
}

const HOVER_EMISSIVE = 0x2a3542;
const SELECT_EMISSIVE = 0x1150aa;
const NO_EMISSIVE = 0x000000;

function emissiveOf(object: THREE.Object3D | null): THREE.Color | null {
  const material = (object as THREE.Mesh | null)?.material;
  if (material && !Array.isArray(material) && 'emissive' in material) {
    return (material as THREE.MeshStandardMaterial).emissive;
  }
  return null;
}

function paint(object: THREE.Object3D | null, hex: number): void {
  emissiveOf(object)?.setHex(hex);
}

/**
 * Render the per-part AMF group and let the user hover/click a part. Hover
 * tints the hit part; clicking selects it and reports its name upward. The
 * group is a raw THREE object (not R3F-managed), so highlighting mutates each
 * mesh's emissive directly — cheap and reversible.
 */
function PickableParts({
  group,
  offset,
  onSelectPart,
}: {
  group: THREE.Group;
  offset: THREE.Vector3;
  onSelectPart?: (name: string | null) => void;
}) {
  const hovered = useRef<THREE.Object3D | null>(null);
  const selected = useRef<THREE.Object3D | null>(null);

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const mesh = event.object;
    if (hovered.current === mesh) return;
    if (hovered.current && hovered.current !== selected.current) {
      paint(hovered.current, NO_EMISSIVE);
    }
    hovered.current = mesh;
    if (mesh !== selected.current) paint(mesh, HOVER_EMISSIVE);
    document.body.style.cursor = 'pointer';
  };

  const handleOut = () => {
    if (hovered.current && hovered.current !== selected.current) {
      paint(hovered.current, NO_EMISSIVE);
    }
    hovered.current = null;
    document.body.style.cursor = 'auto';
  };

  const handleDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const mesh = event.object;
    if (selected.current && selected.current !== mesh) {
      paint(selected.current, NO_EMISSIVE);
    }
    selected.current = mesh;
    paint(mesh, SELECT_EMISSIVE);
    const name =
      (mesh.userData.partName as string | undefined) ?? mesh.name ?? null;
    onSelectPart?.(name);
  };

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <primitive
        object={group}
        position={offset.toArray()}
        onPointerMove={handleMove}
        onPointerOut={handleOut}
        onPointerDown={handleDown}
      />
    </group>
  );
}

export function ThreeScene({
  geometry,
  color,
  isMobile = false,
  backgroundColor = '#3B3B3B',
  coloredGroup,
  partsGroup,
  onSelectPart,
}: ThreeSceneProps) {
  const [isOrthographic, setIsOrthographic] = useState(true);

  // Store the initial isMobile value to prevent position changes during resize
  const [initialIsMobile] = useState(isMobile);

  // The colored group's meshes sit at their raw OpenSCAD coordinates.
  // Offset so the combined bounds are centered at origin, mirroring the
  // STL path's geom.center() behavior.
  const groupCenterOffset = useMemo(() => {
    if (!coloredGroup) return null;
    const box = new THREE.Box3().setFromObject(coloredGroup);
    if (box.isEmpty()) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3()).negate();
  }, [coloredGroup]);

  const partsCenterOffset = useMemo(() => {
    if (!partsGroup) return null;
    const box = new THREE.Box3().setFromObject(partsGroup);
    if (box.isEmpty()) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3()).negate();
  }, [partsGroup]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Local Suspense boundary — `<Canvas>` re-throws suspension upward
          when any drei loader (e.g. <Environment> fetching city.hdr) is in
          flight. Without this boundary the suspension propagates all the
          way to <Await> inside TanStack's StartClient and tears down the
          entire app subtree. */}
      <Suspense
        fallback={<div className="h-full w-full" style={{ backgroundColor }} />}
      >
        <Canvas className="block h-full w-full">
          <color attach="background" args={[backgroundColor]} />
          {isOrthographic ? (
            <OrthographicCamera
              makeDefault
              position={initialIsMobile ? [-100, 150, 100] : [-100, 100, 100]}
              zoom={40}
              near={0.1}
              far={1000}
            />
          ) : (
            <PerspectiveCamera
              makeDefault
              position={initialIsMobile ? [-100, 150, 100] : [-100, 100, 100]}
              fov={45}
              near={0.1}
              far={1000}
              zoom={0.4}
            />
          )}
          <Stage environment={null} intensity={0.6} position={[0, 0, 0]}>
            <Environment files={`${import.meta.env.BASE_URL}/city.hdr`} />
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
            <directionalLight position={[-5, 5, 5]} intensity={0.2} />
            <directionalLight position={[-5, 5, -5]} intensity={0.2} />
            <directionalLight position={[0, 5, 0]} intensity={0.2} />
            <directionalLight position={[-5, -5, -5]} intensity={0.6} />
            {partsGroup && partsCenterOffset ? (
              <PickableParts
                group={partsGroup}
                offset={partsCenterOffset}
                onSelectPart={onSelectPart}
              />
            ) : coloredGroup && groupCenterOffset ? (
              <group rotation={[-Math.PI / 2, 0, 0]}>
                <primitive
                  object={coloredGroup}
                  position={groupCenterOffset.toArray()}
                />
              </group>
            ) : geometry ? (
              <mesh
                geometry={geometry}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0, 0]}
              >
                <meshStandardMaterial
                  color={color}
                  metalness={0.6}
                  roughness={0.3}
                  envMapIntensity={0.3}
                />
              </mesh>
            ) : null}
          </Stage>
          {/* <Grid
          position={[0, 0, 0]}
          cellSize={30}
          cellThickness={0.5}
          sectionSize={10}
          sectionColor="gray"
          sectionThickness={0.5}
          fadeDistance={500}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid={true}
        /> */}
          <OrbitControls
            makeDefault
            enableDamping={true}
            dampingFactor={0.05}
          />
          {!initialIsMobile && <ViewGizmo />}
        </Canvas>
      </Suspense>

      <div
        className={cn(
          'absolute flex flex-col items-center',
          initialIsMobile ? 'bottom-2 right-2' : 'bottom-2 right-9',
        )}
      >
        <div className="flex items-center gap-2">
          <OrthographicPerspectiveToggle
            isOrthographic={isOrthographic}
            onToggle={setIsOrthographic}
          />
        </div>
      </div>
    </div>
  );
}
