"use client";

interface ScoreBarProps {
  score: number;
  maxScore?: number;
  showNumber?: boolean;
  height?: string;
}

export default function ScoreBar({
  score,
  maxScore = 10,
  showNumber = true,
  height = "h-3",
}: ScoreBarProps) {
  const percentage = Math.min(100, Math.max(0, (score / maxScore) * 100));

  let barColor: string;
  if (score >= 8) {
    barColor = "#22c55e"; // green
  } else if (score >= 6) {
    barColor = "#eab308"; // yellow
  } else {
    barColor = "#ef4444"; // red
  }

  return (
    <div className="flex items-center gap-3 w-full">
      <div className={`flex-1 rounded-full overflow-hidden ${height}`} style={{ backgroundColor: "#2d2d3f" }}>
        <div
          className={`${height} rounded-full transition-all duration-500`}
          style={{
            width: `${percentage}%`,
            backgroundColor: barColor,
            boxShadow: `0 0 8px ${barColor}60`,
          }}
        />
      </div>
      {showNumber && (
        <span
          className="text-sm font-bold min-w-[2.5rem] text-right"
          style={{ color: barColor }}
        >
          {score % 1 === 0 ? score.toFixed(1) : score.toString()}
        </span>
      )}
    </div>
  );
}
