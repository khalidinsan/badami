import * as projectQueries from "@/db/queries/projects";
import * as serverQueries from "@/db/queries/servers";
import * as credentialQueries from "@/db/queries/credentials";
import * as dbClientQueries from "@/db/queries/dbClient";
import { db } from "@/db/client";
import { v4 as uuidv4 } from "uuid";
import { now } from "@/lib/dateUtils";

// ── Tool Definitions (sent to OpenRouter) ───────────────────────────

export const AI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_projects",
      description: "List all projects with their status. Can filter by status.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", description: "Filter by status: active, completed, on_hold, archived. Leave empty for all.", enum: ["active", "completed", "on_hold", "archived"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_project",
      description: "Get detailed info about a specific project including its description and overview content.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID" },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_tasks",
      description: "List tasks. Can filter by status, priority, project, or get overdue tasks.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["todo", "in_progress", "done", "cancelled"] },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          project_id: { type: "string", description: "Filter by project ID" },
          overdue: { type: "boolean", description: "Only show overdue tasks" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_task",
      description: "Create a new task.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title" },
          project_id: { type: "string", description: "Project ID to assign to (optional)" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Default: medium" },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format (optional)" },
          status: { type: "string", enum: ["todo", "in_progress"], description: "Default: todo" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_task",
      description: "Update an existing task's status, priority, or due date.",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task ID to update" },
          status: { type: "string", enum: ["todo", "in_progress", "done", "cancelled"] },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
          due_date: { type: "string", description: "Due date in YYYY-MM-DD format" },
          title: { type: "string", description: "New title" },
        },
        required: ["task_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_all",
      description: "Search across all items (projects, tasks, pages, servers, credentials, API collections) by keyword.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_servers",
      description: "List all configured servers.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_credentials",
      description: "List all credentials (names and metadata only, no secrets).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_db_connections",
      description: "List all database connections.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_today_planning",
      description: "Get today's planned tasks and schedule.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_pages",
      description: "List pages for a project.",
      parameters: {
        type: "object",
        properties: {
          project_id: { type: "string", description: "The project ID" },
        },
        required: ["project_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_page_content",
      description: "Get the content of a specific page.",
      parameters: {
        type: "object",
        properties: {
          page_id: { type: "string", description: "The page ID" },
        },
        required: ["page_id"],
      },
    },
  },
];

// ── Tool Execution ──────────────────────────────────────────────────

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "list_projects": {
        let projects = await projectQueries.getProjects();
        if (args.status) {
          projects = projects.filter((p) => p.status === args.status);
        }
        return JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name, status: p.status, category: p.category })));
      }

      case "get_project": {
        const project = await db.selectFrom("projects").selectAll().where("id", "=", args.project_id as string).executeTakeFirst();
        if (!project) return JSON.stringify({ error: "Project not found" });
        return JSON.stringify({ id: project.id, name: project.name, status: project.status, description: project.description, content: project.content?.slice(0, 2000) });
      }

      case "list_tasks": {
        let query = db.selectFrom("tasks").selectAll();
        if (args.status) query = query.where("status", "=", args.status as string);
        if (args.priority) query = query.where("priority", "=", args.priority as string);
        if (args.project_id) query = query.where("project_id", "=", args.project_id as string);
        if (args.overdue) {
          const today = new Date().toISOString().split("T")[0];
          query = query.where("due_date", "<", today).where("status", "!=", "done").where("status", "!=", "cancelled");
        }
        const limit = (args.limit as number) || 20;
        const tasks = await query.orderBy("created_at", "desc").limit(limit).execute();
        return JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due_date: t.due_date, project_id: t.project_id })));
      }

      case "create_task": {
        const id = uuidv4();
        const ts = now();
        await db.insertInto("tasks").values({
          id,
          title: args.title as string,
          project_id: (args.project_id as string) ?? null,
          priority: (args.priority as string) ?? "medium",
          status: (args.status as string) ?? "todo",
          due_date: (args.due_date as string) ?? null,
          sort_order: 0,
          depth: 0,
          is_starred: 0,
          created_at: ts,
          updated_at: ts,
        }).execute();
        return JSON.stringify({ success: true, task_id: id, title: args.title });
      }

      case "update_task": {
        const updates: Record<string, unknown> = { updated_at: now() };
        if (args.status) updates.status = args.status;
        if (args.priority) updates.priority = args.priority;
        if (args.due_date) updates.due_date = args.due_date;
        if (args.title) updates.title = args.title;
        if (args.status === "done") updates.completed_at = now();
        await db.updateTable("tasks").set(updates).where("id", "=", args.task_id as string).execute();
        return JSON.stringify({ success: true, task_id: args.task_id });
      }

      case "search_all": {
        const q = `%${(args.query as string).toLowerCase()}%`;
        const [projects, tasks, pages] = await Promise.all([
          db.selectFrom("projects").select(["id", "name", "status"]).where("name", "like", q).limit(5).execute(),
          db.selectFrom("tasks").select(["id", "title", "status"]).where("title", "like", q).limit(5).execute(),
          db.selectFrom("pages").select(["id", "title", "project_id"]).where("title", "like", q).limit(5).execute(),
        ]);
        return JSON.stringify({ projects, tasks, pages });
      }

      case "list_servers": {
        const servers = await serverQueries.getAllServers();
        return JSON.stringify(servers.map((s) => ({ id: s.id, name: s.name, host: s.host, port: s.port, protocol: s.protocol })));
      }

      case "list_credentials": {
        const creds = await credentialQueries.getAllCredentials();
        return JSON.stringify(creds.map((c) => ({ id: c.id, name: c.name, type: c.type, username: c.username, service_name: c.service_name })));
      }

      case "list_db_connections": {
        const conns = await dbClientQueries.getConnections();
        return JSON.stringify(conns.map((c) => ({ id: c.id, name: c.name, engine: c.engine, host: c.host, port: c.port })));
      }

      case "get_today_planning": {
        const today = new Date().toISOString().split("T")[0];
        const tasks = await db.selectFrom("tasks").selectAll().where("due_date", "=", today).where("status", "!=", "cancelled").execute();
        return JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority })));
      }

      case "list_pages": {
        const pages = await db.selectFrom("pages").selectAll().where("project_id", "=", args.project_id as string).orderBy("sort_order", "asc").execute();
        return JSON.stringify(pages.map((p) => ({ id: p.id, title: p.title, category: p.category })));
      }

      case "get_page_content": {
        const page = await db.selectFrom("pages").selectAll().where("id", "=", args.page_id as string).executeTakeFirst();
        if (!page) return JSON.stringify({ error: "Page not found" });
        return JSON.stringify({ id: page.id, title: page.title, content: page.content?.slice(0, 3000) });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}
