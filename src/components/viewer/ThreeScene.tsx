import { Canvas, ThreeEvent } from '@react-three/fiber';
import {
  OrbitControls,
  Stage,
  Environment,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import * as THREE from 'three';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { OrthographicPerspectiveToggle } from '@/components/viewer/OrthographicPerspectiveToggle';
import { ViewGizmo } from '@/components/viewer/ViewGizmo';
import { Slider } from '@/components/ui/slider';
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

const HOVER_EMISSIVE = 0x3a4a5c;
const SELECT_COLOR = 0x00a6ff;
const SELECT_EMISSIVE = 0x0a4a8f;
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

function materialOf(
  object: THREE.Object3D | null,
): THREE.MeshStandardMaterial | null {
  const material = (object as THREE.Mesh | null)?.material;
  if (material && !Array.isArray(material) && 'emissive' in material) {
    return material as THREE.MeshStandardMaterial;
  }
  return null;
}

// A selected part is recolored to a clear accent — an emissive tint alone reads
// weakly on light models. The part's own color is stored so it can be restored.
function selectHighlight(object: THREE.Object3D | null): void {
  const material = materialOf(object);
  if (!material || !object) return;
  if (object.userData.baseColorHex === undefined) {
    object.userData.baseColorHex = material.color.getHex();
  }
  material.color.setHex(SELECT_COLOR);
  material.emissive.setHex(SELECT_EMISSIVE);
}

function clearHighlight(object: THREE.Object3D | null): void {
  const material = materialOf(object);
  if (!material || !object) return;
  const base = object.userData.baseColorHex;
  if (typeof base === 'number') material.color.setHex(base);
  material.emissive.setHex(NO_EMISSIVE);
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
  explode,
  onSelectPart,
}: {
  group: THREE.Group;
  offset: THREE.Vector3;
  explode: number;
  onSelectPart?: (name: string | null) => void;
}) {
  const hovered = useRef<THREE.Object3D | null>(null);
  const selected = useRef<THREE.Object3D | null>(null);

  // Exploded view: push each part outward along the vector from the parts'
  // collective centre to the part's own centre (group-local frame).
  const spreadDirections = useMemo(() => {
    const combined = new THREE.Box3();
    const centres: { mesh: THREE.Object3D; centre: THREE.Vector3 }[] = [];
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.geometry) continue;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      if (!box) continue;
      combined.union(box);
      centres.push({ mesh, centre: box.getCenter(new THREE.Vector3()) });
    }
    const origin = combined.getCenter(new THREE.Vector3());
    return centres.map(({ mesh, centre }) => ({
      mesh,
      dir: centre.clone().sub(origin),
    }));
  }, [group]);

  useEffect(() => {
    for (const { mesh, dir } of spreadDirections) {
      mesh.position.copy(dir).multiplyScalar(explode);
    }
  }, [spreadDirections, explode]);

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
      clearHighlight(selected.current);
    }
    selected.current = mesh;
    selectHighlight(mesh);
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
  const [explode, setExplode] = useState(0);

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
                explode={explode}
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

      {partsGroup && partsGroup.children.length > 1 && (
        <div className="absolute bottom-2 left-2 flex w-44 items-center gap-2 rounded-md bg-adam-neutral-800/80 px-3 py-2">
          <span className="whitespace-nowrap text-xs text-adam-text-primary/80">
            Éclaté
          </span>
          <Slider
            value={[explode]}
            onValueChange={(v) => setExplode(v[0] ?? 0)}
            min={0}
            max={1.5}
            step={0.05}
            aria-label="Vue éclatée"
          />
        </div>
      )}

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
