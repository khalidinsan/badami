import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FolderKanban,
  CheckSquare,
  CalendarDays,
  StickyNote,
  Search,
  ArrowRight,
  Sparkles,
  Zap,
  Server,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settingsStore";

const STEPS = [
  {
    icon: Sparkles,
    title: "Welcome to Badami",
    description:
      "Your focused productivity workspace — projects, tasks, planning, and a floating daily note. Let's take a quick tour.",
    color: "text-primary",
    bg: "bg-primary/10",
    logo: true,
  },
  {
    icon: FolderKanban,
    title: "Projects & Pages",
    description:
      "Organise your work into projects. Each project has an overview and pages — write briefs, feature specs, or notes using the rich editor.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: CheckSquare,
    title: "Tasks",
    description:
      "Create tasks with priorities, labels, due dates, and subtasks. Switch between list and Kanban board views to work how you want.",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
  {
    icon: CalendarDays,
    title: "Daily Planning",
    description:
      "Drag tasks onto any calendar day, or write free-form notes. Track your daily progress with a built-in progress bar.",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    icon: StickyNote,
    title: "Today Window",
    description:
      "Click \"Today\" in the sidebar to open a compact floating window. Check off tasks, add notes, and use the Pomodoro timer — all while staying focused.",
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  {
    icon: Search,
    title: "Quick Search",
    description:
      "Press ⌘K anywhere to open the command palette. Jump to any project, task, or page instantly.",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
  {
    icon: Zap,
    title: "Keyboard Shortcuts",
    description:
      "⌘K: Open search · N: New task · D: Toggle task · S: Star · Delete: Remove task · Arrow keys: Navigate · /: Format (in editor)",
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
  },
  {
    icon: Server,
    title: "Advanced Features",
    description:
      "SSH terminals, SFTP file manager, encrypted credential vault, REST API builder, and optional cloud sync — all built-in.",
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
  },
];

export function OnboardingDialog() {
  const { loaded, loadSettings, setSetting } = useSettingsStore();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const check = async () => {
      if (!loaded) await loadSettings();
      const seen = useSettingsStore.getState().getSetting("onboarding_done", "");
      if (!seen) setOpen(true);
    };
    check();
  }, [loaded]);

  const handleFinish = async () => {
    await setSetting("onboarding_done", "1");
    setOpen(false);
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

          {/* Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
          >
            {/* Step content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.18 }}
                className="p-8"
              >
                {/* Icon */}
                {current.logo ? (
                  <img
                    src="/logo.png"
                    alt="Badami"
                    className="mb-5 h-14 w-auto object-contain"
                  />
                ) : (
                  <div
                    className={`mb-5 flex h-14 w-14 items-center justify-center rounded-2xl ${current.bg}`}
                  >
                    <current.icon className={`h-7 w-7 ${current.color}`} />
                  </div>
                )}

                {/* Text */}
                <h2 className="mb-2 text-xl font-bold">{current.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {current.description}
                </p>
              </motion.div>
            </AnimatePresence>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border/60 px-8 py-4">
              {/* Dot indicators */}
              <div className="flex gap-1.5">
                {STEPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setStep(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step
                        ? "w-4 bg-primary"
                        : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                {step > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep((s) => s - 1)}
                  >
                    Back
                  </Button>
                )}
                {isLast ? (
                  <Button size="sm" onClick={handleFinish}>
                    Get started
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => setStep((s) => s + 1)}
                    className="gap-1.5"
                  >
                    Next
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Skip */}
            <button
              onClick={handleFinish}
              className="absolute right-4 top-4 rounded-md p-1 text-xs text-muted-foreground/50 hover:text-muted-foreground"
            >
              Skip
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
