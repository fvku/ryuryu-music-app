/**
 * Release Master の Time列（曲数・総尺）の表記。
 *   60分未満: "9songs, 29min 9sec"
 *   60分以上: "24songs, 1hr 24min"（秒は切り捨てて省略。84min 59sec → 1hr 24min）
 */
export function formatTimeTracks(totalTracks: number, totalMs: number): string {
  const totalSec = Math.round(totalMs / 1000);
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin >= 60) {
    return `${totalTracks}songs, ${Math.floor(totalMin / 60)}hr ${totalMin % 60}min`;
  }
  return `${totalTracks}songs, ${totalMin}min ${totalSec % 60}sec`;
}
