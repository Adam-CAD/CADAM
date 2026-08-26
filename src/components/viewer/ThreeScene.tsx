import { Canvas } from '@react-three/fiber';
import {
  Grid,
  OrbitControls,
  Stage,
  Environment,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import * as THREE from 'three';
import { Suspense, useMemo, useState } from 'react';
import { OrthographicPerspectiveToggle } from '@/components/viewer/OrthographicPerspectiveToggle';
import { GridToggle } from '@/components/viewer/GridToggle';
import { ViewGizmo } from '@/components/viewer/ViewGizmo';
import { cn } from '@/lib/utils';

interface ThreeSceneProps {
  geometry: THREE.BufferGeometry | null;
  color: string;
  isMobile?: boolean;
  backgroundColor?: string;
  coloredGroup?: THREE.Group | null;
}

export function ThreeScene({
  geometry,
  color,
  isMobile = false,
  backgroundColor = '#3B3B3B',
  coloredGroup,
}: ThreeSceneProps) {
  const [isOrthographic, setIsOrthographic] = useState(true);
  const [showGrid, setShowGrid] = useState(true);

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

  // Sit the ground grid at the model's base. The model is centered at the origin
  // and its group is rotated Z-up -> Y-up, so a point's world Y equals its
  // geometry Z; half the Z extent below the origin is the base.
  const groundY = useMemo(() => {
    if (geometry) {
      geometry.computeBoundingBox();
      const b = geometry.boundingBox;
      return b ? -(b.max.z - b.min.z) / 2 : 0;
    }
    if (coloredGroup) {
      const box = new THREE.Box3().setFromObject(coloredGroup);
      if (box.isEmpty()) return 0;
      return -box.getSize(new THREE.Vector3()).z / 2;
    }
    return 0;
  }, [geometry, coloredGroup]);

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
            {coloredGroup && groupCenterOffset ? (
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
          {showGrid && (
            <Grid
              position={[0, groundY, 0]}
              cellSize={30}
              cellThickness={0.5}
              cellColor="#c8c8c8"
              sectionSize={10}
              sectionColor="#f2f2f2"
              sectionThickness={0.5}
              fadeDistance={500}
              fadeStrength={1}
              followCamera={false}
              infiniteGrid={true}
            />
          )}
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
          <GridToggle showGrid={showGrid} onToggle={setShowGrid} />
          <OrthographicPerspectiveToggle
            isOrthographic={isOrthographic}
            onToggle={setIsOrthographic}
          />
        </div>
      </div>
    </div>
  );
}
