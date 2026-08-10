"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import URDFLoader, { type URDFRobot } from "urdf-loader";

// Live 3D view of the arm, driven by the same telemetry everyone receives.
//
// This is a spectator feature as much as an operator one: a camera shows one
// angle of the cell, while the model can be orbited freely, so a viewer can
// look at the wrist while the operator works from the front.
//
// Loaded lazily by the page. The visual meshes are ~37 MB of Collada that
// scripts/sync-robot-assets.mjs copies out of the ROS package at build time,
// which is far too much to put behind the control screen's first paint — and
// nobody on a phone should pay for it unasked.
//
// Written against three.js directly rather than react-three-fiber: the scene is
// static apart from joint values, and r3f would add a reconciler and a React
// peer-version constraint for a single <primitive>.

const JOINT_NAMES = ["joint1", "joint2", "joint3", "joint4", "joint5", "joint6"];
const URDF_URL = "/robot/dobot_cr3.urdf";

type LoadState = "loading" | "ready" | "unavailable";

/** Everything the render loop needs, kept out of React's state. */
interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
}

/**
 * @param active false while the 3D tab is hidden — the scene stays loaded but
 *   stops drawing, so leaving this view costs nothing and returning to it is
 *   instant.
 */
export default function Robot3D({
  jointsRad,
  active = true,
}: {
  jointsRad: number[];
  active?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const robotRef = useRef<URDFRobot | null>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
    camera.position.set(0.9, 0.8, 0.9);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 2);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x222933, 1.0));

    const grid = new THREE.GridHelper(4, 40, 0xc8420a, 0x6b6258);
    (grid.material as THREE.Material).opacity = 0.25;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.3, 0);
    controls.enableDamping = true;
    controls.minDistance = 0.4;
    controls.maxDistance = 4;

    let disposed = false;
    const loader = new URDFLoader();
    // Only visual geometry is shipped to the browser; the collision STLs stay
    // in the ROS package where the planner needs them.
    loader.parseCollision = false;
    loader.load(
      URDF_URL,
      (robot) => {
        if (disposed) return;
        // ROS is Z-up, three.js is Y-up.
        robot.rotation.x = -Math.PI / 2;
        robotRef.current = robot;
        scene.add(robot);
        setState("ready");
      },
      undefined,
      () => {
        if (!disposed) setState("unavailable");
      },
    );

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    runtimeRef.current = { renderer, scene, camera, controls };

    return () => {
      disposed = true;
      runtimeRef.current = null;
      observer.disconnect();
      controls.dispose();
      // Free GPU memory explicitly: switching tabs back and forth would
      // otherwise leak a scene's worth of geometry each time.
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose?.();
      });
      renderer.dispose();
      renderer.domElement.remove();
      robotRef.current = null;
    };
  }, []);

  // The draw loop runs only while this view is on screen. A hidden canvas that
  // keeps rendering costs a frame of GPU work per telemetry tick for something
  // nobody is looking at, and on a laptop that is the difference between a
  // quiet fan and a loud one for a whole class.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const runtime = runtimeRef.current;
      if (!runtime) return;
      runtime.controls.update();
      runtime.renderer.render(runtime.scene, runtime.camera);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Mirror the live joint angles.
  useEffect(() => {
    const robot = robotRef.current;
    if (!robot || jointsRad.length === 0) return;
    JOINT_NAMES.forEach((name, index) => {
      const value = jointsRad[index];
      if (value != null && robot.joints?.[name]) {
        robot.setJointValue(name, value);
      }
    });
  }, [jointsRad]);

  return (
    <div className="relative h-full min-h-64 w-full overflow-hidden rounded-xl border border-line bg-ink-surface">
      <div ref={mountRef} className="h-full w-full" />
      {state !== "ready" ? (
        <div className="ink-grid absolute inset-0 flex items-center justify-center px-6 text-center">
          <p className="font-mono text-[11px] leading-relaxed text-ink-on/60">
            {state === "loading"
              ? "Cargando el modelo 3D…"
              : "Modelo 3D no disponible. Ejecuta «git submodule update --init» y reconstruye."}
          </p>
        </div>
      ) : (
        <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-on/45">
          Arrastra para girar · rueda para acercar
        </p>
      )}
    </div>
  );
}
