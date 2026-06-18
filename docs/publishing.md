# Publishing

`pkg-guard` is intended to publish as the unscoped public npm package `pkg-guard`.

## Requirements

- An npm user account with permission to publish the package.
- Two-factor authentication for interactive publishing, or npm trusted publishing for CI.
- The `pkg-guard` package name available on npm at the time of first publish.
- GitHub Pages configured to use GitHub Actions as the Pages source.

## Recommended First Release

1. Confirm the package name is still available:

   ```sh
   npm view pkg-guard name version
   ```

   A `404` means the package has not been claimed.

2. Configure npm trusted publishing for the package on npmjs.com:

   - Provider: GitHub Actions
   - Repository: `jeremyaaron/pkg-guard`
   - Workflow filename: `release.yml`
   - Trigger: `v*` Git tags

3. Push the release workflow and enable GitHub Pages from Actions in repository settings.

4. Create and push a version tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

The release workflow installs dependencies, runs tests, builds the package, runs the freshly built local `pkg-guard` CLI, verifies the packlist with `npm pack --dry-run --ignore-scripts`, and publishes with `npm publish`.
