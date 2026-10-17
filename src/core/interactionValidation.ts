export interface InteractionDiagnostic {
  message: string; actionPath?: string; tile?: { x: number; y: number }; npc?: string;
}
export interface InteractionCheckReport { valid: boolean; issues: InteractionDiagnostic[] }
export function actionPathLabel(path: string) {
  return path.replace(/^Action/, "Action ").replace(/(Yes|No|Then|Otherwise|Won|Caught|Escaped)(\d+)/g, " › $1 › action $2");
}
export class InteractionValidationError extends Error {
  constructor(readonly detail: InteractionDiagnostic) {
    super((detail.actionPath ? `${actionPathLabel(detail.actionPath)}: ` : "") + detail.message);
    this.name = "InteractionValidationError";
  }
}
export function actionValidationError(error: unknown, actionPath: string, npc?: string) {
  const detail = error instanceof InteractionValidationError ? error.detail : { message: error instanceof Error ? error.message : String(error) };
  return new InteractionValidationError({ ...detail, actionPath: detail.actionPath ?? actionPath, npc: detail.npc ?? npc });
}
