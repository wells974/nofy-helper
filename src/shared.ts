export interface Candidate { path: string; label: string }
export interface Inspection {
  root: string; executable: string; version: string; packageName: string;
  sourceHash: string; executableHash: string; headerHash: string;
  translationFiles: number; gateFile: string; gateOffset: number;
  store: boolean;
}
export interface Installation {
  id: string; createdAt: string; source: Inspection; status: 'ready' | 'restoring' | 'restored';
  patchedAsarHash: string; patchedExeHash: string; patchedHeaderHash: string;
}
export interface Overview { platform: string; candidates: Candidate[]; installations: Installation[] }
export interface Progress { message: string; at: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export interface HelperAPI {
  overview(): Promise<Result<Overview>>;
  choose(): Promise<Result<string | null>>;
  inspect(path: string): Promise<Result<Inspection>>;
  repair(): Promise<Result<Installation | null>>;
  restore(id: string): Promise<Result<Installation | null>>;
  launch(id: string): Promise<Result<void>>;
  logs(): Promise<Result<void>>;
  onProgress(callback: (progress: Progress) => void): () => void;
}
declare global { interface Window { helper: HelperAPI } }
