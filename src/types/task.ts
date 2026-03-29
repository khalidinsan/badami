export interface Task {
  id: string;
  parent_id: string | null;
  project_id: string | null;
  title: string;
  content: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  estimated_min: number | null;
  sort_order: number;
  depth: number;
  is_starred: number;
  recurrence_rule: string | null;
  recurrence_parent_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";

export type TaskPriority = "none" | "low" | "medium" | "high" | "urgent";

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface TaskLabel {
  task_id: string;
  label_id: string;
}

export type SmartListType = "inbox" | "starred" | "today" | "tomorrow" | "next7days" | "overdue";

export interface SmartListCounts {
  inbox: number;
  starred: number;
  today: number;
  tomorrow: number;
  next7days: number;
  overdue: number;
}

export type TaskSortBy = "manual" | "due_date" | "priority" | "title" | "created_at";

export interface ReminderRow {
  id: string;
  task_id: string;
  remind_at: string;
  is_sent: number;
  created_at: string;
}
