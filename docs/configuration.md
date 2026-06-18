# Configuration

`pkg-guard` works without config. Optional config lives in `package.json` under `pkgGuard`.

```json
{
  "pkgGuard": {
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
| `preset` | `string` | Reserved for future preset support. Parsed but not used yet. |

CLI flags are applied after package config:

```sh
npx pkg-guard check --ignore dependencies.runtime-in-dev
npx pkg-guard check --strict
```

Use `ignore` for intentional project-specific exceptions. Prefer fixing errors over suppressing them.
