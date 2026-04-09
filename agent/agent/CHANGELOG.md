# Changelog

## [0.13.1](https://github.com/simonjcarr/infrawatch/compare/agent/v0.13.0...agent/v0.13.1) (2026-04-09)


### Bug Fixes

* **agent:** make check delivery resilient to stream reconnects and hostID failures ([251455d](https://github.com/simonjcarr/infrawatch/commit/251455da236c079be0d3074fef69327e57f55dd1))
* **agent:** make check delivery resilient to stream reconnects and hostID resolution failures ([abf93d3](https://github.com/simonjcarr/infrawatch/commit/abf93d38dccca836e3ebd8dfe5deea68f169c7e9))

## [0.13.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.12.0...agent/v0.13.0) (2026-04-09)


### Features

* **checks:** add cert_file check type and fix cert JSON display ([9ad2882](https://github.com/simonjcarr/infrawatch/commit/9ad2882b5c76005b5ba5df9b56d90be353bffbcb))
* **checks:** add cert_file check type and fix cert result display ([bcb6cfb](https://github.com/simonjcarr/infrawatch/commit/bcb6cfb2d8abf210af619efe582fd1747cecfe3c))

## [0.12.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.11.3...agent/v0.12.0) (2026-04-08)


### Features

* **certificates:** implement Phase 3 certificate lifecycle management ([cf6826b](https://github.com/simonjcarr/infrawatch/commit/cf6826bda93ec09fa7563d787cd4003ead665fd7))
* **certificates:** Phase 3 — certificate lifecycle management ([6de140e](https://github.com/simonjcarr/infrawatch/commit/6de140e3d1d9eb36b0126c4371945ed92e97f371))

## [0.11.3](https://github.com/simonjcarr/infrawatch/compare/agent/v0.11.2...agent/v0.11.3) (2026-04-08)


### Bug Fixes

* **agent:** fresh gRPC conn per stream attempt + TCP keepalive ([7426d3e](https://github.com/simonjcarr/infrawatch/commit/7426d3ec36ac4d391cd7d7b556994850c4878d9a))
* **agent:** gRPC reconnect reliability + heartbeat interval chart ([02baa79](https://github.com/simonjcarr/infrawatch/commit/02baa79fe7a7cb3b042585b0051e8b4d913879a3))

## [0.11.2](https://github.com/simonjcarr/infrawatch/compare/agent/v0.11.1...agent/v0.11.2) (2026-04-08)


### Bug Fixes

* **agent:** reset heartbeat backoff after stable stream ([fe139da](https://github.com/simonjcarr/infrawatch/commit/fe139da63fe058f442d51eec7d26bb93f81b02a4))
* **agent:** reset heartbeat backoff after stable stream ([3a2a68b](https://github.com/simonjcarr/infrawatch/commit/3a2a68b70190c5ec4a1978acbf8774525eac254c))

## [0.11.1](https://github.com/simonjcarr/infrawatch/compare/agent/v0.11.0...agent/v0.11.1) (2026-04-07)


### Bug Fixes

* **agent:** self-update now survives systemd and Restart=always ([18c6d5c](https://github.com/simonjcarr/infrawatch/commit/18c6d5c969b94cdbdbe1107d6926ebb1c05d7238))
* **agent:** self-update survives systemd (syscall.Exec + Restart=always) ([ef17a26](https://github.com/simonjcarr/infrawatch/commit/ef17a26f1974cf3ab530aa0097853233201be51b))

## [0.11.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.10.0...agent/v0.11.0) (2026-04-07)


### Features

* agent --version flag, UI version in sidebar, update-available badge ([2e93adf](https://github.com/simonjcarr/infrawatch/commit/2e93adfcf00094652ab7b3d6d937ead391c43012))
* agent --version flag, UI version in sidebar, update-available badge ([5468ffb](https://github.com/simonjcarr/infrawatch/commit/5468ffb41241a67824bb558bac4a0e3d0188b38c))

## [0.10.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.9.1...agent/v0.10.0) (2026-04-07)


### Features

* **alerts:** test notifications, edit channels, and SMTP dispatch ([7ff498b](https://github.com/simonjcarr/infrawatch/commit/7ff498b743aca25228de44fa2d1ad806013f2752))


### Bug Fixes

* **agent,ingest:** add gRPC keepalive to prevent silent stream death ([008aba8](https://github.com/simonjcarr/infrawatch/commit/008aba85007a0ebd42e0e622389df04587684667))

## [0.9.1](https://github.com/simonjcarr/infrawatch/compare/agent/v0.9.0...agent/v0.9.1) (2026-04-07)


### Bug Fixes

* **agent:** reuse HTTP client and reset stream dedup map on reconnect ([8f8e1df](https://github.com/simonjcarr/infrawatch/commit/8f8e1dfb0a785f00d2d55a00a8c59752f7287822))
* **agent:** reuse HTTP client and reset stream dedup map on reconnect ([b6214ed](https://github.com/simonjcarr/infrawatch/commit/b6214edbf68bdf0dea2585066fa47948cbd1728b))

## [0.9.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.8.0...agent/v0.9.0) (2026-04-06)


### Features

* **agent:** agent install, TLS, cross-platform builds, and auto-download ([b12296d](https://github.com/simonjcarr/infrawatch/commit/b12296d9229c0f9d0128c2dd7df9be0378dba609))


### Bug Fixes

* **agent:** build all platform binaries to the correct dist directory ([ce54b74](https://github.com/simonjcarr/infrawatch/commit/ce54b741429c2822189f14677954e218aea93dc9))

## [0.8.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.7.0...agent/v0.8.0) (2026-04-06)


### Features

* **agent:** add --tls-skip-verify flag to agent install flow ([c6abbdc](https://github.com/simonjcarr/infrawatch/commit/c6abbdca2d0deaaa4361b5e9b23e863dfab9bb14))
* **agent:** add --tls-skip-verify flag to agent install flow ([ab124d2](https://github.com/simonjcarr/infrawatch/commit/ab124d2a3e350b01e34119652bac1b6a56e41810))

## [0.7.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.6.0...agent/v0.7.0) (2026-04-06)


### Features

* **checks:** add ad-hoc agent queries for port and service discovery ([dfad656](https://github.com/simonjcarr/infrawatch/commit/dfad65698a5556140e00a21b9058aec45fc1cf2c))
* **checks:** add ad-hoc agent queries for port and service discovery ([cfafed1](https://github.com/simonjcarr/infrawatch/commit/cfafed175314e1ed70819a11e9d9420e9e4f2043))

## [0.6.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.5.1...agent/v0.6.0) (2026-04-06)


### Features

* **checks:** add check definition system with port, process, and HTTP checks ([76d0a01](https://github.com/simonjcarr/infrawatch/commit/76d0a0169e6a659e950b188aee3bf615f59bee26))
* **checks:** add check definition system with port, process, and HTTP checks ([d33c458](https://github.com/simonjcarr/infrawatch/commit/d33c458c1d759d252fdba0b327f343058eec2e9e))

## [0.5.1](https://github.com/simonjcarr/infrawatch/compare/agent/v0.5.0...agent/v0.5.1) (2026-04-05)


### Bug Fixes

* **agent,ingest:** populate OS and architecture on hosts ([7cdd25b](https://github.com/simonjcarr/infrawatch/commit/7cdd25bb2d3d24ca45cab4e44d32f0d3ceaf2cd4))

## [0.5.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.4.0...agent/v0.5.0) (2026-04-05)


### Features

* **agent,ingest,web:** collect real system metrics and add host detail page ([da19fae](https://github.com/simonjcarr/infrawatch/commit/da19faed79f6ec70c55aa478032710a1a56412ad))
* **agent:** add tls_skip_verify option and improve install config merging ([5ff70a5](https://github.com/simonjcarr/infrawatch/commit/5ff70a5034a689de56758392049b70416d91792f))

## [0.4.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.3.0...agent/v0.4.0) (2026-04-05)


### Features

* **agent:** multi-platform service install and version-aware binary cache ([b875381](https://github.com/simonjcarr/infrawatch/commit/b8753813bbbea8be42e332997f9ff2ac1f160996))
* **agent:** server-hosted binaries and agent self-install ([87ba22c](https://github.com/simonjcarr/infrawatch/commit/87ba22c5c1afaed82ea5f240bc926a52f1d29ea1))

## [0.3.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.2.0...agent/v0.3.0) (2026-04-05)


### Features

* **agent:** one-command install with token and add -token/-address CLI flags ([cd3c228](https://github.com/simonjcarr/infrawatch/commit/cd3c228954b67d8e85894536eea410e9779a5dff))

## [0.2.0](https://github.com/simonjcarr/infrawatch/compare/agent/v0.1.0...agent/v0.2.0) (2026-04-04)


### Features

* **agent:** add automated releases, distribution, and self-update ([bc315dc](https://github.com/simonjcarr/infrawatch/commit/bc315dc429ca2d9f8e9980b138f39108264a5691))
* initial monorepo commit — Phase 0 foundation ([ca9b1f9](https://github.com/simonjcarr/infrawatch/commit/ca9b1f9c5fcc1edb39cda332f967fde35791bf61))
* Phase 1 — Go agent, gRPC ingest service, and host inventory UI ([ddf5a0a](https://github.com/simonjcarr/infrawatch/commit/ddf5a0a7fcdbc1e514ad5c9126260c5feed314c2))
