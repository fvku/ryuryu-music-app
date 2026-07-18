export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function getMjStyle(value: string) {
  const isAdopted = value.includes("採用") && !value.includes("不採用");
  return {
    backgroundColor: isAdopted ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.06)",
    color: isAdopted ? "var(--accent)" : "var(--text-secondary)",
  };
}

export const ASSIGN_VALUES = ["Kwisoo", "Meri", "Kohei", "Eddie", "Hanawa", "Kaede", ""];
