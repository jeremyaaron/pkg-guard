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
