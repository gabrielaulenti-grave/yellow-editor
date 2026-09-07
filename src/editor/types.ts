export interface EditorController {
  dirty: boolean;
  valid: boolean;
  busy: boolean;
  save(): Promise<void>;
  revert(): Promise<void>;
}
