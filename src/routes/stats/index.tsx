import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Timer, CheckSquare2, TrendingUp, Flame } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import * as pomodoroQueries from "@/db/queries/pomodoro";
import type { PomodoroStats } from "@/db/queries/pomodoro";

export const Route = createFileRoute("/stats/")({
  component: StatsPage,
});

function StatsPage() {
  const [stats, setStats] = useState<PomodoroStats | null>(null);
  const [dailySessions, setDailySessions] = useState<
    Array<{ date: string; count: number; minutes: number }>
  >([]);
  const [dailyTasks, setDailyTasks] = useState<
    Array<{ date: string; count: number }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      pomodoroQueries.getOverallStats(),
      pomodoroQueries.getDailySessionCounts(30),
      pomodoroQueries.getCompletedTasksCountByDay(30),
    ]).then(([s, ds, dt]) => {
      setStats(s);
      setDailySessions(ds);
      setDailyTasks(dt);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading stats...</p>
      </div>
    );
  }

  // Merge daily sessions + tasks into one chart dataset
  const chartData = mergeChartData(dailySessions, dailyTasks, 30);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold">Statistics</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        Your productivity overview for the last 30 days
      </p>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-4 gap-4">
        <StatCard
          icon={Timer}
          label="Total Sessions"
          value={stats?.totalSessions ?? 0}
        />
        <StatCard
          icon={TrendingUp}
          label="Total Focus"
          value={`${Math.round((stats?.totalMinutes ?? 0) / 60)}h ${(stats?.totalMinutes ?? 0) % 60}m`}
        />
        <StatCard
          icon={CheckSquare2}
          label="Avg Duration"
          value={`${stats?.averageDuration ?? 0}m`}
        />
        <StatCard
          icon={Flame}
          label="Day Streak"
          value={stats?.streak ?? 0}
        />
      </div>

      {/* Pomodoro chart */}
      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold">Pomodoro Sessions (30 days)</h2>
        <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="sessions" name="Pomodoro Sessions" fill="#007AFF" radius={[3, 3, 0, 0]} />
              <Bar dataKey="tasks" name="Tasks Completed" fill="#34C759" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Focus minutes chart */}
      <div>
        <h2 className="mb-3 text-sm font-semibold">Focus Minutes (30 days)</h2>
        <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="minutes" name="Focus Minutes" fill="#FF9500" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function mergeChartData(
  sessions: Array<{ date: string; count: number; minutes: number }>,
  tasks: Array<{ date: string; count: number }>,
  days: number,
) {
  const map = new Map<string, { sessions: number; tasks: number; minutes: number }>();

  // Fill all days
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    map.set(key, { sessions: 0, tasks: 0, minutes: 0 });
  }

  for (const s of sessions) {
    const entry = map.get(s.date);
    if (entry) {
      entry.sessions = s.count;
      entry.minutes = s.minutes;
    }
  }

  for (const t of tasks) {
    const entry = map.get(t.date);
    if (entry) {
      entry.tasks = t.count;
    }
  }

  return [...map.entries()].map(([date, data]) => ({
    date,
    label: date.slice(5), // MM-DD
    ...data,
  }));
}
