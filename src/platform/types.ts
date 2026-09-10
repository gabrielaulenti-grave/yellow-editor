import type { ProjectSession } from "../core/types";

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

export interface PlatformOpenProjectOptions {
  onWorkspaceProgress?: ProjectWorkspaceProgressListener;
}

export interface PlatformAdapter {
  openProject(options?: PlatformOpenProjectOptions): Promise<ProjectSession | null>;
}
