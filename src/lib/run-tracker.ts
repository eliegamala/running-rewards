/**
 * Run tracking state shared between the RUN screen and the background location task.
 *
 * The background task can fire while the screen is locked, outside the React lifecycle,
 * so run data lives here in a module-level store instead of component state. The UI reads
 * it with `useSyncExternalStore(subscribe, getSnapshot)`.
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

export type RunSnapshot = {
  isActive: boolean;
  startTime: number | null;
  endTime: number | null;
  distanceMeters: number;
  lastPoint: TrackPoint | null;
};

let snapshot: RunSnapshot = {
  isActive: false,
  startTime: null,
  endTime: null,
  distanceMeters: 0,
  lastPoint: null,
};
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
  if (!snapshot.isActive || snapshot.startTime === null) return;

  let { distanceMeters, lastPoint } = snapshot;

  for (const location of locations) {
    const { latitude, longitude, accuracy } = location.coords;

    // Skip imprecise fixes and cached fixes from before the run started.
    if (accuracy == null || accuracy > MAX_ACCURACY_M) continue;
    if (location.timestamp < snapshot.startTime) continue;

    const point = { latitude, longitude, timestamp: location.timestamp };
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

  if (distanceMeters !== snapshot.distanceMeters || lastPoint !== snapshot.lastPoint) {
    update({ distanceMeters, lastPoint });
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

/**
 * Starts a new run. Requires foreground location permission to already be granted.
 * Uses background location updates when available so tracking survives a screen lock,
 * otherwise falls back to the foreground-only watcher.
 */
export async function startRun() {
  // Clear anything left over so a new run never double-counts.
  await stopRun();

  update({
    isActive: true,
    startTime: Date.now(),
    endTime: null,
    distanceMeters: 0,
    lastPoint: null,
  });

  try {
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
  } catch (error) {
    await stopRun();
    throw error;
  }
}

/** Stops all location updates and freezes the final stats. */
export async function stopRun() {
  foregroundSubscription?.remove();
  foregroundSubscription = null;

  if (snapshot.isActive) {
    update({ isActive: false, endTime: Date.now() });
  }

  await stopBackgroundUpdates();
}

/**
 * Stops background updates left running by a previous JS session (e.g. after a reload),
 * since their run data is gone and nothing would ever stop them.
 */
export async function stopOrphanedTracking() {
  if (!snapshot.isActive) await stopBackgroundUpdates();
}
