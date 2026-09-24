import type { AdventureMap, MapSpaceId } from '$lib/map/types';

export interface MapAnalysisSpace {
  id: MapSpaceId;
  /** Stable within the authored map and matches the map editor's Numbers overlay. */
  number: number;
  label: string;
}

export interface MapTopologyAnalysis {
  mapId: AdventureMap['id'];
  mapName: string;
  spaceCount: number;
  pathCount: number;
  oneWayPathCount: number;
  /** Weak components: arrow direction is ignored when finding disconnected islands. */
  componentCount: number;
  isolatedSpaces: MapAnalysisSpace[];
  deadEndSpaces: MapAnalysisSpace[];
  bottleneckSpaces: MapAnalysisSpace[];
  /** Every space can be reached from every other while obeying one-way arrows. */
  mutuallyReachable: boolean;
  /** Longest shortest movement route; unavailable when directional travel is incomplete. */
  travelDiameter: number | null;
  /** Least movement needed before a melee attack can target any other space. */
  meleeAttackRadius: number | null;
  meleeAttackCentres: MapAnalysisSpace[];
  /** Least movement needed before a ranged attack can target any other space. */
  rangedAttackRadius: number | null;
  rangedAttackCentres: MapAnalysisSpace[];
}

type Adjacency = Map<MapSpaceId, Set<MapSpaceId>>;

function graphFor(map: AdventureMap): { movement: Adjacency; adjacency: Adjacency } {
  const ids = new Set(map.spaces.map((space) => space.id));
  const movement: Adjacency = new Map();
  const adjacency: Adjacency = new Map();
  for (const id of ids) {
    movement.set(id, new Set());
    adjacency.set(id, new Set());
  }

  for (const path of map.paths) {
    if (!ids.has(path.from) || !ids.has(path.to) || path.from === path.to) continue;
    movement.get(path.from)?.add(path.to);
    if (!path.oneWay) movement.get(path.to)?.add(path.from);
    /* One-way paths still make their endpoints adjacent for attacks. */
    adjacency.get(path.from)?.add(path.to);
    adjacency.get(path.to)?.add(path.from);
  }
  return { movement, adjacency };
}

function distancesFrom(graph: Adjacency, start: MapSpaceId): Map<MapSpaceId, number> {
  const distances = new Map<MapSpaceId, number>([[start, 0]]);
  const queue: MapSpaceId[] = [start];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (!current) continue;
    const distance = distances.get(current) ?? 0;
    for (const next of graph.get(current) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, distance + 1);
      queue.push(next);
    }
  }
  return distances;
}

function componentCount(graph: Adjacency): number {
  const unseen = new Set(graph.keys());
  let count = 0;
  while (unseen.size > 0) {
    const start = unseen.values().next().value as MapSpaceId | undefined;
    if (!start) break;
    count += 1;
    for (const id of distancesFrom(graph, start).keys()) unseen.delete(id);
  }
  return count;
}

/**
 * Articulation points in the underlying undirected board.
 *
 * They are structural bottlenecks rather than a claim about balance: removing
 * one increases the number of connected regions, regardless of which way an
 * orange arrow happens to point along one of its incident paths.
 */
function articulationPoints(graph: Adjacency): Set<MapSpaceId> {
  const discovered = new Map<MapSpaceId, number>();
  const low = new Map<MapSpaceId, number>();
  const parent = new Map<MapSpaceId, MapSpaceId>();
  const result = new Set<MapSpaceId>();
  let time = 0;

  const visit = (id: MapSpaceId): void => {
    time += 1;
    discovered.set(id, time);
    low.set(id, time);
    let children = 0;

    for (const next of graph.get(id) ?? []) {
      if (!discovered.has(next)) {
        children += 1;
        parent.set(next, id);
        visit(next);
        low.set(id, Math.min(low.get(id) ?? time, low.get(next) ?? time));
        if (!parent.has(id) && children > 1) result.add(id);
        if (parent.has(id) && (low.get(next) ?? time) >= (discovered.get(id) ?? time)) {
          result.add(id);
        }
      } else if (parent.get(id) !== next) {
        low.set(id, Math.min(low.get(id) ?? time, discovered.get(next) ?? time));
      }
    }
  };

  for (const id of graph.keys()) if (!discovered.has(id)) visit(id);
  return result;
}

