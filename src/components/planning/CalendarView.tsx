import { useMemo, useRef, useEffect } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventDropArg, DatesSetArg } from "@fullcalendar/core";
import type { CalendarEventData } from "@/db/queries/planning";
import dayjs from "dayjs";

interface CalendarViewProps {
  selectedDate: string | null;
  calendarEvents: CalendarEventData[];
  onDateClick: (date: string) => void;
  onEventDrop?: (taskId: string, newDate: string) => void;
  onRangeChange?: (start: string, end: string) => void;
}

export function CalendarView({
  selectedDate,
  calendarEvents,
  onDateClick,
  onEventDrop,
  onRangeChange,
}: CalendarViewProps) {
  const calRef = useRef<FullCalendar>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-layout FullCalendar whenever its container resizes (e.g. sidebar toggle)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      calRef.current?.getApi().updateSize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const events = useMemo(() => {
    const fcEvents = calendarEvents.map((e) => ({
      id: e.id,
      start: e.date,
      title: e.title,
      extendedProps: { isDone: e.isDone },
      backgroundColor: e.isDone ? "rgba(120,120,128,0.25)" : "var(--color-primary)",
      borderColor: "transparent",
      textColor: e.isDone ? "var(--color-muted-foreground)" : "#fff",
      classNames: e.isDone ? ["fc-event-done"] : [],
    }));

    // Selected date highlight
    if (selectedDate) {
      fcEvents.push({
        id: "__selected__",
        start: selectedDate,
        title: "",
        extendedProps: { isDone: false },
        backgroundColor: "rgba(0,122,255,0.12)",
        borderColor: "transparent",
        textColor: "transparent",
        classNames: ["fc-event-selected-bg"],
      } as any);
    }

    return fcEvents;
  }, [calendarEvents, selectedDate]);

  const handleDateClick = (arg: DateClickArg) => {
    onDateClick(arg.dateStr);
  };

  const handleEventDrop = (info: EventDropArg) => {
    if (!onEventDrop || !info.event.start || info.event.id === "__selected__") return;
    const newDate = dayjs(info.event.start).format("YYYY-MM-DD");
    onEventDrop(info.event.id, newDate);
  };

  const handleDatesSet = (arg: DatesSetArg) => {
    if (!onRangeChange) return;
    // arg.startStr / endStr are ISO dates for the actual visible range
    // (includes leading/trailing days from adjacent months)
    const start = dayjs(arg.start).format("YYYY-MM-DD");
    // arg.end is exclusive — subtract 1 day to get the last visible date
    const end = dayjs(arg.end).subtract(1, "day").format("YYYY-MM-DD");
    onRangeChange(start, end);
  };

  return (
    <div ref={containerRef} className="planning-calendar h-full">
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        dateClick={handleDateClick}
        events={events}
        editable={true}
        eventDrop={handleEventDrop}
        datesSet={handleDatesSet}
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek",
        }}
        height="100%"
        expandRows={true}
        fixedWeekCount={false}
        dayMaxEvents={3}
        selectable={false}
      />
    </div>
  );
}
