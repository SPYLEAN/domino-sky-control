"use client";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
import gsap from "gsap";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ChevronLeft, ChevronRight, Map as MapIcon, Minus, Pause, Play, Plus, RotateCcw, ScrollText } from "lucide-react";
import { fmt } from "@/engine/time";
import type { Network, SimulatedFlight, SimulationResult } from "@/engine/types";
import { JourneyLab } from "../JourneyLab";

/* ------------------------------------------------------------------ */
/* Stage model — every value is read from engine output, never computed */
/* ------------------------------------------------------------------ */

type StageKey = "overview" | "arrival" | "turnaround" | "delay" | "cascade" | "recovery";
interface Stage { key: StageKey; kicker: string; title: string; body: string; rows: [string, string][]; tone: string }

function buildStages(net: Network, sim: SimulatedFlight, result: SimulationResult, before: SimulatedFlight | null): Stage[] {
  const f = sim.flight;
  const e = sim.evidence;
  const ap = (id: string) => `${net.airportById[id].city} (${id})`;
  const legs = result.flights.filter((x) => x.tail === sim.tail).sort((a, b) => a.flight.dep - b.flight.dep);
  const next = legs[legs.findIndex((x) => x.flight.id === f.id) + 1] ?? null;
  const stages: Stage[] = [];
  stages.push({
    key: "overview", kicker: "Camera 01 · Aircraft overview", tone: "#65D8EF",
    title: `${sim.tail} · ${f.id}`,
    body: `${f.id} flies ${ap(f.origin)} → ${ap(f.destination)} with ${f.pax} passengers booked, operated by crew ${sim.crewId}.`,
    rows: [["Aircraft", sim.tail], ["Scheduled", `${fmt(f.dep)} → ${fmt(f.arr)}`], ["Simulated", sim.status === "cancelled" ? "Not operated" : `${fmt(sim.actualDep)} → ${fmt(sim.actualArr)}`]],
  });
  if (sim.status === "cancelled" || !e) {
    stages.push({
      key: "delay", kicker: "Camera 04 · Why it did not fly", tone: "#F26E73",
      title: "Not operated",
      body: `${f.id} is cancelled (${(sim.cancelReason ?? "").replace(/_/g, " ")}${sim.cancelCauseFlight ? `, caused by ${sim.cancelCauseFlight}` : ""}). The aircraft stays parked — the scene never shows a cancelled flight operating.`,
      rows: [["Status", "Cancelled"], ["Reason", (sim.cancelReason ?? "").replace(/_/g, " ")], ["Booked passengers", String(f.pax)]],
    });
    return stages;
  }
  const prev = e.aircraftReady.prevFlight;
  stages.push(prev
    ? { key: "arrival", kicker: "Camera 02 · Previous arrival", tone: "#F4F8FC", title: `${prev} arrives ${fmt(e.aircraftReady.prevArr)}`,
      body: `The aircraft for ${f.id} reaches ${ap(f.origin)} on ${prev}, landing at ${fmt(e.aircraftReady.prevArr)} (simulated).`,
      rows: [["Inbound flight", prev], ["Simulated arrival", fmt(e.aircraftReady.prevArr)], ["Scheduled arrival", fmt(net.flightById[prev].arr)]] }
    : { key: "arrival", kicker: "Camera 02 · Previous arrival", tone: "#78E9C4", title: "First flight of the day",
      body: `${f.id} is ${sim.tail}'s first leg. There is no inbound aircraft, so no previous-arrival dependency exists.`,
      rows: [["Aircraft available", e.aircraftReady.source === "spare_available_from" ? fmt(e.aircraftReady.value) : "parked at origin"]] });
  stages.push({
    key: "turnaround", kicker: "Camera 03 · Turnaround", tone: "#65D8EF",
    title: prev ? `${e.aircraftReady.turnaround} minutes on the stand` : "No turnaround needed",
    body: prev
      ? `Unloading, cleaning, refuelling and boarding need at least ${e.aircraftReady.turnaround} minutes (dataset minimum). Ready = ${fmt(e.aircraftReady.prevArr)} + ${e.aircraftReady.turnaround} = ${fmt(e.aircraftReady.value)}.`
      : "Without an inbound flight the aircraft is already on the stand when the day begins.",
    rows: prev ? [["Minimum turnaround", `${e.aircraftReady.turnaround} min`], ["Aircraft ready", fmt(e.aircraftReady.value)], ["Crew ready", fmt(e.crewReady.value)]] : [["Crew ready", fmt(e.crewReady.value)]],
  });
  const bindingText: Record<string, string> = {
    schedule: "Nothing held it back — it left on schedule.",
    aircraft_rotation: `The aircraft was not ready until ${fmt(e.aircraftReady.value)}, after the scheduled ${fmt(f.dep)}.`,
    crew_connection: `The crew was not ready until ${fmt(e.crewReady.value)}.`,
    closure_departure: `${ap(f.origin)} was closed; departure waited for reopening.`,
    closure_arrival_hold: `${ap(f.destination)} was closed at the planned landing time, so the flight was held on the ground here.`,
    connection_hold: "The dispatcher held it so connecting passengers could board.",
    spare_availability: "It waited for the spare aircraft to become available.",
  };
  stages.push({
    key: "delay", kicker: "Camera 04 · Delay", tone: sim.delay ? "#F4BA65" : "#78E9C4",
    title: sim.delay ? `+${sim.delay} min: departs ${fmt(sim.actualDep)}` : `On time: departs ${fmt(sim.actualDep)}`,
    body: bindingText[e.binding] ?? e.binding,
    rows: [["Scheduled departure", fmt(f.dep)], ["Earliest before closure rules", fmt(e.earliestBeforeClosure)], ["Actual departure", fmt(sim.actualDep)], ["Binding constraint", e.binding.replace(/_/g, " ")]],
  });
  if (next) {
    const ne = next.evidence;
    const caused = ne?.binding === "aircraft_rotation" && ne.aircraftReady.prevFlight === f.id;
    stages.push({
      key: "cascade", kicker: "Camera 05 · Cascade", tone: next.status === "cancelled" ? "#F26E73" : caused ? "#F4BA65" : "#78E9C4",
      title: next.status === "cancelled" ? `${next.flight.id} cancelled` : caused ? `${next.flight.id} pushed to ${fmt(next.actualDep)}` : `${next.flight.id} unaffected by this leg`,
      body: next.status === "cancelled"
        ? `The next leg ${next.flight.id} does not operate (${(next.cancelReason ?? "").replace(/_/g, " ")}).`
        : caused
          ? `This aircraft lands at ${fmt(sim.actualArr)}; +${ne!.aircraftReady.turnaround} min makes it ready at ${fmt(ne!.aircraftReady.value)}, after ${next.flight.id}'s scheduled ${fmt(next.flight.dep)}. The delay travels on.`
          : `This aircraft lands at ${fmt(sim.actualArr)} and is ready by ${fmt(sim.actualArr! + net.minTurnaround)}; ${next.flight.id} was not held back by it.`,
      rows: [["Next flight", `${next.flight.id} ${next.flight.origin}→${next.flight.destination}`], ["Scheduled", fmt(next.flight.dep)], ["Simulated", next.status === "cancelled" ? "Cancelled" : `${fmt(next.actualDep)} (+${next.delay})`]],
    });
  } else {
    stages.push({ key: "cascade", kicker: "Camera 05 · Cascade", tone: "#78E9C4", title: "End of rotation", body: `${f.id} is ${sim.tail}'s last flight of the day, so the delay goes no further on this aircraft.`, rows: [] });
  }
  if (before) {
    const changed = before.status !== sim.status || before.actualDep !== sim.actualDep || before.tail !== sim.tail;
    stages.push({
      key: "recovery", kicker: "Camera 06 · Recovery", tone: "#78E9C4",
      title: changed ? "Changed by the applied plan" : "Unchanged by the applied plan",
      body: changed ? `Before recovery: ${before.status === "cancelled" ? "cancelled" : `departs ${fmt(before.actualDep)} on ${before.tail}`}. After: ${`departs ${fmt(sim.actualDep)} on ${sim.tail}`}.` : "The applied recovery plan does not alter this flight.",
      rows: [["Before", before.status === "cancelled" ? "Cancelled" : `${fmt(before.actualDep)} (+${before.delay})`], ["After", `${fmt(sim.actualDep)} (+${sim.delay})`]],
    });
  }
  return stages;
}

