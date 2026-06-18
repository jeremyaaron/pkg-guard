export interface ProjectContext {
  cwd: string;
  root: string;
  manifest: PackageManifestFile;
  packageManager: PackageManagerInfo;
  git: GitInfo | null;
  tsconfig: TsconfigInfo | null;
  workflows: WorkflowInfo[];
}

export interface PackageManifestFile {
  path: string;
  data: PackageManifest;
  raw: string;
}

export interface PackageManifest {
  name?: unknown;
  version?: unknown;
  packageManager?: unknown;
  [key: string]: unknown;
}

export type PackageManagerName = "npm" | "pnpm" | "yarn" | "bun";

export interface PackageManagerInfo {
  detected: PackageManagerName;
  packageManagerField: PackageManagerField | null;
  lockfiles: LockfileInfo[];
}

export interface PackageManagerField {
  name: PackageManagerName | string;
  version: string | null;
  raw: string;
}

export interface LockfileInfo {
  name: PackageManagerName;
  path: string;
}

export interface GitInfo {
  remoteUrl: string | null;
}

export interface TsconfigInfo {
  path: string;
  data: unknown;
  raw: string;
}

export interface WorkflowInfo {
  path: string;
  raw: string;
}
