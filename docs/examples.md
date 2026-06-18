# Examples

## Add a Local Check Script

```json
{
  "scripts": {
    "pkg:check": "pkg-guard check"
  }
}
```

Run it before publishing:

```sh
npm run build
npm run pkg:check
```

## CI Self-Check

Run the built CLI against the package:

```yaml
- run: npm ci
- run: npm run lint
- run: npm run typecheck
- run: npm test
- run: npm run build
- run: node dist/cli/index.js check
```

For downstream projects that install `pkg-guard` from npm:

```yaml
- run: npm ci
- run: npm run build --if-present
- run: npx pkg-guard check
```

## Suppress a Conservative Warning

```json
{
  "pkgGuard": {
    "ignore": ["dependencies.runtime-in-dev"]
  }
}
```

## Promote a Warning in Strict Mode

```json
{
  "pkgGuard": {
    "strict": ["manifest.files-missing"]
  }
}
```

```sh
npx pkg-guard check --strict
```

## Generate a Release Workflow

```sh
npx pkg-guard init-release
```

After reviewing the generated `.github/workflows/release.yml`, configure npm trusted publishing for the package on npmjs.com.
