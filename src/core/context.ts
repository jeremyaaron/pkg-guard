export interface ProjectContext {
  cwd: string;
  root: string;
  manifest: PackageManifestFile;
  packageManager: PackageManagerInfo;
  git: GitInfo | null;
  tsconfig: TsconfigInfo | null;
  workflows: WorkflowInfo[];
  config: PkgGuardConfig;
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
  private?: unknown;
  license?: unknown;
  repository?: unknown;
  bugs?: unknown;
  homepage?: unknown;
  main?: unknown;
  module?: unknown;
  types?: unknown;
  typings?: unknown;
  exports?: unknown;
  bin?: unknown;
  files?: unknown;
  pkgGuard?: unknown;
  [key: string]: unknown;
}

export interface PkgGuardConfig {
  preset: string | null;
  ignore: string[];
  strict: string[];
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
