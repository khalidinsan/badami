import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { BlockNoteEditor } from "@/components/editor/BlockNoteEditor";
import * as projectQueries from "@/db/queries/projects";
import type { ProjectRow } from "@/types/db";

export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectOverview,
});

function ProjectOverview() {
  const params = useParams({
    from: "/projects/$projectId/",
    shouldThrow: false,
  });
  const projectId = params?.projectId ?? "";
  const [project, setProject] = useState<ProjectRow | null>(null);

  useEffect(() => {
    if (!projectId) return;
    projectQueries.getProjectById(projectId).then((p) => {
      if (p) setProject(p);
    });
  }, [projectId]);

  const handleContentChange = useCallback(
    async (content: string) => {
      if (!projectId) return;
      await projectQueries.updateProject(projectId, { content });
    },
    [projectId],
  );

  if (!projectId || !project) return null;

  return (
    <div className="py-2">
      <BlockNoteEditor
        initialContent={project.content ?? undefined}
        onChange={handleContentChange}
      />
    </div>
  );
}