/* ------------------------------ Scene ------------------------------ */

const METAL = { color: "#dfe7ef", metalness: 0.55, roughness: 0.32 } as const;

function Aircraft({ tail, tone }: { tail: string; tone: string }) {
  const wing = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(-1.6, 6.2); s.lineTo(-2.4, 6.2); s.lineTo(-2.2, 0); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: false });
  }, []);
  const stab = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(-0.9, 2.2); s.lineTo(-1.4, 2.2); s.lineTo(-1.2, 0); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false });
  }, []);
  return (
    <group>
      {/* fuselage along +x */}
      <mesh castShadow rotation={[0, 0, Math.PI / 2]} position={[0, 1.6, 0]}>
        <capsuleGeometry args={[0.62, 9.5, 8, 24]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
      {/* cockpit windows */}
      <mesh position={[5.05, 1.85, 0]} rotation={[0, 0, -0.35]}>
        <boxGeometry args={[0.35, 0.18, 0.9]} />
        <meshStandardMaterial color="#0b1828" metalness={0.9} roughness={0.1} />
      </mesh>
      {/* cabin stripe */}
      <mesh position={[0, 1.75, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.625, 0.625, 8.2, 24, 1, true, Math.PI * 0.35, Math.PI * 0.3]} />
        <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={0.25} side={THREE.DoubleSide} />
      </mesh>
      {/* wings */}
      <mesh castShadow geometry={wing} position={[1.2, 1.25, 0.4]} rotation={[Math.PI / 2, 0, 0]}><meshStandardMaterial {...METAL} /></mesh>
      <mesh castShadow geometry={wing} position={[1.2, 1.25, -0.4]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, -1]}><meshStandardMaterial {...METAL} /></mesh>
      {/* engines */}
      {[2.4, -2.4].map((z) => (
        <group key={z} position={[0.9, 0.85, z]}>
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.38, 0.32, 1.6, 20]} /><meshStandardMaterial color="#c9d3dd" metalness={0.7} roughness={0.25} /></mesh>
          <mesh position={[0.81, 0, 0]} rotation={[0, 0, Math.PI / 2]}><circleGeometry args={[0.33, 20]} /><meshStandardMaterial color="#0b1828" /></mesh>
        </group>
      ))}
      {/* vertical fin */}
      <mesh castShadow position={[-4.6, 3.05, 0]} rotation={[0, 0, 0.5]}>
        <boxGeometry args={[1.5, 2.4, 0.12]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
      <mesh position={[-4.75, 3.3, 0]} rotation={[0, 0, 0.5]}>
        <boxGeometry args={[0.9, 1.4, 0.14]} />
        <meshStandardMaterial color={tone} emissive={tone} emissiveIntensity={0.3} />
      </mesh>
      {/* horizontal stabilisers */}
      <mesh castShadow geometry={stab} position={[-4.1, 1.75, 0.3]} rotation={[Math.PI / 2, 0, 0]}><meshStandardMaterial {...METAL} /></mesh>
      <mesh castShadow geometry={stab} position={[-4.1, 1.75, -0.3]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, 1, -1]}><meshStandardMaterial {...METAL} /></mesh>
      {/* landing gear */}
      {[[4.1, 0], [0.2, 0.9], [0.2, -0.9]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.65, 0]}><cylinderGeometry args={[0.05, 0.05, 1.0, 8]} /><meshStandardMaterial color="#8aa0b8" /></mesh>
          <mesh castShadow position={[0, 0.22, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.22, 0.22, 0.2, 16]} /><meshStandardMaterial color="#111" roughness={0.9} /></mesh>
        </group>
      ))}
      <Html position={[-4.6, 4.6, 0]} center distanceFactor={14} occlude={false}>
        <div className="mono whitespace-nowrap rounded bg-night/80 px-1.5 py-0.5 text-[11px] text-ice">{tail}</div>
      </Html>
    </group>
  );
}

