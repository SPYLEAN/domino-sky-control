import { z } from "zod";
import raw from "../data/flight_network.json";
import { parseHHMM } from "./time";
import type { Aircraft, Network } from "./types";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

export const DatasetSchema = z.object({
  meta: z.object({
    dataset: z.string(),
    min_turnaround_minutes: z.number().int().positive(),
    seats_per_aircraft: z.number().int().positive(),
  }).passthrough(),
  airports: z.array(z.object({
    id: z.string().length(3), name: z.string(), city: z.string(),
    lat: z.number(), lng: z.number(),
    tier: z.enum(["mega_hub", "regional_hub", "spoke"]),
    capacity_per_hour: z.number().int().positive(),
  })),
  flights: z.array(z.object({
    flight_id: z.string(), tail_id: z.string(), leg_order: z.number().int().positive(),
    origin: z.string(), destination: z.string(), dep: hhmm, arr: hhmm,
    block_minutes: z.number().int().positive(), pax: z.number().int().nonnegative(),
    turnaround_before_min: z.number().nullable(),
  })),
  connections: z.array(z.object({
    connection_id: z.string(), airport: z.string(), from_flight: z.string(), to_flight: z.string(),
    passengers: z.number().int().nonnegative(), min_connect_minutes: z.number().int().nonnegative(),
  })),
  crews: z.array(z.object({
    crew_id: z.string(), tail_id: z.string(), base: z.string(), duty_start: hhmm,
    max_duty_mins: z.number().int().positive(), flight_ids: z.array(z.string()),
  })),
  spare_aircraft: z.array(z.object({
    tail_id: z.string(), base: z.string(), available_from: hhmm, seats: z.number().int().positive(),
  })),
});

export type Dataset = z.infer<typeof DatasetSchema>;

/** Parses and validates the dataset, checking referential integrity. Never mutates the input. */
export function buildNetwork(input: unknown): Network {
  const d = DatasetSchema.parse(input);
  const errors: string[] = [];
  const airportIds = new Set(d.airports.map((a) => a.id));

  const flights = d.flights.map((f) => ({
    id: f.flight_id, tail: f.tail_id, legOrder: f.leg_order, origin: f.origin,
    destination: f.destination, dep: parseHHMM(f.dep), arr: parseHHMM(f.arr),
    block: f.block_minutes, pax: f.pax,
  }));
  const flightById = Object.fromEntries(flights.map((f) => [f.id, f]));
  for (const f of flights) {
    if (!airportIds.has(f.origin)) errors.push(`${f.id}: unknown origin ${f.origin}`);
    if (!airportIds.has(f.destination)) errors.push(`${f.id}: unknown destination ${f.destination}`);
    if (f.dep + f.block !== f.arr) errors.push(`${f.id}: dep + block != arr`);
    if (f.pax > d.meta.seats_per_aircraft) errors.push(`${f.id}: pax exceeds seats`);
  }
  const connections = d.connections.map((c) => ({
    id: c.connection_id, airport: c.airport, fromFlight: c.from_flight, toFlight: c.to_flight,
    passengers: c.passengers, minConnect: c.min_connect_minutes,
  }));
  for (const c of connections) {
    const a = flightById[c.fromFlight], b = flightById[c.toFlight];
    if (!a || !b) { errors.push(`${c.id}: unknown flight`); continue; }
    if (a.destination !== c.airport || b.origin !== c.airport) errors.push(`${c.id}: airport mismatch`);
  }
  const crews = d.crews.map((c) => ({
    id: c.crew_id, tail: c.tail_id, base: c.base, dutyStart: parseHHMM(c.duty_start),
    maxDuty: c.max_duty_mins, flightIds: [...c.flight_ids],
  }));
  const crewByFlight: Record<string, string> = {};
  for (const c of crews) {
    for (const fid of c.flightIds) {
      if (!flightById[fid]) errors.push(`${c.id}: unknown flight ${fid}`);
      if (crewByFlight[fid]) errors.push(`${fid}: assigned to two crews`);
      crewByFlight[fid] = c.id;
    }
  }
  for (const f of flights) if (!crewByFlight[f.id]) errors.push(`${f.id}: no crew`);

  const tails = [...new Set(flights.map((f) => f.tail))].sort();
  const aircraft: Aircraft[] = tails.map((tail) => {
    const first = flights.filter((f) => f.tail === tail).sort((a, b) => a.legOrder - b.legOrder)[0];
    return { tail, isSpare: false, base: first.origin, availableFrom: 0, seats: d.meta.seats_per_aircraft };
  });
  for (const s of d.spare_aircraft) {
    if (!airportIds.has(s.base)) errors.push(`${s.tail_id}: unknown base`);
    aircraft.push({ tail: s.tail_id, isSpare: true, base: s.base, availableFrom: parseHHMM(s.available_from), seats: s.seats });
  }
  if (errors.length) throw new Error(`Dataset integrity errors:\n${errors.join("\n")}`);

  const airports = d.airports.map((a) => ({
    id: a.id, name: a.name, city: a.city, lat: a.lat, lng: a.lng, tier: a.tier, capacityPerHour: a.capacity_per_hour,
  }));
  return {
    minTurnaround: d.meta.min_turnaround_minutes,
    seats: d.meta.seats_per_aircraft,
    airports,
    airportById: Object.fromEntries(airports.map((a) => [a.id, a])),
    flights,
    flightById,
    connections,
    crews,
    crewById: Object.fromEntries(crews.map((c) => [c.id, c])),
    crewByFlight,
    aircraft,
    aircraftByTail: Object.fromEntries(aircraft.map((a) => [a.tail, a])),
  };
}

export const RAW_DATASET = raw as unknown;
let cached: Network | null = null;
export function getNetwork(): Network {
  if (!cached) cached = buildNetwork(RAW_DATASET);
  return cached;
}
