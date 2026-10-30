/**
 * Run tracking state shared between the RUN screen and the background location task.
 *
 * The background task can fire while the screen is locked, outside the React lifecycle,
 * so run data lives here in a module-level store instead of component state. The UI reads
 * it with `useSyncExternalStore(subscribe, getSnapshot)`.
 *
 * Run states: ready (`!isActive`), running (`isActive && !isPaused`), paused
 * (`isActive && isPaused`), and finished (`!isActive` with an `endTime`).
 * While paused, GPS is switched off and no distance or time is counted.
 *
 * Every fix that's measured is also kept in the run's route, in the order it was processed,
 * so the server can re-measure the run with the same rules (claim_gps_reward in
 * supabase/migrations/20261030120000_gps_route_check.sql). Keep the two in step.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const RUN_LOCATION_TASK = 'run-location-updates';

// GPS noise filtering
const MAX_ACCURACY_M = 25; // ignore fixes less precise than this
const MIN_SEGMENT_M = 3; // ignore tiny movements caused by GPS jitter while standing still
const MAX_SPEED_MPS = 10; // ~36 km/h; anything faster is a GPS jump, not running

type TrackPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
};

/** A measured fix, as sent to the server. */
export type RoutePoint = TrackPoint & {
  /** Position in the route, from 0. */
  seq: number;
  /** Starts at 0 and goes up on every resume; distance is never counted across segments. */
  segment: number;
  accuracy: number;
  /** Android reports the fix came from a mock-location app. */
  mocked: boolean;
};

export type RunSnapshot = {
  /** True from start until stop, including while paused. */
  isActive: boolean;
  isPaused: boolean;
  startTime: number | null;
  endTime: number | null;
  /** When the current pause began. */
  pausedAt: number | null;
  /** Total time spent paused in completed pauses. */
  pausedMs: number;
  /** GPS fixes from before this moment are ignored (run start or latest resume). */
  trackingSince: number | null;
  distanceMeters: number;
  lastPoint: TrackPoint | null;
  /** A mock-location app was detected; this run can't earn a reward. */
  mockedLocation: boolean;
};

let snapshot: RunSnapshot = {
  isActive: false,
  isPaused: false,
  startTime: null,
  endTime: null,
  pausedAt: null,
  pausedMs: 0,
  trackingSince: null,
  distanceMeters: 0,
  lastPoint: null,
  mockedLocation: false,
};
// Kept outside the snapshot so adding a point doesn't copy the whole route.
let route: RoutePoint[] = [];
let segment = 0;
const listeners = new Set<() => void>();
let foregroundSubscription: Location.LocationSubscription | null = null;

function update(patch: Partial<RunSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot() {
  return snapshot;
}

/** The current (or last) run's measured fixes, oldest first. */
export function getRoute(): readonly RoutePoint[] {
  return route;
}

/** Running time so far, excluding pauses. Frozen while paused and after the run ends. */
export function getActiveElapsedMs(run: RunSnapshot, now: number) {
  if (run.startTime === null) return 0;
  const end = run.endTime ?? (run.isPaused && run.pausedAt !== null ? run.pausedAt : now);
  return Math.max(0, end - run.startTime - run.pausedMs);
}

// Haversine distance between two coordinates, in metres.
function distanceBetween(a: TrackPoint, b: TrackPoint) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Single entry point for GPS fixes, whether they come from the foreground watcher
// or from the background task (which can deliver several fixes at once).
function addLocations(locations: Location.LocationObject[]) {
  if (!snapshot.isActive || snapshot.isPaused || snapshot.trackingSince === null) return;

  let { distanceMeters, lastPoint, mockedLocation } = snapshot;

  for (const location of locations) {
    const { latitude, longitude, accuracy } = location.coords;

    // Skip imprecise fixes, and cached or late fixes from before the run started or resumed.
    if (accuracy == null || accuracy > MAX_ACCURACY_M) continue;
    if (location.timestamp < snapshot.trackingSince) continue;

    const point = { latitude, longitude, timestamp: location.timestamp };
    const mocked = location.mocked === true;
    route.push({ ...point, seq: route.length, segment, accuracy, mocked });
    if (mocked) {
      mockedLocation = true;
      continue;
    }
    if (!lastPoint) {
      lastPoint = point;
      continue;
    }

    const seconds = (point.timestamp - lastPoint.timestamp) / 1000;
    if (seconds <= 0) continue;

    const meters = distanceBetween(lastPoint, point);
    // Keep the last point on jitter so small real movements still add up.
    if (meters < MIN_SEGMENT_M) continue;
    if (meters / seconds > MAX_SPEED_MPS) continue;

    distanceMeters += meters;
    lastPoint = point;
  }

  if (
    distanceMeters !== snapshot.distanceMeters ||
    lastPoint !== snapshot.lastPoint ||
    mockedLocation !== snapshot.mockedLocation
  ) {
    update({ distanceMeters, lastPoint, mockedLocation });
  }
}

// Must be defined at module scope so iOS can deliver updates while the screen is locked.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  RUN_LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    addLocations(data.locations);
  },
);

// Background updates need a development build (Expo Go can't run them) with the
// `location` background mode enabled in app.json.
async function canTrackInBackground() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false;
  try {
    return await Location.isBackgroundLocationAvailableAsync();
  } catch {
    return false;
  }
}

async function stopBackgroundUpdates() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(RUN_LOCATION_TASK);
    }
  } catch {
    // Task was never registered (e.g. Expo Go); nothing to stop.
  }
}

