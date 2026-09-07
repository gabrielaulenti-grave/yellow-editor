import { BuildPanel } from "./BuildPanel";
import type { ProjectInfo } from "./core/types";

interface BuildTestTabProps {
  project: ProjectInfo | null;
  hasUnsavedChanges: boolean;
  hidden: boolean;
}

export function BuildTestTab({
  project,
  hasUnsavedChanges,
  hidden,
}: BuildTestTabProps) {
  return (
    <section className="tab-content" hidden={hidden}>
      <div className="tab-heading-row">
        <div>
          <h2>Build &amp; Test</h2>
          <p>Compile the current project, export its ROM, and test it in the emulator.</p>
        </div>
      </div>

      {project ? (
        <BuildPanel
          projectPath={project.path}
          hasUnsavedChanges={hasUnsavedChanges}
        />
      ) : (
        <p>Open a project to build and test a ROM.</p>
      )}
    </section>
  );
}
