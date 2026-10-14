export const NODE_GEREKSINIMI = "Node.js 22.22.2+ (22.x), 24.15.0+ (24.x) veya 26+";
export function nodeDestekleniyor(surum) {
  const [ana, alt, yama] = surum.split(".").map(Number);
  if (![ana, alt, yama].every(Number.isInteger)) return false;
  return (
    ana >= 26 ||
    (ana === 24 && alt >= 15) ||
    (ana === 22 && (alt > 22 || (alt === 22 && yama >= 2)))
  );
}
