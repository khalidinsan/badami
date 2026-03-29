import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";

function nextStatus(current: TaskStatus): TaskStatus {
  if (current === "todo") return "in_progress";
  if (current === "in_progress") return "done";
  return "todo"; // done & cancelled → todo
}

interface TaskCheckboxProps {
  status: TaskStatus;
  onChange: (newStatus: TaskStatus) => void;
  className?: string;
}

export function TaskCheckbox({ status, onChange, className }: TaskCheckboxProps) {
  const isDone = status === "done" || status === "cancelled";
  const isInProgress = status === "in_progress";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onChange(nextStatus(status));
      }}
      className={cn(
        "relative flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150",
        isDone && "border-primary bg-primary",
        isInProgress && "border-blue-500 bg-blue-500/15 dark:bg-blue-500/25",
        !isDone && !isInProgress && "border-muted-foreground/30 hover:border-primary/60",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDone && (
          <motion.svg
            key="check"
            viewBox="0 0 24 24"
            className="h-2.5 w-2.5"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <motion.path
              d="M6 12l4 4 8-8"
              fill="none"
              stroke="white"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            />
          </motion.svg>
        )}
        {isInProgress && (
          <motion.div
            key="dash"
            className="h-[1.5px] w-2 rounded-full bg-blue-500"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ scaleX: 0, opacity: 0 }}
            transition={{ duration: 0.1, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
    </button>
  );
}
