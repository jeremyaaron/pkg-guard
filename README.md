# pkg-guard

Guard npm package manifests, entry points, and release workflows before publishing.

`pkg-guard` is in early development. The CLI command shell and reporting contracts are in place; package checks are implemented in later phases.

## Usage

```sh
npm install -D pkg-guard
npx pkg-guard --help
npx pkg-guard check
```

## Development

```sh
npm install
npm run lint
npm run typecheck
npm test
npm run build
```
