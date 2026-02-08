export function baseTime(tc: string): number {
  return parseInt(tc.split("+")[0], 10) || 0;
}

export function matchesCategory(tc: string, category: string): boolean {
  const b = baseTime(tc);
  switch (category) {
    case "bullet": return b < 180;
    case "blitz": return b >= 180 && b < 600;
    case "rapid": return b >= 600;
    default: return false;
  }
}
