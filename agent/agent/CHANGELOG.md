# Changelog

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