function Apron({ ringProgress, ringTone, showRing }: { ringProgress: number; ringTone: string; showRing: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 80]} />
        <meshStandardMaterial color="#0b1828" roughness={0.95} />
      </mesh>
      <gridHelper args={[120, 60, "#13263d", "#0f2033"]} position={[0, 0.01, 0]} />
      {/* stand box */}
      {[[0, 4.8, 14, 0.08], [0, -4.8, 14, 0.08], [7, 0, 0.08, 9.6], [-7, 0, 0.08, 9.6]].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[w, d]} /><meshBasicMaterial color="#65D8EF" transparent opacity={0.45} /></mesh>
      ))}
      {/* lead-in line + stop bar */}
      <mesh position={[-10, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[30, 0.12]} /><meshBasicMaterial color="#F4BA65" /></mesh>
      <mesh position={[5.6, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.18, 2.4]} /><meshBasicMaterial color="#F4BA65" /></mesh>
      {/* taxiway + runway */}
      <mesh position={[0, 0.015, 16]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[120, 6]} /><meshStandardMaterial color="#0e1f33" /></mesh>
      {Array.from({ length: 24 }, (_, i) => (
        <mesh key={i} position={[-57 + i * 5, 0.03, 16]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.4, 0.15]} /><meshBasicMaterial color="#65D8EF" transparent opacity={0.6} /></mesh>
      ))}
      <mesh position={[0, 0.015, 30]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[120, 9]} /><meshStandardMaterial color="#101c2b" /></mesh>
      {Array.from({ length: 20 }, (_, i) => (
        <mesh key={`r${i}`} position={[-57 + i * 6, 0.03, 30]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3, 0.3]} /><meshBasicMaterial color="#F4F8FC" transparent opacity={0.7} /></mesh>
      ))}
      {/* terminal + jet bridge */}
      <mesh castShadow receiveShadow position={[2, 2.5, -13]}><boxGeometry args={[40, 5, 6]} /><meshStandardMaterial color="#12243a" metalness={0.3} roughness={0.6} /></mesh>
      <mesh position={[2, 3.2, -9.95]}><boxGeometry args={[40, 1.2, 0.05]} /><meshStandardMaterial color="#65D8EF" emissive="#65D8EF" emissiveIntensity={0.35} /></mesh>
      <mesh castShadow position={[3.6, 2.4, -6.2]}><boxGeometry args={[1.6, 1.6, 7.6]} /><meshStandardMaterial color="#1a3150" metalness={0.4} roughness={0.5} /></mesh>
      {/* turnaround progress ring (engine-derived progress) */}
      {showRing && (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
          <ringGeometry args={[7.6, 8.0, 96, 1, 0, Math.max(0.001, ringProgress) * Math.PI * 2]} />
          <meshBasicMaterial color={ringTone} transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

const CAMS: Record<StageKey, { pos: [number, number, number]; target: [number, number, number] }> = {
  overview: { pos: [16, 9, 16], target: [0, 1.5, 0] },
  arrival: { pos: [-22, 7, 18], target: [-10, 1, 6] },
  turnaround: { pos: [9, 13, 11], target: [0, 1, 0] },
  delay: { pos: [-6, 5, 13], target: [1, 2, 0] },
  cascade: { pos: [26, 10, 34], target: [14, 1, 16] },
  recovery: { pos: [0, 24, 22], target: [0, 1, 4] },
};
// Aircraft pose per stage: where it is on the apron (presentation only)
const POSE: Record<StageKey, { x: number; z: number; ry: number }> = {
  overview: { x: 0, z: 0, ry: 0 },
  arrival: { x: -16, z: 16, ry: -0.05 },
  turnaround: { x: 0, z: 0, ry: 0 },
  delay: { x: 0, z: 0, ry: 0 },
  cascade: { x: 16, z: 16, ry: 0 },
  recovery: { x: 0, z: 0, ry: 0 },
};

function Rig({ stage, controls, reduce, playKey }: { stage: StageKey; controls: React.RefObject<OrbitControlsImpl | null>; reduce: boolean; playKey: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const c = CAMS[stage];
    const ctl = controls.current;
    if (!ctl) return;
    if (reduce) { camera.position.set(...c.pos); ctl.target.set(...c.target); ctl.update(); return; }
    const tl = gsap.timeline();
    tl.to(camera.position, { x: c.pos[0], y: c.pos[1], z: c.pos[2], duration: 1.4, ease: "power3.inOut" }, 0);
    tl.to(ctl.target, { x: c.target[0], y: c.target[1], z: c.target[2], duration: 1.4, ease: "power3.inOut", onUpdate: () => ctl.update() }, 0);
    const kill = () => tl.kill();
    ctl.addEventListener("start", kill); // user drag interrupts the cinematic move
    return () => { ctl.removeEventListener("start", kill); tl.kill(); };
  }, [stage, camera, controls, reduce, playKey]);
  return null;
}

function Plane({ stage, cancelled, tail, tone, reduce }: { stage: StageKey; cancelled: boolean; tail: string; tone: string; reduce: boolean }) {
  const g = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!g.current) return;
    const p = cancelled ? POSE.turnaround : POSE[stage]; // a cancelled flight never leaves the stand
    if (reduce) { g.current.position.set(p.x, 0, p.z); g.current.rotation.y = p.ry; return; }
    const tw = gsap.to(g.current.position, { x: p.x, z: p.z, duration: 1.6, ease: "power2.inOut" });
    return () => { tw.kill(); };
  }, [stage, cancelled, reduce]);
  useFrame((_, dt) => { if (g.current && !reduce && stage === "overview") g.current.rotation.y += dt * 0.12; else if (g.current) g.current.rotation.y *= 0.9; });
  return <group ref={g}><Aircraft tail={tail} tone={tone} /></group>;
}

class GlBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function hasWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

/* --------------------------- Public component --------------------------- */

export default function JourneyLab3D({ net, sim, result, before, onEvidence, onMap }: {
  net: Network; sim: SimulatedFlight; result: SimulationResult; before: SimulatedFlight | null;
  onEvidence?: () => void; onMap?: () => void;
}) {
  const stages = useMemo(() => buildStages(net, sim, result, before), [net, sim, result, before]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playKey, setPlayKey] = useState(0);
  const [gl, setGl] = useState<boolean | null>(null);
  const [reduce, setReduce] = useState(false);
  const controls = useRef<OrbitControlsImpl | null>(null);
  useEffect(() => { setGl(hasWebGL()); setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches); }, []);
  useEffect(() => { setI(0); setPlaying(false); }, [sim.flight.id]);
  useEffect(() => {
    if (!playing) return;
    if (i >= stages.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setI(i + 1), 4200);
    return () => clearTimeout(t);
  }, [playing, i, stages.length]);
  const st = stages[Math.min(i, stages.length - 1)];
  const cancelled = sim.status === "cancelled";
  const ringProgress = st.key === "turnaround" || st.key === "delay" ? 1 : 0;
  const ringTone = st.key === "delay" && sim.delay ? "#F4BA65" : "#65D8EF";
  const zoom = (k: number) => { const c = controls.current; if (!c) return; const cam = c.object; cam.position.lerp(c.target, k); c.update(); };

  if (gl === false) return <div><p className="mb-2 text-xs text-amber">WebGL is unavailable in this browser — showing the 2D Journey Lab.</p><JourneyLab sim={sim} /></div>;

  return (
    <div className="relative h-full min-h-[460px] w-full overflow-hidden rounded-2xl bg-[#060d17]">
      <GlBoundary fallback={<div className="p-4"><p className="mb-2 text-xs text-amber">The 3D scene failed to start — showing the 2D Journey Lab.</p><JourneyLab sim={sim} /></div>}>
        {gl && (
          <Canvas shadows dpr={[1, 1.75]} camera={{ position: [16, 9, 16], fov: 38, near: 0.5, far: 400 }} gl={{ antialias: true, powerPreference: "high-performance" }}
            onCreated={({ scene }) => { scene.background = new THREE.Color("#060d17"); scene.fog = new THREE.Fog("#060d17", 45, 120); }}
            aria-label={`3D turnaround scene for ${sim.flight.id}`}>
            <ambientLight intensity={0.35} color="#9cc7ff" />
            <hemisphereLight args={["#65D8EF", "#08121F", 0.35]} />
            <directionalLight castShadow position={[18, 26, 10]} intensity={1.6} shadow-mapSize={[1024, 1024]} shadow-camera-left={-25} shadow-camera-right={25} shadow-camera-top={25} shadow-camera-bottom={-25} />
            <pointLight position={[0, 6, -6]} intensity={14} distance={30} color="#65D8EF" />
            <Apron ringProgress={ringProgress} ringTone={ringTone} showRing={!cancelled && (st.key === "turnaround" || st.key === "delay")} />
            <Plane stage={st.key} cancelled={cancelled} tail={sim.tail} tone={cancelled ? "#F26E73" : st.tone === "#F4F8FC" ? "#65D8EF" : st.tone} reduce={reduce} />
            <ContactShadows position={[0, 0.02, 0]} opacity={0.55} scale={40} blur={2.4} far={8} />
            <OrbitControls ref={controls} makeDefault enablePan={false} minDistance={8} maxDistance={70} maxPolarAngle={Math.PI / 2.15} />
            <Rig stage={st.key} controls={controls} reduce={reduce} playKey={playKey} />
          </Canvas>
        )}
      </GlBoundary>

      {/* HUD: data card bound to engine values */}
      <div className="pointer-events-none absolute left-4 top-4 max-w-[min(420px,calc(100%-2rem))]">
        <div className="pointer-events-auto rounded-2xl bg-night/85 p-4 backdrop-blur-sm">
          <div className="label" style={{ color: st.tone }}>{st.kicker} · {i + 1}/{stages.length}</div>
          <h3 className="mt-1 font-display text-xl font-bold leading-tight">{st.title}</h3>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-ice/85">{st.body}</p>
          {st.rows.length > 0 && (
            <dl className="mono mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[12.5px]">
              {st.rows.flatMap(([k, v]) => [<dt key={`k${k}`} className="font-sans text-mute">{k}</dt>, <dd key={`v${k}`}>{v}</dd>])}
            </dl>
          )}
        </div>
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl bg-night/85 p-1.5 backdrop-blur-sm">
        <button className="btn" onClick={() => { setPlaying(false); setI(Math.max(0, i - 1)); }} aria-label="Previous stage"><ChevronLeft size={14} /></button>
        <button className="btn btn-primary" onClick={() => { if (i >= stages.length - 1) setI(0); setPlaying(!playing); }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? "Pause" : "Walkthrough"}</button>
        <button className="btn" onClick={() => { setPlaying(false); setI(Math.min(stages.length - 1, i + 1)); }} aria-label="Next stage"><ChevronRight size={14} /></button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button className="btn" onClick={() => zoom(0.15)} aria-label="Zoom in"><Plus size={14} /></button>
        <button className="btn" onClick={() => zoom(-0.15)} aria-label="Zoom out"><Minus size={14} /></button>
        <button className="btn" onClick={() => setPlayKey(playKey + 1)} aria-label="Reset camera"><RotateCcw size={14} /></button>
        {onEvidence && <button className="btn" onClick={onEvidence}><ScrollText size={14} />Evidence</button>}
        {onMap && <button className="btn" onClick={onMap}><MapIcon size={14} />2D map</button>}
      </div>
      <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-1">
        {stages.map((s, k) => <span key={s.key} className={`h-1.5 rounded-full transition-all ${k === i ? "w-8" : "w-3"}`} style={{ background: k <= i ? s.tone : "#1c3350" }} />)}
      </div>
      <p className="pointer-events-none absolute bottom-3 right-4 hidden text-[11px] text-mute lg:block">Drag to orbit · scroll to zoom · scene positions are illustrative; times are engine values</p>
    </div>
  );
}
