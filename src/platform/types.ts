import type { ProjectSession } from "../core/types";

export const PROJECT_WORKSPACE_PROGRESS_EVENT = "yellow-editor:workspace-progress";

export interface ProjectWorkspaceProgress {
  stage: "checking" | "enumerating" | "copying" | "ready" | "error";
  message: string;
  completed: number;
  total: number;
  percent: number;
}

export type ProjectWorkspaceProgressListener = (
  progress: ProjectWorkspaceProgress,
) => void;

export type ProjectSourceKind = "folder" | "zip";

export interface PlatformOpenProjectOptions {
  onWorkspaceProgress?: ProjectWorkspaceProgressListener;
  sourceKind?: ProjectSourceKind;
}

export interface PlatformAdapter {
  openProject(options?: PlatformOpenProjectOptions): Promise<ProjectSession | null>;
}
