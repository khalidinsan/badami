import { useEffect, useRef } from "react";
import { usePomodoroStore } from "@/stores/pomodoroStore";
import { sendNotification } from "@tauri-apps/plugin-notification";

export function usePomodoro() {
  const store = usePomodoroStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load settings on first mount
  useEffect(() => {
    store.loadSettings();
    store.loadTodaySessions();
  }, []);

  // Timer interval
  useEffect(() => {
    if (store.status === "working" || store.status === "break") {
      intervalRef.current = setInterval(() => {
        store.tick();
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [store.status]);

  // Watch for timer reaching zero
  useEffect(() => {
    if (store.secondsLeft <= 0) {
      if (store.status === "working") {
        try {
          sendNotification({
            title: "Pomodoro Done!",
            body: "Great work! Time for a break.",
          });
        } catch {}
        store.completeWork();
      } else if (store.status === "break") {
        try {
          sendNotification({
            title: "Break Over",
            body: "Ready for another round?",
          });
        } catch {}
        store.completeBreak();
      }
    }
  }, [store.secondsLeft, store.status]);

  return store;
}
