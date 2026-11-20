"use client";
import { create } from "zustand";
import type { Strategy } from "@/engine/recovery";

export type RightTab = "brief" | "recovery" | "ledger" | "flights";
export type Mode = "control" | "investigate" | "recover";
export type StageView = "network" | "aircraft3d" | "evidence";

interface UiState {
  airport: string;
  start: number;
  duration: number;
  scenarioKey: number; // bumps on "Simulate Disruption"
  committed: { airport: string; start: number; end: number };
  strategy: Strategy;
  appliedId: string | null;
  view: "before" | "after";
  selectedFlight: string | null;
  selectedEvent: string | null;
  time: number;
  playing: boolean;
  speed: number;
  tab: RightTab;
  mode: Mode;
  stageView: StageView;
  scenarioOpen: boolean;
  briefOpen: boolean;
  storyOpen: boolean;
  storyIndex: number;
  introOpen: boolean;
  guide: boolean;
  helpOpen: boolean;
  set: (p: Partial<UiState>) => void;
  simulate: () => void;
  reset: () => void;
}

const DEFAULT = { airport: "BOM", start: 8 * 60, duration: 90 };

export const useUi = create<UiState>((set, get) => ({
  ...DEFAULT,
  scenarioKey: 1,
  committed: { airport: DEFAULT.airport, start: DEFAULT.start, end: DEFAULT.start + DEFAULT.duration },
  strategy: "protect_passengers",
  appliedId: null,
  view: "before",
  selectedFlight: null,
  selectedEvent: null,
  time: DEFAULT.start,
  playing: false,
  speed: 4,
  tab: "brief",
  mode: "control",
  stageView: "network",
  scenarioOpen: false,
  briefOpen: true,
  storyOpen: false,
  storyIndex: 0,
  introOpen: false,
  guide: false,
  helpOpen: false,
  set: (p) => set(p),
  simulate: () => {
    const { airport, start, duration, scenarioKey } = get();
    set({
      committed: { airport, start, end: start + duration }, scenarioKey: scenarioKey + 1, appliedId: null, view: "before",
      selectedFlight: null, selectedEvent: null, time: start, playing: false, tab: "brief", mode: "control", briefOpen: true,
    });
  },
  reset: () => set({
    ...DEFAULT, committed: { airport: DEFAULT.airport, start: DEFAULT.start, end: DEFAULT.start + DEFAULT.duration },
    appliedId: null, view: "before", selectedFlight: null, selectedEvent: null, time: DEFAULT.start, playing: false,
    strategy: "protect_passengers", storyOpen: false, storyIndex: 0, mode: "control", stageView: "network", tab: "brief", briefOpen: true, scenarioOpen: false,
  }),
}));
