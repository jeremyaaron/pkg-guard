# Configuration

`pkg-guard` works without config. Optional config lives in `package.json` under `pkgGuard`.

```json
{
  "pkgGuard": {
    "preset": "typescript-library",
    "ignore": ["dependencies.runtime-in-dev"],
    "strict": ["manifest.files-missing"]
  }
}
```

## Fields

| Field | Type | Description |
| --- | --- | --- |
| `ignore` | `string[]` | Suppresses findings by exact check ID. |
| `strict` | `string[]` | IDs of warnings that should become errors when `--strict` is used. |
| `preset` | `"generic" \| "typescript-library" \| "cli"` | Overrides detected package intent. |

## Presets

When `preset` is omitted, `pkg-guard` infers package intent from package metadata:

| Preset | How it is selected |
| --- | --- |
| `cli` | `package.json` defines `bin`. |
| `typescript-library` | `tsconfig.json` exists and package entrypoint metadata such as `main`, `module`, `exports`, `types`, or `typings` is present. |
| `generic` | No more specific preset is configured or inferred. |

CLI flags are applied after package config:

```sh
npx pkg-guard check --ignore dependencies.runtime-in-dev
npx pkg-guard check --strict
```

Use `ignore` for intentional project-specific exceptions. Prefer fixing errors over suppressing them.

## Workspace Config

Workspace execution is package-local. When you run `pkg-guard check --workspaces`, `pkg-guard` discovers workspace packages from the root, then runs normal package discovery and checks inside each selected package.

Each selected package uses only its own `package.json` `pkgGuard` config. The workspace root config is not silently inherited by child packages. This keeps findings explainable when packages have different publish targets, presets, or suppressions.

To share policy across packages, either:

- add the same `pkgGuard` config to each package that needs it
- pass one-off CLI flags such as `--ignore <id>` or `--strict` from the workspace command

Workspace selection skips packages with `private: true` by default:

```sh
npx pkg-guard check --workspaces
```

Include private packages only when you intentionally want to audit them:

```sh
npx pkg-guard check --workspaces --include-private
```

The workspace root is also excluded by default. Include it explicitly:

```sh
npx pkg-guard check --workspaces --include-root
```

If the root package has `private: true`, combine `--include-root` with `--include-private`.
