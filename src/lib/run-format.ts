const MIN_PACE_DISTANCE_KM = 0.05; // pace is meaningless over the first few metres

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

export function formatPace(elapsedSeconds: number, distanceKm: number) {
  if (distanceKm < MIN_PACE_DISTANCE_KM) return '--:--';
  const secondsPerKm = Math.round(elapsedSeconds / distanceKm);
  if (secondsPerKm >= 100 * 60) return '--:--';
  return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')}`;
}
