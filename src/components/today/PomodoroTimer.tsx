import { usePomodoroStore } from "@/stores/pomodoroStore";
import { Play, Pause, RotateCcw, SkipForward } from "lucide-react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

interface PomodoroTimerProps {
  taskId?: string | null;
  compact?: boolean;
  onBackToTasks?: () => void;
}

export function PomodoroTimer({
  taskId,
  compact = false,
  onBackToTasks,
}: PomodoroTimerProps) {
  const {
    status,
    secondsLeft,
    totalSeconds,
    start,
    pause,
    resume,
    reset,
    skip,
    todaySessions,
  } = usePomodoroStore();

  const progress =
    totalSeconds > 0 ? ((totalSeconds - secondsLeft) / totalSeconds) * 100 : 0;

  const completedToday = todaySessions.filter((s) => s.completed).length;
  const isBreak = status === "break";

  const handlePlayPause = async () => {
    if (status === "idle") {
      await start(taskId);
    } else if (status === "paused") {
      resume();
    } else {
      pause();
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={handlePlayPause}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20"
        >
          {status === "working" || status === "break" ? (
            <Pause className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3 ml-0.5" />
          )}
        </button>
        <span className="font-mono text-xs font-medium tabular-nums">
          {formatTime(secondsLeft)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-4 py-3" data-tauri-no-drag>
      {/* Circular progress */}
      <div className="relative flex h-28 w-28 items-center justify-center">
        <svg className="h-28 w-28 -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            className="text-muted/40"
          />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeDasharray={`${2 * Math.PI * 44}`}
            strokeDashoffset={`${2 * Math.PI * 44 * (1 - progress / 100)}`}
            strokeLinecap="round"
            className={isBreak ? "text-green-500" : "text-primary"}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="font-mono text-2xl font-bold tabular-nums">
            {formatTime(secondsLeft)}
          </span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {status === "idle"
              ? "Ready"
              : isBreak
                ? "Break"
                : status === "paused"
                  ? "Paused"
                  : "Focus"}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => reset()}
          disabled={status === "idle"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handlePlayPause}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {status === "working" || status === "break" ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 ml-0.5" />
          )}
        </button>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => skip()}
          disabled={status === "idle"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Session count */}
      <p className="text-xs text-muted-foreground">
        {completedToday} session{completedToday !== 1 ? "s" : ""} today
      </p>

      {onBackToTasks && (
        <button
          onClick={onBackToTasks}
          className="text-[0.625rem] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        >
          ← Back to tasks
        </button>
      )}
    </div>
  );
}
