export const isBetaRelease = import.meta.env?.VITE_RELEASE_CHANNEL === "beta";

// Pages paths share an origin, including its IndexedDB databases. Keep beta
// history, caches, and battery saves separate from the established main app.
export function browserDatabaseName(name: string): string {
  return isBetaRelease ? `${name}-beta` : name;
}
