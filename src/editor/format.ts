export function formatHex(value: number): string {
  return `$${value.toString(16).toUpperCase().padStart(2, "0")}`;
}
