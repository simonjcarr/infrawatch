# Changelog

## [0.5.1](https://github.com/simonjcarr/infrawatch/compare/web/v0.5.0...web/v0.5.1) (2026-04-08)


### Bug Fixes

* **web:** use ISO string for Date params in db.execute() raw SQL queries ([822d9df](https://github.com/simonjcarr/infrawatch/commit/822d9df890631b93e41fd890d0011b53340df5db))
* **web:** use ISO string for Date params in db.execute() raw SQL queries ([78bf7d1](https://github.com/simonjcarr/infrawatch/commit/78bf7d150c6a25fbf4f625fcd576f1cf1166bc6e))

## [0.5.0](https://github.com/simonjcarr/infrawatch/compare/web/v0.4.0...web/v0.5.0) (2026-04-08)


### Features

* **web:** heartbeat interval chart on host metrics tab ([270d79c](https://github.com/simonjcarr/infrawatch/commit/270d79c3ffcd45731cdb567d9604dc132519a779))


### Bug Fixes

* **agent:** gRPC reconnect reliability + heartbeat interval chart ([02baa79](https://github.com/simonjcarr/infrawatch/commit/02baa79fe7a7cb3b042585b0051e8b4d913879a3))

## [0.4.0](https://github.com/simonjcarr/infrawatch/compare/web/v0.3.0...web/v0.4.0) (2026-04-08)


### Features

* **phase2:** alert history pagination, TimescaleDB CAGGs, metric retention ([63f5676](https://github.com/simonjcarr/infrawatch/commit/63f56762aa70985f4741faa9ee4dd017ffb0791e))
* **phase2:** alert history pagination, TimescaleDB CAGGs, metric retention ([ac5ff93](https://github.com/simonjcarr/infrawatch/commit/ac5ff93138a2c556efd098e55650383dd0c983bd))

## [0.3.0](https://github.com/simonjcarr/infrawatch/compare/web/v0.2.0...web/v0.3.0) (2026-04-07)


### Features

* **dist:** customer bundle + hardcoded agent repo + first-run start.sh ([d055a59](https://github.com/simonjcarr/infrawatch/commit/d055a59e9096dcee6358078d72e3697bf0965ece))
* **dist:** customer bundle, hardcoded agent repo, first-run start.sh ([711cd04](https://github.com/simonjcarr/infrawatch/commit/711cd04b05cb49bff3c99273040a1aea956d3906))

## [0.2.0](https://github.com/simonjcarr/infrawatch/compare/web/v0.1.0...web/v0.2.0) (2026-04-07)


### Features

* agent --version flag, UI version in sidebar, update-available badge ([2e93adf](https://github.com/simonjcarr/infrawatch/commit/2e93adfcf00094652ab7b3d6d937ead391c43012))
* agent --version flag, UI version in sidebar, update-available badge ([5468ffb](https://github.com/simonjcarr/infrawatch/commit/5468ffb41241a67824bb558bac4a0e3d0188b38c))
* **agent,ingest,web:** collect real system metrics and add host detail page ([da19fae](https://github.com/simonjcarr/infrawatch/commit/da19faed79f6ec70c55aa478032710a1a56412ad))
* **agent:** add --tls-skip-verify flag to agent install flow ([c6abbdc](https://github.com/simonjcarr/infrawatch/commit/c6abbdca2d0deaaa4361b5e9b23e863dfab9bb14))
* **agent:** add --tls-skip-verify flag to agent install flow ([ab124d2](https://github.com/simonjcarr/infrawatch/commit/ab124d2a3e350b01e34119652bac1b6a56e41810))
* **agent:** add automated releases, distribution, and self-update ([bc315dc](https://github.com/simonjcarr/infrawatch/commit/bc315dc429ca2d9f8e9980b138f39108264a5691))
* **agent:** agent install, TLS, cross-platform builds, and auto-download ([b12296d](https://github.com/simonjcarr/infrawatch/commit/b12296d9229c0f9d0128c2dd7df9be0378dba609))
* **agent:** multi-platform service install and version-aware binary cache ([b875381](https://github.com/simonjcarr/infrawatch/commit/b8753813bbbea8be42e332997f9ff2ac1f160996))
* **agent:** one-command install with token and add -token/-address CLI flags ([cd3c228](https://github.com/simonjcarr/infrawatch/commit/cd3c228954b67d8e85894536eea410e9779a5dff))
* **agent:** pin required agent version and auto-download on startup ([dd037af](https://github.com/simonjcarr/infrawatch/commit/dd037afc82a4e07fe1c908bfeae533e042acd9cc))
* **agent:** server-hosted binaries and agent self-install ([87ba22c](https://github.com/simonjcarr/infrawatch/commit/87ba22c5c1afaed82ea5f240bc926a52f1d29ea1))
* **alerts:** host silencing + fix migration runner skipping pending entries ([460bf0c](https://github.com/simonjcarr/infrawatch/commit/460bf0c8534ea65f468847c73d54f95867fd9c45))
* **alerts:** test notifications, edit channels, and SMTP dispatch ([7ff498b](https://github.com/simonjcarr/infrawatch/commit/7ff498b743aca25228de44fa2d1ad806013f2752))
* **alerts:** test notifications, edit channels, and SMTP dispatch ([bcd42fb](https://github.com/simonjcarr/infrawatch/commit/bcd42fb02234d9a35c1357c6599d1c4d60a26af9))
* **checks:** add ad-hoc agent queries for port and service discovery ([dfad656](https://github.com/simonjcarr/infrawatch/commit/dfad65698a5556140e00a21b9058aec45fc1cf2c))
* **checks:** add ad-hoc agent queries for port and service discovery ([cfafed1](https://github.com/simonjcarr/infrawatch/commit/cfafed175314e1ed70819a11e9d9420e9e4f2043))
* **checks:** add check definition system with port, process, and HTTP checks ([76d0a01](https://github.com/simonjcarr/infrawatch/commit/76d0a0169e6a659e950b188aee3bf615f59bee26))
* **checks:** add check definition system with port, process, and HTTP checks ([d33c458](https://github.com/simonjcarr/infrawatch/commit/d33c458c1d759d252fdba0b327f343058eec2e9e))
* initial monorepo commit — Phase 0 foundation ([ca9b1f9](https://github.com/simonjcarr/infrawatch/commit/ca9b1f9c5fcc1edb39cda332f967fde35791bf61))
* **metrics:** metric history, TimescaleDB hypertable, and offline chart visualisation ([c5081dc](https://github.com/simonjcarr/infrawatch/commit/c5081dc1ffcda46924cf9eb1ca0405edc9d8c5e4))
* **metrics:** persist metric history and add chart with offline visualisation ([bc2b3d9](https://github.com/simonjcarr/infrawatch/commit/bc2b3d93ec1aececcddc705930897c1279bf7e2f))
* Phase 0 — user profiles, settings, team management, and feature gating ([585998c](https://github.com/simonjcarr/infrawatch/commit/585998ca9f02b83e82c527904e605c4601beb01c))
* Phase 1 — Go agent, gRPC ingest service, and host inventory UI ([ddf5a0a](https://github.com/simonjcarr/infrawatch/commit/ddf5a0a7fcdbc1e514ad5c9126260c5feed314c2))
* **web:** add SMTP email notification channel for alert rules ([2003bfa](https://github.com/simonjcarr/infrawatch/commit/2003bfa74117f602c450b45499c2ec3394adf650))
* **web:** add SSE streaming and host detail real-time updates ([3f823b3](https://github.com/simonjcarr/infrawatch/commit/3f823b34511e034e3724433e6947b8eb3a6355cd))
* **web:** alert rule builder, state machine, and webhook notifications ([94f1509](https://github.com/simonjcarr/infrawatch/commit/94f150936822dd0d8f8899ac05844e017a5ddc21))
* **web:** alert rules, notifications, and global alert defaults ([89926ce](https://github.com/simonjcarr/infrawatch/commit/89926ce84df39b75beb5a7a8dbfd22a1cf793ee0))
* **web:** global alert defaults that auto-apply to new hosts on agent approval ([c60cad9](https://github.com/simonjcarr/infrawatch/commit/c60cad9baec6b9a6332abb63ce7f0cf4b6c5ab53))
* **web:** prewarm agent binary cache on server startup ([8eae9d8](https://github.com/simonjcarr/infrawatch/commit/8eae9d8ed04ec38c22269fc75e21c9d336ec1260))
* **web:** SSE streaming and host detail real-time updates ([704c738](https://github.com/simonjcarr/infrawatch/commit/704c738d73b53a72d65e2b3988817d282916a39d))


### Bug Fixes

* add standalone-compatible migration script for Docker deployments ([6c56773](https://github.com/simonjcarr/infrawatch/commit/6c56773c8939f120f04b9c67391e2441dbdb83b1))
* add workspace node_modules/.bin to PATH in builder stage ([dbab3a3](https://github.com/simonjcarr/infrawatch/commit/dbab3a340ae1318316b0a3a568aeb3520ed4f1b2))
* **agent:** derive required agent version from release-please manifest ([5e97869](https://github.com/simonjcarr/infrawatch/commit/5e97869ce9318c10151e8181d65275ed59a04fc5))
* **agent:** update required agent version to v0.9.0 ([833ad8d](https://github.com/simonjcarr/infrawatch/commit/833ad8d9e45006122dfdbda17f5416208c0359ee))
* **checks:** remove type exports from 'use server' file causing ReferenceError ([90939f2](https://github.com/simonjcarr/infrawatch/commit/90939f2bbe355572ce732e4ecd347e921e77b500))
* **checks:** remove type exports from 'use server' file causing ReferenceError ([26285e8](https://github.com/simonjcarr/infrawatch/commit/26285e8dd4634b4545436ecd1d7b1376cf8c8e91))
* copy apps/web/node_modules from deps stage into builder ([2db1423](https://github.com/simonjcarr/infrawatch/commit/2db14234b881d2600b811b10983ad2bc93c19a92))
* copy workspace config into builder stage so pnpm resolves node_modules ([f957fbf](https://github.com/simonjcarr/infrawatch/commit/f957fbfb211246df8c82320e585e9110e7135a62))
* correct both Dockerfiles for monorepo workspace builds ([1485264](https://github.com/simonjcarr/infrawatch/commit/1485264f918ef79556903675160217201c957a96))
* correct standalone paths for pnpm monorepo in web Dockerfile ([075f144](https://github.com/simonjcarr/infrawatch/commit/075f144926934525039ed78d150589c663d5c042))
* **team:** restore soft-deleted users on re-invite instead of re-registering ([f29bb96](https://github.com/simonjcarr/infrawatch/commit/f29bb96f56a9befdd9e8f9b00c5894b084a053c5))
* use monorepo root context for web Docker build ([a3500b2](https://github.com/simonjcarr/infrawatch/commit/a3500b2e6edc778c064e9de46fb73a1d40629dfa))
* **web:** remove instrumentationHook from next.config (built-in since Next.js 15) ([f1bea56](https://github.com/simonjcarr/infrawatch/commit/f1bea5604b09170ede385df393e5aa5c95c9208c))
