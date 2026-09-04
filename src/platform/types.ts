import type { ProjectSession } from "../core/types";

export interface PlatformAdapter {
  openProject(): Promise<ProjectSession | null>;
}
