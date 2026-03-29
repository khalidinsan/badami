import { useState, useMemo } from "react";
import dayjs from "dayjs";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  X,
  Sun,
  Sunrise,
  CalendarDays,
  CalendarClock,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  value: string | null | undefined;
  onChange: (date: string | null) => void;
  placeholder?: string;
  className?: string;
  size?: "sm" | "default" | "xs";
  clearable?: boolean;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  size = "default",
  clearable = true,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() =>
    value ? dayjs(value) : dayjs(),
  );

  const selected = value ? dayjs(value) : null;
  const todayDate = dayjs();

  const handleSelect = (date: dayjs.Dayjs) => {
    onChange(date.format("YYYY-MM-DD"));
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  const handleShortcut = (date: dayjs.Dayjs) => {
    onChange(date.format("YYYY-MM-DD"));
    setOpen(false);
  };

  // Generate calendar grid
  const calendarDays = useMemo(() => {
    const startOfMonth = viewDate.startOf("month");
    const endOfMonth = viewDate.endOf("month");
    const startDay = startOfMonth.day(); // 0=Sun
    const daysInMonth = endOfMonth.date();

    const days: Array<{ date: dayjs.Dayjs; isCurrentMonth: boolean }> = [];

    // Previous month fill
    for (let i = startDay - 1; i >= 0; i--) {
      days.push({
        date: startOfMonth.subtract(i + 1, "day"),
        isCurrentMonth: false,
      });
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({
        date: viewDate.date(d),
        isCurrentMonth: true,
      });
    }

    // Next month fill (complete the grid to 42 cells = 6 rows)
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: endOfMonth.add(i, "day"),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [viewDate]);

  const displayValue = selected
    ? selected.isSame(todayDate, "day")
      ? "Today"
      : selected.isSame(todayDate.add(1, "day"), "day")
        ? "Tomorrow"
        : selected.format("MMM D, YYYY")
    : null;

  const sizeClasses = {
    xs: "h-6 px-1.5 text-[10px] gap-1",
    sm: "h-7 px-2 text-xs gap-1.5",
    default: "h-8 px-2.5 text-xs gap-1.5",
  };

  const iconSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center rounded-md border border-input bg-transparent transition-colors outline-none",
            "hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            sizeClasses[size],
            !displayValue && "text-muted-foreground",
            className,
          )}
        >
          <Calendar className={cn(iconSize, "shrink-0 text-muted-foreground")} />
          <span className="truncate">{displayValue ?? placeholder}</span>
          {clearable && value && (
            <X
              className={cn(iconSize, "shrink-0 text-muted-foreground/60 hover:text-foreground")}
              onClick={handleClear}
            />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-auto p-0"
        align="start"
        sideOffset={4}
      >
        <div className="flex">
          {/* Quick shortcuts */}
          <div className="flex flex-col gap-0.5 border-r border-border/60 p-2 pr-2">
            <ShortcutButton
              icon={Sun}
              label="Today"
              active={selected?.isSame(todayDate, "day")}
              onClick={() => handleShortcut(todayDate)}
            />
            <ShortcutButton
              icon={Sunrise}
              label="Tomorrow"
              active={selected?.isSame(todayDate.add(1, "day"), "day")}
              onClick={() => handleShortcut(todayDate.add(1, "day"))}
            />
            <ShortcutButton
              icon={CalendarDays}
              label="Next week"
              active={selected?.isSame(todayDate.add(7, "day"), "day")}
              onClick={() => handleShortcut(todayDate.add(7, "day"))}
            />
            <ShortcutButton
              icon={CalendarClock}
              label="In 2 weeks"
              active={selected?.isSame(todayDate.add(14, "day"), "day")}
              onClick={() => handleShortcut(todayDate.add(14, "day"))}
            />
            {clearable && (
              <ShortcutButton
                icon={X}
                label="No date"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              />
            )}
          </div>

          {/* Calendar */}
          <div className="p-2">
            {/* Month navigation */}
            <div className="mb-1 flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => setViewDate((v) => v.subtract(1, "month"))}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewDate(dayjs())}
                className="text-xs font-medium transition-colors hover:text-primary"
              >
                {viewDate.format("MMMM YYYY")}
              </button>
              <button
                type="button"
                onClick={() => setViewDate((v) => v.add(1, "month"))}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-0">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="flex h-7 w-7 items-center justify-center text-[10px] font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="grid grid-cols-7 gap-0">
              {calendarDays.map(({ date, isCurrentMonth }, i) => {
                const isSelected = selected?.isSame(date, "day");
                const isToday = date.isSame(todayDate, "day");
                const isPast =
                  date.isBefore(todayDate, "day") && !isSelected;

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelect(date)}
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-md text-[11px] transition-colors",
                      !isCurrentMonth && "text-muted-foreground/30",
                      isCurrentMonth && !isSelected && !isToday && "text-foreground hover:bg-accent",
                      isCurrentMonth && isPast && !isSelected && "text-muted-foreground",
                      isToday && !isSelected && "bg-accent font-semibold text-primary",
                      isSelected && "bg-primary text-primary-foreground font-semibold",
                    )}
                  >
                    {date.date()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}


function ShortcutButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors whitespace-nowrap",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
