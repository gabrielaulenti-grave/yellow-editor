export interface ToolRuntimeFile {
  path: string;
  data: Uint8Array;
}

export interface ToolInvocation {
  tool: string;
  args: string[];
  files?: ToolRuntimeFile[];
  outputPaths?: string[];
  workingDirectory?: string;
}

export interface ToolInvocationResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  outputs: ToolRuntimeFile[];
  durationMs: number;
}

export interface ToolRuntimeStatus {
  available: boolean;
  tools: string[];
  version: string | null;
  message: string;
}

export interface BuildToolRuntime {
  inspect(): Promise<ToolRuntimeStatus>;
  run(invocation: ToolInvocation): Promise<ToolInvocationResult>;
}
