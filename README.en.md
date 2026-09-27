# SFMC Module Registry

[简体中文](README.md) · [Contribution guide](CONTRIBUTING.md)

This is the Pure Registry Index Hub for ScriptsForMinecraftServer. It contains module metadata and registry tooling. Module source code lives in independent repositories and packages are distributed through npm.

Edit one `modules/<id>.json` per module. GitHub Actions aggregates these shards into the root `index.json`, which remains compatible with the existing SFMC CLI. Contributors do not edit the generated index in metadata PRs.

## Discover and install

```bash
sfmc mod search
sfmc mod install afk
sfmc mod install <id>
```

**Before stable publication, 2026-09-27:** The 19 manifests remain a candidate index. Verification of every exact package version against the public registry currently returns 404, so these entries do not establish that the modules are installable. The versions listed for `activity-log`, `data-backup`, and `qq-link` differ from their module repositories' current `package.json` values. Publish the modules first, align each entry to the published version, run `pnpm run verify --network`, and update this note. Unverified repository URLs and author fields are omitted.

See the [19-module catalog](README.md#官方模块19) for descriptions and dependencies. Package names follow `@sfmc-bds/module-<id>`. Retired `tps` and `scoreboard-sync`, and deferred `daily-task`, are excluded.

## Maintain the index

Node.js >= 22.13.0 is required. The only direct dependencies are Ajv, ajv-formats, and semver; no SDK checkout or workspace is needed.

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm test
pnpm run verify --network
pnpm run build
node --test
```

Verification checks strict schemas, filenames, duplicate IDs, missing dependencies, and dependency cycles. It validates the candidate index without requiring the committed index to be current. Optional network validation checks each exact npm package/version with a 15-second request timeout and at most four concurrent requests.

The builder validates first, sorts by module ID, and atomically writes formatted JSON. Unchanged metadata preserves the timestamp, making repeated builds byte-stable. Failed builds leave the existing index intact.

PRs targeting main run offline validation, regression tests, and a build. Pushes affecting shards, schemas, tools, dependencies, or the publishing workflow regenerate the index from the latest main. The publishing job commits only `index.json`, retries races without force-pushing, and does not trigger itself. Manual dispatch is available on main. Actions must be allowed to write to the repository, and branch rules must permit the bot's commit.

The registry retains its existing [AGPL-3.0-only license](LICENSE). Individual modules retain their own licenses.