function stopForegroundWatcher() {
  foregroundSubscription?.remove();
  foregroundSubscription = null;
}

/**
 * Switches GPS on. Uses background location updates when available so tracking survives a
 * screen lock, otherwise the foreground-only watcher. Always clears any existing
 * subscription first, so there is never more than one source of fixes.
 */
async function startLocationTracking() {
  stopForegroundWatcher();
  await stopBackgroundUpdates();

  if (await canTrackInBackground()) {
    try {
      // On iOS a run started from the app only needs "While Using" permission;
      // the blue status-bar indicator shows while it continues in the background.
      await Location.startLocationUpdatesAsync(RUN_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        distanceInterval: 5,
        activityType: Location.ActivityType.Fitness,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
      });
      return;
    } catch {
      // Fall through to the foreground watcher.
    }
  }

  foregroundSubscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: MIN_SEGMENT_M },
    (location) => addLocations([location]),
  );
}

/**
 * Starts a new run. Requires foreground location permission to already be granted.
 */
export async function startRun() {
  // Clear anything left over so a new run never double-counts.
  await stopRun();

  const now = Date.now();
  route = [];
  segment = 0;
  update({
    isActive: true,
    isPaused: false,
    startTime: now,
    endTime: null,
    pausedAt: null,
    pausedMs: 0,
    trackingSince: now,
    distanceMeters: 0,
    lastPoint: null,
    mockedLocation: false,
  });

  try {
    await startLocationTracking();
  } catch (error) {
    await stopRun();
    throw error;
  }
}

/** Pauses an active run: GPS off, distance and time frozen. */
export async function pauseRun() {
  if (!snapshot.isActive || snapshot.isPaused) return;
  // Mark paused first so any fix already in flight is ignored.
  update({ isPaused: true, pausedAt: Date.now(), lastPoint: null });
  stopForegroundWatcher();
  await stopBackgroundUpdates();
}

/**
 * Resumes a paused run from the same distance and time. The paused period isn't counted,
 * and the first fix after resuming starts a fresh segment, so moving while paused never
 * adds distance.
 */
export async function resumeRun() {
  if (!snapshot.isActive || !snapshot.isPaused || snapshot.pausedAt === null) return;
  const now = Date.now();
  segment += 1;
  update({
    isPaused: false,
    pausedAt: null,
    pausedMs: snapshot.pausedMs + (now - snapshot.pausedAt),
    trackingSince: now,
    lastPoint: null,
  });

  try {
    await startLocationTracking();
  } catch (error) {
    // Couldn't restart GPS (e.g. permission revoked): stay paused rather than counting time.
    update({ isPaused: true, pausedAt: Date.now() });
    throw error;
  }
}

/** Finishes the run: stops all location updates and freezes the final stats. */
export async function stopRun() {
  stopForegroundWatcher();

  if (snapshot.isActive) {
    const now = Date.now();
    // Stopping while paused: the current pause doesn't count as running time.
    const pausedMs =
      snapshot.isPaused && snapshot.pausedAt !== null
        ? snapshot.pausedMs + (now - snapshot.pausedAt)
        : snapshot.pausedMs;
    update({ isActive: false, isPaused: false, pausedAt: null, pausedMs, endTime: now });
  }

  await stopBackgroundUpdates();
}

/**
 * Stops background updates left running by a previous JS session (e.g. after a reload),
 * since their run data is gone and nothing would ever stop them.
 */
export async function stopOrphanedTracking() {
  if (!snapshot.isActive || snapshot.isPaused) await stopBackgroundUpdates();
}

/**
 * TEMPORARY, DEV ONLY: adds distance to the active run so the reward flow can be
 * tested without running. Remove before release.
 *
 * The server re-measures the route and rejects 5 km+ faster than a human can run, so this
 * moves the whole run back in time and fills the gap with fixes heading north at 5 m/s,
 * fed through the same filtering as real GPS. The reward then unlocks instantly. Real GPS
 * carries on in a new segment, as after a pause, so the jump back isn't counted.
 */
export function simulateDistanceForTesting(meters: number) {
  // Only running distance counts, so this does nothing while paused.
  if (!__DEV__ || !snapshot.isActive || snapshot.isPaused || snapshot.startTime === null) return;
  const STEP_M = 10;
  const STEP_MS = 2000;
  const steps = Math.ceil(meters / STEP_M);
  const shiftMs = steps * STEP_MS + 1000;

  route = route.map((p) => ({ ...p, timestamp: p.timestamp - shiftMs }));
  // Continue from the last fix, already in the route; with no fix yet (e.g. a simulator),
  // start a fresh segment in Cape Town.
  const hadFix = snapshot.lastPoint !== null;
  const from = snapshot.lastPoint ?? { latitude: -33.9249, longitude: 18.4241, timestamp: Date.now() };
  const anchor = { ...from, timestamp: from.timestamp - shiftMs };
  update({
    startTime: snapshot.startTime - shiftMs,
    trackingSince: Math.min(snapshot.trackingSince ?? anchor.timestamp, anchor.timestamp),
    lastPoint: hadFix ? anchor : null,
  });

  const degreesPerStep = STEP_M / 111195; // metres per degree of latitude
  const fixes: Location.LocationObject[] = [];
  for (let i = hadFix ? 1 : 0; i <= steps; i++) {
    fixes.push({
      timestamp: anchor.timestamp + i * STEP_MS,
      mocked: false,
      coords: {
        latitude: anchor.latitude + i * degreesPerStep,
        longitude: anchor.longitude,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    });
  }
  addLocations(fixes);

  segment += 1;
  update({ lastPoint: null });
}
