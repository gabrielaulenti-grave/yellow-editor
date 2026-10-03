// Treat source constants, CamelCase labels, and words as the same search terms.
export function searchText(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

export function matchesSearch(query: string, ...values: string[]): boolean {
  const terms = query.trim().split(/\s+/).map(searchText).filter(Boolean);
  const haystack = values.map(searchText).join(" ");
  return terms.every((term) => haystack.includes(term));
}
