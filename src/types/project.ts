export interface Project {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  category: string | null;
  status: ProjectStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type ProjectStatus = "active" | "on_hold" | "completed" | "archived";

export interface Page {
  id: string;
  project_id: string;
  title: string;
  category: PageCategory | null;
  content: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type PageCategory =
  | "brief"
  | "feature"
  | "screenshot"
  | "notes"
  | "custom";
