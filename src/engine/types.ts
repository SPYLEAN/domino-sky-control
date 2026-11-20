// Domain types for the Domino Sky deterministic engine.
// All times are integer minutes from 00:00 IST of the operating day (may exceed 1440 = next day).

export type Tier = "mega_hub" | "regional_hub" | "spoke";

export interface Airport {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  tier: Tier;
  capacityPerHour: number;
}

export interface Flight {
  id: string;
  tail: string;
  legOrder: number;
  origin: string;
  destination: string;
  dep: number; // scheduled departure
  arr: number; // scheduled arrival
  block: number;
  pax: number;
}

export interface Connection {
  id: string;
  airport: string;
  fromFlight: string;
  toFlight: string;
  passengers: number;
  minConnect: number;
}

export interface Crew {
  id: string;
  tail: string;
  base: string;
  dutyStart: number;
  maxDuty: number;
  flightIds: string[];
}

export interface Aircraft {
  tail: string;
  isSpare: boolean;
  base: string; // physical start location
  availableFrom: number;
  seats: number;
}

export interface Network {
  minTurnaround: number;
  seats: number;
  airports: Airport[];
  airportById: Record<string, Airport>;
  flights: Flight[];
  flightById: Record<string, Flight>;
  connections: Connection[];
  crews: Crew[];
  crewById: Record<string, Crew>;
  crewByFlight: Record<string, string>;
  aircraft: Aircraft[];
  aircraftByTail: Record<string, Aircraft>;
}

export interface DisruptionScenario {
  airport: string;
  start: number; // closure start (inclusive)
  end: number; // closure end (exclusive) — airport reopens at `end`
}

export type RecoveryAction =
  | { kind: "cancel"; flightIds: string[]; label: "round_trip" | "truncate" }
  | {
      kind: "spare";
      spareTail: string;
      originalTail: string;
      flightIds: string[]; // consecutive legs moved onto the spare
      crewId: string; // crew operating those legs on the spare
      form: "takeover" | "round_trip_cover";
    }
  | { kind: "hold"; flightIds: [string]; connectionId: string; holdUntil: number };

export type FlightStatus = "on_time" | "delayed" | "cancelled";

export type BindingConstraint =
  | "schedule"
  | "aircraft_rotation"
  | "crew_connection"
  | "spare_availability"
  | "connection_hold"
  | "closure_departure"
  | "closure_arrival_hold";

export type CancelReason =
  | "dispatcher_cancellation"
  | "aircraft_out_of_position"
  | "crew_out_of_position"
  | "crew_duty_limit";

export interface CauseEvidence {
  scheduledDep: number;
  aircraftReady: { value: number; prevFlight: string | null; prevArr: number | null; turnaround: number; source: "previous_leg" | "first_leg" | "spare_available_from" };
  crewReady: { value: number; prevFlight: string | null; prevArr: number | null; turnaround: number; crewId: string };
  earliestBeforeClosure: number;
  closureDepartureShift: { applied: boolean; from: number; to: number } | null;
  closureArrivalHold: { applied: boolean; projectedArr: number; heldDep: number } | null;
  binding: BindingConstraint;
  bindingFlight: string | null; // upstream flight responsible (if any)
  crewDuty: { crewId: string; dutyStart: number; dutyEnd: number; dutyMins: number; maxDuty: number; legal: boolean } | null;
  formulas: string[];
}

export interface SimulatedFlight {
  flight: Flight;
  tail: string; // tail actually used (may be a spare)
  crewId: string;
  status: FlightStatus;
  actualDep: number | null;
  actualArr: number | null;
  delay: number; // minutes (0 if cancelled)
  cancelReason: CancelReason | null;
  cancelCauseFlight: string | null;
  evidence: CauseEvidence | null; // null if cancelled before timing was computed
  rootEventId: string | null;
  eventIds: string[];
}

export type ConnectionStatus = "made" | "missed" | "broken_inbound_cancelled" | "broken_outbound_cancelled";

export interface ConnectionOutcome {
  connection: Connection;
  status: ConnectionStatus;
  inboundArr: number | null;
  outboundDep: number | null;
  slack: number | null; // outboundDep - (inboundArr + minConnect)
  baselineSlack: number;
}

export type EventType =
  | "closure_start"
  | "closure_end"
  | "closure_constraint"
  | "flight_rescheduled"
  | "rotation_propagation"
  | "crew_infeasible"
  | "flight_cancelled"
  | "connection_missed"
  | "connection_at_risk"
  | "recovery_assignment"
  | "recovery_evaluation";

export interface SimulationEvent {
  id: string;
  seq: number; // engine calculation sequence (stable)
  type: EventType;
  time: number; // simulated operational time
  airport: string | null;
  flightId: string | null;
  tail: string | null;
  crewId: string | null;
  connectionId: string | null;
  prevState: string;
  newState: string;
  parentId: string | null;
  rule: string;
  explanation: string;
  values: Record<string, string | number | boolean | null>;
}

export interface Kpis {
  flightsAffected: number;
  delayedFlights: number;
  cancelledFlights: number;
  cancelledPax: number;
  missedConnectionPax: number;
  missedConnectionGroups: number;
  timingMissedConnectionPax: number;
  delayedPax: number;
  paxDelayMinutes: number;
  totalFlightDelay: number;
  maxDelay: number;
  crewDutyAlerts: number; // flights not operated because the crew would exceed duty
  crewsNearLimit: number; // operating crews ending within 30 min of limit
  strandedProxy: number;
  airportsImpacted: number;
  capacityExceedances: number;
  interventions: number;
}

export interface CapacityRecord {
  airport: string;
  hour: number;
  movements: number;
  capacity: number;
}

export interface CrewDutyRecord {
  crewId: string;
  dutyStart: number;
  dutyEnd: number | null;
  dutyMins: number;
  maxDuty: number;
  legal: boolean;
  flightsCancelledForDuty: string[];
}

export interface SimulationResult {
  scenario: DisruptionScenario | null;
  actions: RecoveryAction[];
  flights: SimulatedFlight[];
  flightById: Record<string, SimulatedFlight>;
  connections: ConnectionOutcome[];
  crewDuty: CrewDutyRecord[];
  capacity: CapacityRecord[];
  events: SimulationEvent[];
  kpis: Kpis;
  violations: string[]; // invariant violations (should be empty)
}
