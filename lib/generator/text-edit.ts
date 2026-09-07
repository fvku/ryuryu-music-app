export function rebaseKerns(oldText: string, newText: string, kerns: Record<string, number>): Record<string, number> {
  let start = 0;
  let oldEnd = oldText.length;
  let newEnd = newText.length;

  while (start < oldEnd && start < newEnd && oldText[start] === newText[start]) start += 1;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const shift = newEnd - start - (oldEnd - start);
  const result: Record<string, number> = {};
  for (const [raw, value] of Object.entries(kerns)) {
    const index = Number(raw);
    if (index < start) result[index] = value;
    else if (index >= oldEnd && index + shift < newText.length) result[index + shift] = value;
  }
  return result;
}

export function selectedSpacing(
  text: string,
  tracking: number,
  kerns: Record<string, number>,
  start: number,
  end: number,
): number | null {
  if (end <= start) return tracking;
  let result: number | undefined;
  for (let index = start; index < end; index += 1) {
    if (text[index] === "\n") continue;
    const current = Number((tracking + (kerns[index] || 0)).toFixed(6));
    if (result !== undefined && result !== current) return null;
    result = current;
  }
  return result ?? tracking;
}

export function applySelectedSpacing(
  text: string,
  tracking: number,
  kerns: Record<string, number>,
  start: number,
  end: number,
  next: number,
): { tracking: number; kerns: Record<string, number> } {
  if (end <= start) return { tracking: next, kerns: {} };
  const result = { ...kerns };
  const delta = Number((next - tracking).toFixed(6));
  for (let index = start; index < end; index += 1) {
    if (text[index] === "\n") continue;
    if (delta === 0) delete result[index];
    else result[index] = delta;
  }
  return { tracking, kerns: result };
}