function attackDistance(
  target: MapSpaceId,
  movementDistances: Map<MapSpaceId, number>,
  attackPositions: Adjacency
): number | null {
  let best = Number.POSITIVE_INFINITY;
  for (const position of attackPositions.get(target) ?? []) {
    const distance = movementDistances.get(position);
    if (distance !== undefined) best = Math.min(best, distance);
  }
  return Number.isFinite(best) ? best : null;
}

function attackCentres(
  movement: Adjacency,
  movementDistances: Map<MapSpaceId, Map<MapSpaceId, number>>,
  attackPositions: Adjacency,
  ordered: (ids: Iterable<MapSpaceId>) => MapAnalysisSpace[]
): { radius: number | null; centres: MapAnalysisSpace[] } {
  const scores = new Map<MapSpaceId, number>();
  for (const source of movement.keys()) {
    const distances = movementDistances.get(source) ?? new Map();
    let farthest = 0;
    let complete = true;
    for (const target of movement.keys()) {
      if (target === source) continue;
      const distance = attackDistance(target, distances, attackPositions);
      if (distance === null) {
        complete = false;
        break;
      }
      farthest = Math.max(farthest, distance);
    }
    if (complete) scores.set(source, farthest);
  }

  const radius = scores.size > 0 ? Math.min(...scores.values()) : null;
  return {
    radius,
    centres:
      radius === null
        ? []
        : ordered(
            [...scores.entries()]
              .filter(([, score]) => score === radius)
              .map(([id]) => id)
          )
  };
}

export function analyseMap(map: AdventureMap): MapTopologyAnalysis {
  const { movement, adjacency } = graphFor(map);
  const spaces = new Map<MapSpaceId, MapAnalysisSpace>(
    map.spaces.map((space, index) => [
      space.id,
      {
        id: space.id,
        number: index + 1,
        label: space.label.trim()
      }
    ])
  );
  const ordered = (ids: Iterable<MapSpaceId>): MapAnalysisSpace[] =>
    [...ids]
      .map((id) => spaces.get(id))
      .filter((space): space is MapAnalysisSpace => space !== undefined)
      .sort((left, right) => left.number - right.number);

  const movementDistances = new Map<MapSpaceId, Map<MapSpaceId, number>>();
  for (const id of movement.keys()) movementDistances.set(id, distancesFrom(movement, id));

  const zoneKeys = new Map(
    map.spaces.map((space) => [
      space.id,
      new Set(space.zones.map((zone) => zone.color.toLowerCase()))
    ])
  );
  const rangedPositions: Adjacency = new Map();
  for (const target of movement.keys()) {
    const targetZones = zoneKeys.get(target) ?? new Set<string>();
    const positions = new Set(adjacency.get(target) ?? []);
    for (const candidate of movement.keys()) {
      if (candidate === target) continue;
      const candidateZones = zoneKeys.get(candidate) ?? new Set<string>();
      if ([...candidateZones].some((zone) => targetZones.has(zone))) positions.add(candidate);
    }
    rangedPositions.set(target, positions);
  }

  const melee = attackCentres(movement, movementDistances, adjacency, ordered);
  const ranged = attackCentres(movement, movementDistances, rangedPositions, ordered);

  const mutuallyReachable = [...movementDistances.values()].every(
    (distances) => distances.size === movement.size
  );
  const travelDiameter = mutuallyReachable
    ? Math.max(0, ...[...movementDistances.values()].flatMap((distances) => [...distances.values()]))
    : null;
  const isolated = [...adjacency.entries()]
    .filter(([, neighbours]) => neighbours.size === 0)
    .map(([id]) => id);
  const deadEnds = [...adjacency.entries()]
    .filter(([, neighbours]) => neighbours.size === 1)
    .map(([id]) => id);

  return {
    mapId: map.id,
    mapName: map.name.trim(),
    spaceCount: map.spaces.length,
    pathCount: map.paths.length,
    oneWayPathCount: map.paths.filter((path) => path.oneWay).length,
    componentCount: componentCount(adjacency),
    isolatedSpaces: ordered(isolated),
    deadEndSpaces: ordered(deadEnds),
    bottleneckSpaces: ordered(articulationPoints(adjacency)),
    mutuallyReachable,
    travelDiameter,
    meleeAttackRadius: melee.radius,
    meleeAttackCentres: melee.centres,
    rangedAttackRadius: ranged.radius,
    rangedAttackCentres: ranged.centres
  };
}
