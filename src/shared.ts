export interface Candidate { path: string; label: string }
export interface RepairOptions { computerUse?: boolean; browserUse?: boolean }
export interface ComputerUseSupport { supported: boolean; reason: string; files: string[]; patches: number }
export interface RuntimeCheck { name: string; ok: boolean; detail: string; warning?: boolean }
export interface ComputerUseStatus { ready: boolean; canPrepare: boolean; checks: RuntimeCheck[]; backup?: string }
export interface Inspection {
  root: string; executable: string; version: string; packageName: string;
  sourceHash: string; executableHash: string; headerHash: string;
  translationFiles: number; gateFile: string; gateOffset: number;
  store: boolean;
  computerUse?: ComputerUseSupport;
  browserUse?: ComputerUseSupport;
}
export interface Installation {
  id: string; createdAt: string; source: Inspection; status: 'ready' | 'restoring' | 'restored';
  patchedAsarHash: string; patchedExeHash: string; patchedHeaderHash: string;
  features?: RepairOptions;
}
export interface Overview { platform: string; candidates: Candidate[]; installations: Installation[] }
export interface Progress { message: string; at: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface HelperAPI {
  overview(): Promise<Result<Overview>>;
  choose(): Promise<Result<string | null>>;
  inspect(path: string): Promise<Result<Inspection>>;
  repair(options?: RepairOptions): Promise<Result<Installation | null>>;
  computerUseStatus(id: string): Promise<Result<ComputerUseStatus>>;
  prepareComputerUse(id: string): Promise<Result<ComputerUseStatus>>;
  restoreComputerUseConfig(id: string): Promise<Result<void>>;
  restore(id: string): Promise<Result<Installation | null>>;
  launch(id: string): Promise<Result<void>>;
  logs(): Promise<Result<void>>;
  onProgress(callback: (progress: Progress) => void): () => void;
}
declare global { interface Window { helper: HelperAPI } }
