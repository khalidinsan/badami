import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { BlockNoteEditor } from "@/components/editor/BlockNoteEditor";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow } from "@/types/db";

export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectOverview,
});

function ProjectOverview() {
  const { projectId } = Route.useParams();
  const [project, setProject] = useState<ProjectRow | null>(null);

  useEffect(() => {
    projectQueries.getProjectById(projectId).then((p) => {
      if (p) setProject(p);
    });
  }, [projectId]);

  const handleContentChange = useCallback(
    async (content: string) => {
      await projectQueries.updateProject(projectId, { content });
    },
    [projectId],
  );

  if (!project) return null;

  return (
    <div className="py-2">
      <BlockNoteEditor
        initialContent={project.content ?? undefined}
        onChange={handleContentChange}
      />
    </div>
  );
}
