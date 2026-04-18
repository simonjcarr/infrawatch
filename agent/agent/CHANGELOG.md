# Changelog

## [0.27.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.26.2...agent/v0.27.0) (2026-04-18)


### Features

* tag assignment for hosts (settings, enrolment, CLI, bulk rules) ([ddf5b16](https://github.com/carrtech-dev/ct-ops/commit/ddf5b168df16741b8a545f8f367882c28089b46a))
* tag assignment for hosts across settings, enrolment, CLI, and bulk rules ([58cf0cd](https://github.com/carrtech-dev/ct-ops/commit/58cf0cdc66a8a87311f870f0ef58136bfcb98b6d))

## [0.26.2](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.26.1...agent/v0.26.2) (2026-04-18)


### Bug Fixes

* release registration semaphore before heartbeat loop ([4ebd195](https://github.com/carrtech-dev/ct-ops/commit/4ebd19560bbbab9627038b582eb250adf494bd05))
* release registration semaphore before heartbeat loop ([f4eb44b](https://github.com/carrtech-dev/ct-ops/commit/f4eb44ba7b9ac187db4b66c817e744ce72c1ed9e))

## [0.26.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.26.0...agent/v0.26.1) (2026-04-18)


### Bug Fixes

* normalize negative agent indexes in ConnPool.Get ([c094110](https://github.com/carrtech-dev/ct-ops/commit/c094110667dbfb854da5776807687bff3c4caee0))
* normalize negative agent indexes in ConnPool.Get ([92cd151](https://github.com/carrtech-dev/ct-ops/commit/92cd15192241dbafe8e1016f9599a356998258a2))

## [0.26.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.25.0...agent/v0.26.0) (2026-04-18)


### Features

* infrawatch-loadtest tool for capacity planning ([fef4da8](https://github.com/carrtech-dev/ct-ops/commit/fef4da8d4316096e279063973671010f9a4ad9cb))
* infrawatch-loadtest tool for capacity planning ([993d2c8](https://github.com/carrtech-dev/ct-ops/commit/993d2c808bbfdc969059e2ffe2bc961672f1ade1))

## [0.25.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.24.1...agent/v0.25.0) (2026-04-18)


### Features

* **ingest:** dedupe host registrations by hostname / IP overlap ([8e34db9](https://github.com/carrtech-dev/ct-ops/commit/8e34db919dadf05a29d7b2701a7df73cca7a9f3d))

## [0.24.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.24.0...agent/v0.24.1) (2026-04-15)


### Bug Fixes

* **inventory:** add per-collector logging and ingest scan diagnostics ([21beda1](https://github.com/carrtech-dev/ct-ops/commit/21beda18daf3e0ec990630312e55a2c2dcb6eae5))
* **inventory:** add per-collector logging and ingest scan-start diagnostics ([4598052](https://github.com/carrtech-dev/ct-ops/commit/4598052003d519596442bd27760f2c8499292622))

## [0.24.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.23.2...agent/v0.24.0) (2026-04-15)


### Features

* **reports:** overhaul software report UX and fix inventory wipe bug ([19167fe](https://github.com/carrtech-dev/ct-ops/commit/19167fe7906d44e987bd6119c34b4a66697d333c))
* **reports:** overhaul software report UX and fix inventory wipe bug ([4f49c92](https://github.com/carrtech-dev/ct-ops/commit/4f49c927d4daea923a0c772e4f01d6032f94d6a9))

## [0.23.2](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.23.1...agent/v0.23.2) (2026-04-14)


### Bug Fixes

* **monitoring:** eliminate false 100% CPU spikes and fix alert double-evaluation ([01e7146](https://github.com/carrtech-dev/ct-ops/commit/01e71469ae1d4040f4f5da99bd7532ce4c477322))
* **monitoring:** eliminate false 100% CPU spikes and fix alert double-evaluation ([4e6ca6a](https://github.com/carrtech-dev/ct-ops/commit/4e6ca6af9018eedd0f2d53c6b50ff70e3053f259))

## [0.23.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.23.0...agent/v0.23.1) (2026-04-14)


### Bug Fixes

* **agent:** alias windows/registry import to avoid conflict with tasks.registry var ([492502f](https://github.com/carrtech-dev/ct-ops/commit/492502f14cacab60403b2d9c1f21f0d69fc703b8))
* **agent:** alias windows/registry import to avoid conflict with tasks.registry var ([6f6d08f](https://github.com/carrtech-dev/ct-ops/commit/6f6d08f49d2e68f5d31b5803aacbce184632d1b5))

## [0.23.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.22.1...agent/v0.23.0) (2026-04-14)


### Features

* **software-inventory:** full software inventory and reporting feature ([e98cf6f](https://github.com/carrtech-dev/ct-ops/commit/e98cf6fb030a9f3900358f352179b43128b98761))
* **software-inventory:** installed software tracking, global reports, and export ([903e772](https://github.com/carrtech-dev/ct-ops/commit/903e77247ae4041ed9471f649c4bd603c9509c68))

## [0.22.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.22.0...agent/v0.22.1) (2026-04-14)


### Bug Fixes

* **agent:** escape systemd cgroup when uninstalling remotely ([a05f6c9](https://github.com/carrtech-dev/ct-ops/commit/a05f6c91907b71a7b2320eac25319fa46e9a053d))
* **agent:** escape systemd cgroup when uninstalling remotely ([d36111b](https://github.com/carrtech-dev/ct-ops/commit/d36111b9c8b4642a25e7dbf11f89c200ecf433b3))

## [0.22.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.21.2...agent/v0.22.0) (2026-04-14)


### Features

* **hosts:** remote agent uninstall on host deletion ([0613f6c](https://github.com/carrtech-dev/ct-ops/commit/0613f6ce238cefd999183bc59851632bbdc42b78))
* **hosts:** remote agent uninstall on host deletion ([8b3fe3d](https://github.com/carrtech-dev/ct-ops/commit/8b3fe3d7f03a07ee99da727ed046795be8e5e56f))

## [0.21.2](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.21.1...agent/v0.21.2) (2026-04-13)


### Bug Fixes

* **terminal:** cross-distro su with dropped privileges ([9a0e6b0](https://github.com/carrtech-dev/ct-ops/commit/9a0e6b0596c0b851c2607e1b9de45e5dfc0c4a78))
* **terminal:** use su with dropped privileges instead of login for cross-distro compatibility ([dcc6857](https://github.com/carrtech-dev/ct-ops/commit/dcc68577b3bbc09e7f92c411e1efcacb68b74afe))

## [0.21.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.21.0...agent/v0.21.1) (2026-04-13)


### Bug Fixes

* **terminal:** use login instead of su for per-user auth ([a6fa358](https://github.com/carrtech-dev/ct-ops/commit/a6fa3585ad3daf30a1ef885fb055e3db47909112))
* **terminal:** use login instead of su for per-user authentication ([d07b957](https://github.com/carrtech-dev/ct-ops/commit/d07b9572240a4a9f371cb4dfea80a8fc506c1394))

## [0.21.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.20.1...agent/v0.21.0) (2026-04-13)


### Features

* **terminal:** require per-user host authentication ([8539f5d](https://github.com/carrtech-dev/ct-ops/commit/8539f5d450f713e474ec0001ca834ff41b57ab36))
* **terminal:** require per-user host authentication for terminal sessions ([5a51c21](https://github.com/carrtech-dev/ct-ops/commit/5a51c21e97bf1c8c5edfff295aedfb2320b244a8))

## [0.20.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.20.0...agent/v0.20.1) (2026-04-12)


### Bug Fixes

* **agent:** set TERM, HOME, and prefer bash for terminal PTY ([f094ac3](https://github.com/carrtech-dev/ct-ops/commit/f094ac304638a58392c739cc043d838cdcebc099))
* **agent:** set TERM, HOME, and prefer bash for terminal PTY ([ea9a899](https://github.com/carrtech-dev/ct-ops/commit/ea9a899f226e0aff780d188da33a7fc20fec69c8))

## [0.20.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.19.0...agent/v0.20.0) (2026-04-12)


### Features

* **terminal:** add WebSocket terminal and restructure host page tabs ([8313aa4](https://github.com/carrtech-dev/ct-ops/commit/8313aa4b05811a5cff994a8532531426fb2c14ae))
* **terminal:** add WebSocket terminal and restructure host page tabs ([71d37d3](https://github.com/carrtech-dev/ct-ops/commit/71d37d3dde252fa5d2494a2d4d77c385d9255b30))

## [0.19.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.18.0...agent/v0.19.0) (2026-04-12)


### Features

* **tasks:** add custom script runner and service management task types ([50c5eaa](https://github.com/carrtech-dev/ct-ops/commit/50c5eaaadf6eb7b089d7d46e8a4d3871a88b072f))
* **tasks:** add custom script runner and service management task types ([471baf1](https://github.com/carrtech-dev/ct-ops/commit/471baf1b5a4519e7ab99218a847dc6cd88726b23))

## [0.18.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.17.1...agent/v0.18.0) (2026-04-11)


### Features

* **tasks:** add task cancellation with agent-side process kill and UI ([017e9e0](https://github.com/carrtech-dev/ct-ops/commit/017e9e078230d99b998657591eb4af00d32a0a75))
* **tasks:** add task cancellation with agent-side process kill and UI ([81315a1](https://github.com/carrtech-dev/ct-ops/commit/81315a1bd00e04871928ad28a171c0abef30578b))

## [0.17.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.17.0...agent/v0.17.1) (2026-04-11)


### Bug Fixes

* **tasks:** resolve patch output deadlock, add timeouts and debug UI ([74a9a87](https://github.com/carrtech-dev/ct-ops/commit/74a9a874a6b8cca954729dcb1342632d84d2e757))
* **tasks:** resolve patch output deadlock, add timeouts and debug UI ([7bfd4f8](https://github.com/carrtech-dev/ct-ops/commit/7bfd4f8a40c45317d420b479f186c60c47b39fa8))

## [0.17.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.16.0...agent/v0.17.0) (2026-04-11)


### Features

* **tasks:** add general agent task framework with Linux host patching ([#106](https://github.com/carrtech-dev/ct-ops/issues/106)) ([1a6b48a](https://github.com/carrtech-dev/ct-ops/commit/1a6b48a520d5079b61e4b9d71b2e49108f0da44a))
* **tasks:** add general agent task framework with Linux host patching ([#106](https://github.com/carrtech-dev/ct-ops/issues/106)) ([4cd4efa](https://github.com/carrtech-dev/ct-ops/commit/4cd4efa38252ce6fd485b1551936089895493990))

## [0.16.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.15.0...agent/v0.16.0) (2026-04-11)


### Features

* **agent:** auto re-register after host deletion ([b6de1d8](https://github.com/carrtech-dev/ct-ops/commit/b6de1d8caaa45d9285ba64953865ccd7f89a9f00))
* **agent:** auto re-register after host deletion; fix service accounts UI ([1eb533d](https://github.com/carrtech-dev/ct-ops/commit/1eb533d49e332070120f445620d9049ade79758b))

## [0.15.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.14.1...agent/v0.15.0) (2026-04-10)


### Features

* **agent:** add -uninstall flag ([4069a90](https://github.com/carrtech-dev/ct-ops/commit/4069a9032f21c28befd4191a6bdc913e035d840c))
* **agent:** add -uninstall flag to remove agent service and files ([b4f7b5d](https://github.com/carrtech-dev/ct-ops/commit/b4f7b5d12154597a923b7c3f1de53bdbd5005f50))

## [0.14.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.14.0...agent/v0.14.1) (2026-04-10)


### Bug Fixes

* **phase4:** fix migration ordering, metadata overwrite & add password/lock tracking ([96a9fd0](https://github.com/carrtech-dev/ct-ops/commit/96a9fd0ee37292909bea2ac0067ecc1b1903a792))
* **phase4:** fix migration ordering, metadata overwrite & add password/lock tracking ([1e303c2](https://github.com/carrtech-dev/ct-ops/commit/1e303c2ccc69acd0294a27671f71010ef36ef303))

## [0.14.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.13.1...agent/v0.14.0) (2026-04-09)


### Features

* **phase4:** implement service account and SSH key discovery ([a175e9a](https://github.com/carrtech-dev/ct-ops/commit/a175e9a12496c01873cd37683bb584afc367edbd))
* **phase4:** service account and SSH key discovery ([ba4c754](https://github.com/carrtech-dev/ct-ops/commit/ba4c7546fb477c041be2e6d68e7d7c7a825b3c8d))

## [0.13.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.13.0...agent/v0.13.1) (2026-04-09)


### Bug Fixes

* **agent:** make check delivery resilient to stream reconnects and hostID failures ([251455d](https://github.com/carrtech-dev/ct-ops/commit/251455da236c079be0d3074fef69327e57f55dd1))
* **agent:** make check delivery resilient to stream reconnects and hostID resolution failures ([abf93d3](https://github.com/carrtech-dev/ct-ops/commit/abf93d38dccca836e3ebd8dfe5deea68f169c7e9))

## [0.13.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.12.0...agent/v0.13.0) (2026-04-09)


### Features

* **checks:** add cert_file check type and fix cert JSON display ([9ad2882](https://github.com/carrtech-dev/ct-ops/commit/9ad2882b5c76005b5ba5df9b56d90be353bffbcb))
* **checks:** add cert_file check type and fix cert result display ([bcb6cfb](https://github.com/carrtech-dev/ct-ops/commit/bcb6cfb2d8abf210af619efe582fd1747cecfe3c))

## [0.12.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.11.3...agent/v0.12.0) (2026-04-08)


### Features

* **certificates:** implement Phase 3 certificate lifecycle management ([cf6826b](https://github.com/carrtech-dev/ct-ops/commit/cf6826bda93ec09fa7563d787cd4003ead665fd7))
* **certificates:** Phase 3 — certificate lifecycle management ([6de140e](https://github.com/carrtech-dev/ct-ops/commit/6de140e3d1d9eb36b0126c4371945ed92e97f371))

## [0.11.3](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.11.2...agent/v0.11.3) (2026-04-08)


### Bug Fixes

* **agent:** fresh gRPC conn per stream attempt + TCP keepalive ([7426d3e](https://github.com/carrtech-dev/ct-ops/commit/7426d3ec36ac4d391cd7d7b556994850c4878d9a))
* **agent:** gRPC reconnect reliability + heartbeat interval chart ([02baa79](https://github.com/carrtech-dev/ct-ops/commit/02baa79fe7a7cb3b042585b0051e8b4d913879a3))

## [0.11.2](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.11.1...agent/v0.11.2) (2026-04-08)


### Bug Fixes

* **agent:** reset heartbeat backoff after stable stream ([fe139da](https://github.com/carrtech-dev/ct-ops/commit/fe139da63fe058f442d51eec7d26bb93f81b02a4))
* **agent:** reset heartbeat backoff after stable stream ([3a2a68b](https://github.com/carrtech-dev/ct-ops/commit/3a2a68b70190c5ec4a1978acbf8774525eac254c))

## [0.11.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.11.0...agent/v0.11.1) (2026-04-07)


### Bug Fixes

* **agent:** self-update now survives systemd and Restart=always ([18c6d5c](https://github.com/carrtech-dev/ct-ops/commit/18c6d5c969b94cdbdbe1107d6926ebb1c05d7238))
* **agent:** self-update survives systemd (syscall.Exec + Restart=always) ([ef17a26](https://github.com/carrtech-dev/ct-ops/commit/ef17a26f1974cf3ab530aa0097853233201be51b))

## [0.11.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.10.0...agent/v0.11.0) (2026-04-07)


### Features

* agent --version flag, UI version in sidebar, update-available badge ([2e93adf](https://github.com/carrtech-dev/ct-ops/commit/2e93adfcf00094652ab7b3d6d937ead391c43012))
* agent --version flag, UI version in sidebar, update-available badge ([5468ffb](https://github.com/carrtech-dev/ct-ops/commit/5468ffb41241a67824bb558bac4a0e3d0188b38c))

## [0.10.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.9.1...agent/v0.10.0) (2026-04-07)


### Features

* **alerts:** test notifications, edit channels, and SMTP dispatch ([7ff498b](https://github.com/carrtech-dev/ct-ops/commit/7ff498b743aca25228de44fa2d1ad806013f2752))


### Bug Fixes

* **agent,ingest:** add gRPC keepalive to prevent silent stream death ([008aba8](https://github.com/carrtech-dev/ct-ops/commit/008aba85007a0ebd42e0e622389df04587684667))

## [0.9.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.9.0...agent/v0.9.1) (2026-04-07)


### Bug Fixes

* **agent:** reuse HTTP client and reset stream dedup map on reconnect ([8f8e1df](https://github.com/carrtech-dev/ct-ops/commit/8f8e1dfb0a785f00d2d55a00a8c59752f7287822))
* **agent:** reuse HTTP client and reset stream dedup map on reconnect ([b6214ed](https://github.com/carrtech-dev/ct-ops/commit/b6214edbf68bdf0dea2585066fa47948cbd1728b))

## [0.9.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.8.0...agent/v0.9.0) (2026-04-06)


### Features

* **agent:** agent install, TLS, cross-platform builds, and auto-download ([b12296d](https://github.com/carrtech-dev/ct-ops/commit/b12296d9229c0f9d0128c2dd7df9be0378dba609))


### Bug Fixes

* **agent:** build all platform binaries to the correct dist directory ([ce54b74](https://github.com/carrtech-dev/ct-ops/commit/ce54b741429c2822189f14677954e218aea93dc9))

## [0.8.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.7.0...agent/v0.8.0) (2026-04-06)


### Features

* **agent:** add --tls-skip-verify flag to agent install flow ([c6abbdc](https://github.com/carrtech-dev/ct-ops/commit/c6abbdca2d0deaaa4361b5e9b23e863dfab9bb14))
* **agent:** add --tls-skip-verify flag to agent install flow ([ab124d2](https://github.com/carrtech-dev/ct-ops/commit/ab124d2a3e350b01e34119652bac1b6a56e41810))

## [0.7.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.6.0...agent/v0.7.0) (2026-04-06)


### Features

* **checks:** add ad-hoc agent queries for port and service discovery ([dfad656](https://github.com/carrtech-dev/ct-ops/commit/dfad65698a5556140e00a21b9058aec45fc1cf2c))
* **checks:** add ad-hoc agent queries for port and service discovery ([cfafed1](https://github.com/carrtech-dev/ct-ops/commit/cfafed175314e1ed70819a11e9d9420e9e4f2043))

## [0.6.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.5.1...agent/v0.6.0) (2026-04-06)


### Features

* **checks:** add check definition system with port, process, and HTTP checks ([76d0a01](https://github.com/carrtech-dev/ct-ops/commit/76d0a0169e6a659e950b188aee3bf615f59bee26))
* **checks:** add check definition system with port, process, and HTTP checks ([d33c458](https://github.com/carrtech-dev/ct-ops/commit/d33c458c1d759d252fdba0b327f343058eec2e9e))

## [0.5.1](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.5.0...agent/v0.5.1) (2026-04-05)


### Bug Fixes

* **agent,ingest:** populate OS and architecture on hosts ([7cdd25b](https://github.com/carrtech-dev/ct-ops/commit/7cdd25bb2d3d24ca45cab4e44d32f0d3ceaf2cd4))

## [0.5.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.4.0...agent/v0.5.0) (2026-04-05)


### Features

* **agent,ingest,web:** collect real system metrics and add host detail page ([da19fae](https://github.com/carrtech-dev/ct-ops/commit/da19faed79f6ec70c55aa478032710a1a56412ad))
* **agent:** add tls_skip_verify option and improve install config merging ([5ff70a5](https://github.com/carrtech-dev/ct-ops/commit/5ff70a5034a689de56758392049b70416d91792f))

## [0.4.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.3.0...agent/v0.4.0) (2026-04-05)


### Features

* **agent:** multi-platform service install and version-aware binary cache ([b875381](https://github.com/carrtech-dev/ct-ops/commit/b8753813bbbea8be42e332997f9ff2ac1f160996))
* **agent:** server-hosted binaries and agent self-install ([87ba22c](https://github.com/carrtech-dev/ct-ops/commit/87ba22c5c1afaed82ea5f240bc926a52f1d29ea1))

## [0.3.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.2.0...agent/v0.3.0) (2026-04-05)


### Features

* **agent:** one-command install with token and add -token/-address CLI flags ([cd3c228](https://github.com/carrtech-dev/ct-ops/commit/cd3c228954b67d8e85894536eea410e9779a5dff))

## [0.2.0](https://github.com/carrtech-dev/ct-ops/compare/agent/v0.1.0...agent/v0.2.0) (2026-04-04)


### Features

* **agent:** add automated releases, distribution, and self-update ([bc315dc](https://github.com/carrtech-dev/ct-ops/commit/bc315dc429ca2d9f8e9980b138f39108264a5691))
* initial monorepo commit — Phase 0 foundation ([ca9b1f9](https://github.com/carrtech-dev/ct-ops/commit/ca9b1f9c5fcc1edb39cda332f967fde35791bf61))
* Phase 1 — Go agent, gRPC ingest service, and host inventory UI ([ddf5a0a](https://github.com/carrtech-dev/ct-ops/commit/ddf5a0a7fcdbc1e514ad5c9126260c5feed314c2))
