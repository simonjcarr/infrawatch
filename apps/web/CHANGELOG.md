# Changelog

## [0.61.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.60.0...web/v0.61.0) (2026-04-21)


### Features

* **licence:** add LICENCE_PUBLIC_KEY env var override with dev-key-in-prod rejection ([26c65fc](https://github.com/carrtech-dev/ct-ops/commit/26c65fc93712861f921896a137dc42d05f82f273)), closes [#399](https://github.com/carrtech-dev/ct-ops/issues/399)
* **licence:** LICENCE_PUBLIC_KEY env var override with dev-key-in-prod rejection ([b7af559](https://github.com/carrtech-dev/ct-ops/commit/b7af5593b4797544a7d018933da5fba72c7cd97a))


### Bug Fixes

* **auth:** always include BETTER_AUTH_URL in trustedOrigins ([a78d927](https://github.com/carrtech-dev/ct-ops/commit/a78d9271a3fa19e64afee10a51e2b77fd52f1fe3))
* **auth:** always include BETTER_AUTH_URL in trustedOrigins ([5ab0388](https://github.com/carrtech-dev/ct-ops/commit/5ab0388bec181e02884e62206d1b1c15b401794d))
* **certs:** bound upload size and require PEM format in trackCertificateFromUpload ([b7fdb85](https://github.com/carrtech-dev/ct-ops/commit/b7fdb85c5d973bd9b99cf956eb86cd720c886d34)), closes [#342](https://github.com/carrtech-dev/ct-ops/issues/342)
* **reports:** use tab prefix for CSV formula-injection mitigation (M-23) ([588d073](https://github.com/carrtech-dev/ct-ops/commit/588d0730eba862f1e738897b2cd2b009a74d639d)), closes [#338](https://github.com/carrtech-dev/ct-ops/issues/338)

## [0.60.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.59.2...web/v0.60.0) (2026-04-20)


### Features

* **tasks:** add cron-driven scheduled task runner ([#456](https://github.com/carrtech-dev/ct-ops/issues/456)) ([deee1cc](https://github.com/carrtech-dev/ct-ops/commit/deee1cc2fc26f6d5dd6b31acec78ecbdff45641a))


### Bug Fixes

* **certificates:** drop SHA1 fingerprint from cert checker ([3765bad](https://github.com/carrtech-dev/ct-ops/commit/3765bad368a184d5103f8e797c3bf2eb97d6726a))
* **certificates:** drop SHA1 fingerprint from cert checker ([#348](https://github.com/carrtech-dev/ct-ops/issues/348)) ([4ae8106](https://github.com/carrtech-dev/ct-ops/commit/4ae8106310a6c318cea208d3b43a1897f88cbd02))
* **security:** constant-time comparison for admin key + cert fingerprint ([740f489](https://github.com/carrtech-dev/ct-ops/commit/740f48942554cf8470d4cd569705efdfc8b77001))
* **security:** constant-time comparison for admin key + cert fingerprint ([#352](https://github.com/carrtech-dev/ct-ops/issues/352)) ([245eacd](https://github.com/carrtech-dev/ct-ops/commit/245eacd68ec4176df4c97787176f53eef057a1fb))

## [0.59.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.59.1...web/v0.59.2) (2026-04-19)


### Bug Fixes

* **web:** satisfy react-hooks purity / set-state-in-effect rules ([49225a9](https://github.com/carrtech-dev/ct-ops/commit/49225a9b4e924eaced3be47ccb431743bc062917))
* **web:** satisfy react-hooks purity / set-state-in-effect rules ([0940029](https://github.com/carrtech-dev/ct-ops/commit/0940029f041923f76b5a7687c454188440f50087))

## [0.59.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.59.0...web/v0.59.1) (2026-04-19)


### Bug Fixes

* **notes:** visibility toggle label wraps and overlaps tabs ([6e7ef1c](https://github.com/carrtech-dev/ct-ops/commit/6e7ef1c7c630ed0facac6dd0e11c6447a7887e11))

## [0.59.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.58.0...web/v0.59.0) (2026-04-19)


### Features

* **notes:** host detail integration (PR 3) ([e876237](https://github.com/carrtech-dev/ct-ops/commit/e876237b1e06452190596cf0174af95b34ffea6e))
* **notes:** host detail integration (PR 3) ([f1b3b9a](https://github.com/carrtech-dev/ct-ops/commit/f1b3b9a0921cfe3082a28e56a233b811453a8bb1))

## [0.58.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.57.1...web/v0.58.0) (2026-04-19)


### Features

* **licence:** bind licences to install via activation token ([41a912e](https://github.com/carrtech-dev/ct-ops/commit/41a912e8c7252b33ad8489817dcd6e10275a08a2))
* **licence:** bind licences to install via activation token ([7a5d03c](https://github.com/carrtech-dev/ct-ops/commit/7a5d03cf784a414f52bb2f42321f6c82a44168d9))

## [0.57.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.57.0...web/v0.57.1) (2026-04-19)


### Bug Fixes

* **licence:** align issuer and audience across sign and verify paths ([314c1c9](https://github.com/carrtech-dev/ct-ops/commit/314c1c98725a1a79a5c6aee9ce0fafeb7b50ef10))
* **licence:** align issuer/audience between sign and verify ([43bf32c](https://github.com/carrtech-dev/ct-ops/commit/43bf32c8b0146473abd09db15cbda06f15139208))

## [0.57.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.56.0...web/v0.57.0) (2026-04-19)


### Features

* **licence:** bake production public key into the web image ([66703a9](https://github.com/carrtech-dev/ct-ops/commit/66703a9affec2030ec625eb161af1a89e3aa01a9))
* **licence:** bake production public key into the web image ([f96a813](https://github.com/carrtech-dev/ct-ops/commit/f96a8130a6bd83b09b36b6a1d2751baa39dc1b92))


### Bug Fixes

* **db:** make 0037 migration idempotent for domain_accounts.deleted_at ([8dbfadf](https://github.com/carrtech-dev/ct-ops/commit/8dbfadfc97f087baaca4c99118a7c31d22ce2eaf))
* **db:** make migration 0037 idempotent for domain_accounts.deleted_at ([b001797](https://github.com/carrtech-dev/ct-ops/commit/b0017973e2fac02695aadab3dd0b3bb7d597ec26))

## [0.56.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.55.1...web/v0.56.0) (2026-04-19)


### Features

* **web:** add Cmd+K command palette scaffold ([f6c7273](https://github.com/carrtech-dev/ct-ops/commit/f6c72739fbd4117f312cd1581df46f39cdd63620))

## [0.55.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.55.0...web/v0.55.1) (2026-04-18)


### Bug Fixes

* **security:** add auth/org check to deleteCertificate ([#281](https://github.com/carrtech-dev/ct-ops/issues/281)) ([48bbbd1](https://github.com/carrtech-dev/ct-ops/commit/48bbbd1dddead1248efa31baaae2fabcdf21cd1b))
* **security:** add auth/org check to deleteCertificate (C-09) ([60a8a16](https://github.com/carrtech-dev/ct-ops/commit/60a8a161d0bb22971534f13a811ce263349ea03c))

## [0.55.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.54.1...web/v0.55.0) (2026-04-18)


### Features

* **notes:** data layer for shared engineer notes ([e3b12ed](https://github.com/carrtech-dev/ct-ops/commit/e3b12ed7c69978fcc25334f92f1315647e115d01))
* **notes:** data layer for shared engineer notes (PR 2) ([5515967](https://github.com/carrtech-dev/ct-ops/commit/55159674adc07c049b7d7a5e6ce5a6e5d68b3d6b))

## [0.54.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.54.0...web/v0.54.1) (2026-04-18)


### Bug Fixes

* correct docs base path and rename simonjcarr/infrawatch to carrtech-dev/ct-ops ([1a5dc35](https://github.com/carrtech-dev/ct-ops/commit/1a5dc35ab6941759e0c495d12678021ffb381ae9))
* correct docs base path and replace simonjcarr/infrawatch references ([349eacd](https://github.com/carrtech-dev/ct-ops/commit/349eacde1db368f02234726bb6a075f2082c1d75))

## [0.54.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.53.0...web/v0.54.0) (2026-04-18)


### Features

* paginate, filter, sort hosts page and add fleet overview ([6a4d604](https://github.com/carrtech-dev/ct-ops/commit/6a4d604a61d53a6bfbc253f05e30c6cae44f5ffe))
* paginate, filter, sort hosts page and add fleet overview ([1390de4](https://github.com/carrtech-dev/ct-ops/commit/1390de47a7034fb63ced3b10aff03c8d2c9873fe))


### Bug Fixes

* move filter-reset setState out of useEffect ([d6b7ddb](https://github.com/carrtech-dev/ct-ops/commit/d6b7ddb89992bdeafd6f98d613ddd82928d45b53))

## [0.53.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.52.0...web/v0.53.0) (2026-04-18)


### Features

* split host Tools tabs so Tasks shows only user-triggered runs ([d8335e7](https://github.com/carrtech-dev/ct-ops/commit/d8335e7083192091c3909aea2fe924ecb7e91fd5))

## [0.52.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.51.0...web/v0.52.0) (2026-04-18)


### Features

* enforce Pro/Enterprise licence gates on certificates, service accounts, and reports ([4c653ba](https://github.com/carrtech-dev/ct-ops/commit/4c653ba8451fac2ec0f37a3950e76d39c19fd2c2))
* enforce Pro/Enterprise licence gates on certs, service accounts, and reports ([86151d9](https://github.com/carrtech-dev/ct-ops/commit/86151d94f40e4f52675f78388e1b76018dd34fa4))

## [0.51.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.50.0...web/v0.51.0) (2026-04-18)


### Features

* expand licence tier model with feature flags, guard, and docs ([3ff4665](https://github.com/carrtech-dev/ct-ops/commit/3ff4665d59bbe12823f7923759cba5f876da6da1))
* expand licence tier model with feature flags, guard, and docs ([a38810c](https://github.com/carrtech-dev/ct-ops/commit/a38810ce3f053278a24986f9fefc09e7029363eb))
* tag assignment for hosts (settings, enrolment, CLI, bulk rules) ([ddf5b16](https://github.com/carrtech-dev/ct-ops/commit/ddf5b168df16741b8a545f8f367882c28089b46a))
* tag assignment for hosts across settings, enrolment, CLI, and bulk rules ([58cf0cd](https://github.com/carrtech-dev/ct-ops/commit/58cf0cdc66a8a87311f870f0ef58136bfcb98b6d))


### Bug Fixes

* use next/link for Bulk Tag cross-reference on Tag Rules page ([f4865f3](https://github.com/carrtech-dev/ct-ops/commit/f4865f325526033ecd9705b95c90a0ca6fed381c))

## [0.50.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.49.0...web/v0.50.0) (2026-04-18)


### Features

* infrawatch-loadtest tool for capacity planning ([fef4da8](https://github.com/carrtech-dev/ct-ops/commit/fef4da8d4316096e279063973671010f9a4ad9cb))
* infrawatch-loadtest tool for capacity planning ([993d2c8](https://github.com/carrtech-dev/ct-ops/commit/993d2c808bbfdc969059e2ffe2bc961672f1ade1))

## [0.49.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.48.0...web/v0.49.0) (2026-04-18)


### Features

* **certificates:** track certificates from the Certificate Checker ([d8dcdfa](https://github.com/carrtech-dev/ct-ops/commit/d8dcdfa8091e7e3fc382b0c4c062f986e0d49d62))
* **certificates:** track certificates from the Certificate Checker ([e5eaf8a](https://github.com/carrtech-dev/ct-ops/commit/e5eaf8a669a5ff842046204f63afefa1f57b4945))

## [0.48.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.47.0...web/v0.48.0) (2026-04-18)


### Features

* certificate checker — paste + drag-drop for certs and keys ([1a9f828](https://github.com/carrtech-dev/ct-ops/commit/1a9f8286374613960b12dc48a93f8c27eade0d2e))
* certificate checker — paste + drag-drop for certs and keys ([f4070ef](https://github.com/carrtech-dev/ct-ops/commit/f4070ef512a5afb528c575c1f797044ff503d217))

## [0.47.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.46.0...web/v0.47.0) (2026-04-18)


### Features

* add SSL certificate checker tool ([082d372](https://github.com/carrtech-dev/ct-ops/commit/082d3724feb2649db40577ce98d52aef427ba7a7))
* **ingest:** dedupe host registrations by hostname / IP overlap ([8e34db9](https://github.com/carrtech-dev/ct-ops/commit/8e34db919dadf05a29d7b2701a7df73cca7a9f3d))
* SSL certificate checker tool ([8853991](https://github.com/carrtech-dev/ct-ops/commit/88539910c436631596a4048e8411aad3298608df))


### Bug Fixes

* read enrolment URL from AGENT_DOWNLOAD_BASE_URL env var ([b3fed72](https://github.com/carrtech-dev/ct-ops/commit/b3fed72ddd6da6b50791148b17ce199fe6675f70))
* use NEXT_PUBLIC_APP_URL for agent enrolment install URL ([295e27c](https://github.com/carrtech-dev/ct-ops/commit/295e27cc66ff4f52e817ec90b6130d5cd242d7d3))
* use NEXT_PUBLIC_APP_URL for agent enrolment install URL ([66de4a8](https://github.com/carrtech-dev/ct-ops/commit/66de4a810b493fa61c3ad37ca7d49d975a79dd39))

## [0.46.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.45.0...web/v0.46.0) (2026-04-17)


### Features

* download agents as zip for offline/manual install ([ae060f9](https://github.com/carrtech-dev/ct-ops/commit/ae060f9fdab891e2f4fc1693fbcadf646d8c5a73))
* download agents as zip for offline/manual install ([7df1f04](https://github.com/carrtech-dev/ct-ops/commit/7df1f04bfd16be0a1adb953e43bbaa99dd61945e)), closes [#244](https://github.com/carrtech-dev/ct-ops/issues/244)

## [0.45.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.44.2...web/v0.45.0) (2026-04-17)


### Features

* group filter always visible and humanise LDAP timestamps ([75e53fe](https://github.com/carrtech-dev/ct-ops/commit/75e53fea94c68c87f6141155c9fb0253b9ec3e4c))
* group filter always visible and humanise LDAP timestamps ([07235c2](https://github.com/carrtech-dev/ct-ops/commit/07235c25b4f66c479bd91128267b05f103f4df12))


### Bug Fixes

* portal directory-lookup suggestions out of card overflow ([b5b874e](https://github.com/carrtech-dev/ct-ops/commit/b5b874e08473ef0ad68535ee340350248eca0cc1))
* portal directory-lookup suggestions out of card overflow ([38d8063](https://github.com/carrtech-dev/ct-ops/commit/38d8063005bacbd702d0a95d45bb61151bf217b8))

## [0.44.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.44.1...web/v0.44.2) (2026-04-17)


### Bug Fixes

* disable set-state-in-effect rule for one-shot hydration effect ([9630a11](https://github.com/carrtech-dev/ct-ops/commit/9630a113b1bd2fb4fdd9b11d39f9fd0131533e8a))
* hydrate terminal panel state after mount to avoid SSR mismatch ([48f9ed2](https://github.com/carrtech-dev/ct-ops/commit/48f9ed257a6da35759a166798414f6a6c332952f))
* terminal panel hydration mismatch breaking dashboard interactivity ([e255a9a](https://github.com/carrtech-dev/ct-ops/commit/e255a9a114d527f6f49e2b2ea6a5d750dd07cf5c))

## [0.44.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.44.0...web/v0.44.1) (2026-04-17)


### Bug Fixes

* surface server-action errors in directory lookup ([1698e91](https://github.com/carrtech-dev/ct-ops/commit/1698e917ac90e4755ec1ac935c032df687456649))
* surface server-action errors in directory lookup typeahead ([5fe5ea0](https://github.com/carrtech-dev/ct-ops/commit/5fe5ea0413fe9232cca5b97a0748dfb6e803a24c))

## [0.44.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.43.0...web/v0.44.0) (2026-04-17)


### Features

* directory user lookup (live LDAP query, no sync) ([b96037d](https://github.com/carrtech-dev/ct-ops/commit/b96037dcd3d59b1426d99a86d9fba5e4944a7247))
* directory user lookup (live LDAP query, no sync) ([dd954ca](https://github.com/carrtech-dev/ct-ops/commit/dd954ca62dcb34d766343bf6008fc5634eafbd91))

## [0.43.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.42.0...web/v0.43.0) (2026-04-17)


### Features

* terminal text size settings (global + per-tab) ([4332aab](https://github.com/carrtech-dev/ct-ops/commit/4332aab64e855638ef027c8891f68a0a13f04e08))
* terminal text size settings (global default + per-tab override) ([11635d4](https://github.com/carrtech-dev/ct-ops/commit/11635d4b60f07b25f93264c4697ab061954489c1))

## [0.42.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.41.3...web/v0.42.0) (2026-04-17)


### Features

* add tab colours, reorder, rename, and split panes to terminal ([f5f7df9](https://github.com/carrtech-dev/ct-ops/commit/f5f7df9e35dff10d9d7e670e75cd37ffe6bc1438))
* tab colours, reorder, rename, and split panes for terminal ([9c464d9](https://github.com/carrtech-dev/ct-ops/commit/9c464d979143aa54d41ebf5a8a66fb91fe1f2741))

## [0.41.3](https://github.com/carrtech-dev/ct-ops/compare/web/v0.41.2...web/v0.41.3) (2026-04-16)


### Bug Fixes

* avoid setState-in-effect lint error in HostNodeTerminalDialog ([9e9f374](https://github.com/carrtech-dev/ct-ops/commit/9e9f374725dc5fd4bb072e88a9b0368fb420e929))
* move terminal dialog to parent to survive context menu unmount ([6696382](https://github.com/carrtech-dev/ct-ops/commit/66963827013f517bba74d39ef8cf8f8c85fb1839))
* Open Terminal from network graph context menu now works ([667f100](https://github.com/carrtech-dev/ct-ops/commit/667f1002832bcacfea42cfbe9a95a4e11db2eddc))

## [0.41.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.41.1...web/v0.41.2) (2026-04-16)


### Bug Fixes

* restore pointer-events on host nodes for context menu to work ([a16c20a](https://github.com/carrtech-dev/ct-ops/commit/a16c20ab10d03fd6a8ed0b86a3b6968e04b507e2))
* restore pointer-events on host nodes so right-click context menu works ([ac14b8e](https://github.com/carrtech-dev/ct-ops/commit/ac14b8ea42a3545f064cd110293587c57aca4188))

## [0.41.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.41.0...web/v0.41.1) (2026-04-16)


### Bug Fixes

* switch network graph context menu to onNodeContextMenu approach ([3f3946d](https://github.com/carrtech-dev/ct-ops/commit/3f3946d7f8209f1e3293919f93617279790db2f6))
* switch network graph context menu to React Flow onNodeContextMenu ([be8392f](https://github.com/carrtech-dev/ct-ops/commit/be8392f2bf58bc414bad2c0c18cfb5dfcee5c0c1))

## [0.41.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.40.0...web/v0.41.0) (2026-04-16)


### Features

* add right-click context menu to network graph host nodes ([eb8dfdf](https://github.com/carrtech-dev/ct-ops/commit/eb8dfdfe01fdc80bd8b63016f05fdb6ebb87c5f7))
* add right-click context menu to network graph host nodes ([d7a2fa8](https://github.com/carrtech-dev/ct-ops/commit/d7a2fa883a38cfe7e4996c0430402371d4ad124d))

## [0.40.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.39.0...web/v0.40.0) (2026-04-16)


### Features

* replace moving circles with subtle dashed bezier edge animation ([e219ea7](https://github.com/carrtech-dev/ct-ops/commit/e219ea752f07aeed0ea21cbc479b62660e14958a))
* subtle dashed bezier edges on network graphs ([ee56359](https://github.com/carrtech-dev/ct-ops/commit/ee563595ef1c4f098577953dd72ffbc6297f7992))

## [0.39.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.38.0...web/v0.39.0) (2026-04-16)


### Features

* add animated flowing dots to network graph edges ([08c5f22](https://github.com/carrtech-dev/ct-ops/commit/08c5f227f49f14735992ded0034d90a7db49e7a4))
* animated flowing dots on network graph edges ([bc0edf5](https://github.com/carrtech-dev/ct-ops/commit/bc0edf5c105cb9bdfdda4a25f556ceaca2a95b68))


### Bug Fixes

* make React Flow controls and minimap respect dark mode ([ac27713](https://github.com/carrtech-dev/ct-ops/commit/ac27713ce8fcc10ef4db3aaac58b9f68d85b0fad))

## [0.38.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.37.0...web/v0.38.0) (2026-04-16)


### Features

* add network topology graph visualizations ([9543b4b](https://github.com/carrtech-dev/ct-ops/commit/9543b4b9bd8aadf69c57e05b1fb0fbe2a29590c9))
* add network topology graph visualizations ([e42213e](https://github.com/carrtech-dev/ct-ops/commit/e42213e3e5d5efcbaf8d50238dcc52764ecb7880))

## [0.37.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.36.2...web/v0.37.0) (2026-04-16)


### Features

* add network management with CIDR-based auto-assignment ([2be6169](https://github.com/carrtech-dev/ct-ops/commit/2be6169160455ebdc122fb72b87c59e1e2a288f4))
* add network management with CIDR-based auto-assignment ([0550654](https://github.com/carrtech-dev/ct-ops/commit/05506543b9195f176d4634661545893410d003fa))

## [0.36.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.36.1...web/v0.36.2) (2026-04-15)


### Bug Fixes

* **reports:** sliding window rate limit (3/10s), errors in modal ([54001af](https://github.com/carrtech-dev/ct-ops/commit/54001af9fe08ebbffe913c5872c687084a8d5de4))
* **reports:** sliding window rate limit (3/10s), fix error message, show errors in modal ([52d2c1d](https://github.com/carrtech-dev/ct-ops/commit/52d2c1d7cd25c88ec0f2ca0851a8a608d1c85589))

## [0.36.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.36.0...web/v0.36.1) (2026-04-15)


### Bug Fixes

* **reports:** chart labels visible in dark mode, reduce export rate limit ([31d0a0d](https://github.com/carrtech-dev/ct-ops/commit/31d0a0dcd7b467c4ed54af4bd95ccea9b69e23a0))
* **reports:** chart labels visible in dark mode, reduce export rate limit to 10s ([f1eadce](https://github.com/carrtech-dev/ct-ops/commit/f1eadce213c3f199dae15633dce8fb824b5641c0))

## [0.36.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.35.1...web/v0.36.0) (2026-04-15)


### Features

* **reports:** add first-seen column, OS/version charts, and fix export data ([83ecf13](https://github.com/carrtech-dev/ct-ops/commit/83ecf13ca5854d874962fa558a4498edcdc6f498))
* **reports:** first-seen column, OS/version charts, and fix export data ([dc12bd9](https://github.com/carrtech-dev/ct-ops/commit/dc12bd95f31d5853f6c0876ec9a9fc17a7e49858))

## [0.35.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.35.0...web/v0.35.1) (2026-04-15)


### Bug Fixes

* **reports:** clickable hostnames and fix CSV/PDF export ([b17e619](https://github.com/carrtech-dev/ct-ops/commit/b17e619e6faf337441f047c8fb6bf3ee185372f8))
* **reports:** make hostnames clickable and fix CSV/PDF export parameters ([6843695](https://github.com/carrtech-dev/ct-ops/commit/68436951d3f784a48dee5177dd317eec03cde777))

## [0.35.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.34.6...web/v0.35.0) (2026-04-15)


### Features

* **reports:** unify software search results into a single sortable table ([1ae7c42](https://github.com/carrtech-dev/ct-ops/commit/1ae7c42f4e28267484db5eec7396e8b02c78eda3))
* **reports:** unify software search results into single sortable table ([5ad70bb](https://github.com/carrtech-dev/ct-ops/commit/5ad70bb7a627d0ee022b3f8ba2cd0c8295748806))

## [0.34.6](https://github.com/carrtech-dev/ct-ops/compare/web/v0.34.5...web/v0.34.6) (2026-04-15)


### Bug Fixes

* **agents:** delete software_scans before task_run_hosts in deleteHost ([1b95ee4](https://github.com/carrtech-dev/ct-ops/commit/1b95ee405a691575c6b1845e59f09d2a8afe7ed5))
* **agents:** delete software_scans before task_run_hosts in deleteHost cascade ([f6c9217](https://github.com/carrtech-dev/ct-ops/commit/f6c9217c46e9f5aa4bf0dcb6592577666681bdeb))

## [0.34.5](https://github.com/carrtech-dev/ct-ops/compare/web/v0.34.4...web/v0.34.5) (2026-04-15)


### Bug Fixes

* **agents:** complete deleteHost FK cascade for all referencing tables ([7faea5a](https://github.com/carrtech-dev/ct-ops/commit/7faea5a71509351e142463221cb95af46020f7fb))
* **agents:** complete deleteHost FK cascade for all referencing tables ([c6dcb2a](https://github.com/carrtech-dev/ct-ops/commit/c6dcb2a39524d96ecee0819b42909daf4af0297b))

## [0.34.4](https://github.com/carrtech-dev/ct-ops/compare/web/v0.34.3...web/v0.34.4) (2026-04-15)


### Bug Fixes

* **agents:** delete notifications before alert_instances when deleting host ([fd0e78d](https://github.com/carrtech-dev/ct-ops/commit/fd0e78d9d926f1325175bd849421598f9c7546dc))
* **agents:** delete notifications before alert_instances when deleting host ([4a38216](https://github.com/carrtech-dev/ct-ops/commit/4a382164aac8a533977189129afd43da0fa9e17e))

## [0.34.3](https://github.com/carrtech-dev/ct-ops/compare/web/v0.34.2...web/v0.34.3) (2026-04-15)


### Bug Fixes

* **ingest:** persist JWT signing key in database to survive volume resets ([385caa2](https://github.com/carrtech-dev/ct-ops/commit/385caa2ea5318d949924d1a88c2aafbda9bdaaa9))
* **ingest:** persist JWT signing key in database to survive volume resets ([661d2a3](https://github.com/carrtech-dev/ct-ops/commit/661d2a39e5043f5d8d8df467819256977734fc00))

## [0.34.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.34.1...web/v0.34.2) (2026-04-15)


### Bug Fixes

* **inventory:** surface failed scan errors in host inventory tab ([cb94381](https://github.com/carrtech-dev/ct-ops/commit/cb94381c37a90a9971c87a574baac8a4abe72596))
* **inventory:** surface failed scan errors in host inventory tab ([26b9095](https://github.com/carrtech-dev/ct-ops/commit/26b90956413f93ebd22d4a472419115cc9caa7a9))

## [0.34.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.34.0...web/v0.34.1) (2026-04-15)


### Bug Fixes

* **inventory:** poll for scan completion and show live scan status ([7276799](https://github.com/carrtech-dev/ct-ops/commit/7276799540e0c5c6ca8e63b6045102bbb02f4772))
* **inventory:** poll for scan completion and show live scan status ([8f7eae3](https://github.com/carrtech-dev/ct-ops/commit/8f7eae30101028c98810182e3b5e25c96a48610b))

## [0.34.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.33.3...web/v0.34.0) (2026-04-15)


### Features

* **reports:** overhaul software report UX and fix inventory wipe bug ([19167fe](https://github.com/carrtech-dev/ct-ops/commit/19167fe7906d44e987bd6119c34b4a66697d333c))
* **reports:** overhaul software report UX and fix inventory wipe bug ([4f49c92](https://github.com/carrtech-dev/ct-ops/commit/4f49c927d4daea923a0c772e4f01d6032f94d6a9))

## [0.33.3](https://github.com/carrtech-dev/ct-ops/compare/web/v0.33.2...web/v0.33.3) (2026-04-14)


### Bug Fixes

* **monitoring:** eliminate false 100% CPU spikes and fix alert double-evaluation ([01e7146](https://github.com/carrtech-dev/ct-ops/commit/01e71469ae1d4040f4f5da99bd7532ce4c477322))
* **monitoring:** eliminate false 100% CPU spikes and fix alert double-evaluation ([4e6ca6a](https://github.com/carrtech-dev/ct-ops/commit/4e6ca6af9018eedd0f2d53c6b50ff70e3053f259))

## [0.33.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.33.1...web/v0.33.2) (2026-04-14)


### Bug Fixes

* **reports:** use sentinel for "All sources" Select value ([423694f](https://github.com/carrtech-dev/ct-ops/commit/423694fb94ef362c146e73d181e5c66e03177079))
* **reports:** use sentinel for "All sources" Select value ([d1efd71](https://github.com/carrtech-dev/ct-ops/commit/d1efd712e9c7f456719194f50d85a5222b517592))

## [0.33.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.33.0...web/v0.33.1) (2026-04-14)


### Bug Fixes

* **reports:** remove dead useDebounce hook and fix React fragment key ([1802104](https://github.com/carrtech-dev/ct-ops/commit/1802104819e1a869383a4a3dcbcd47eb2cc55270))
* **reports:** remove dead useDebounce hook and fix React fragment keys ([923b4b7](https://github.com/carrtech-dev/ct-ops/commit/923b4b7c20bff1c65acd95ab659fe6d1b81901be))

## [0.33.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.32.0...web/v0.33.0) (2026-04-14)


### Features

* **software-inventory:** full software inventory and reporting feature ([e98cf6f](https://github.com/carrtech-dev/ct-ops/commit/e98cf6fb030a9f3900358f352179b43128b98761))
* **software-inventory:** installed software tracking, global reports, and export ([903e772](https://github.com/carrtech-dev/ct-ops/commit/903e77247ae4041ed9471f649c4bd603c9509c68))

## [0.32.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.31.1...web/v0.32.0) (2026-04-14)


### Features

* **hosts:** remote agent uninstall on host deletion ([0613f6c](https://github.com/carrtech-dev/ct-ops/commit/0613f6ce238cefd999183bc59851632bbdc42b78))
* **hosts:** remote agent uninstall on host deletion ([8b3fe3d](https://github.com/carrtech-dev/ct-ops/commit/8b3fe3d7f03a07ee99da727ed046795be8e5e56f))

## [0.31.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.31.0...web/v0.31.1) (2026-04-14)


### Bug Fixes

* **terminal:** pin terminal panel to bottom of viewport ([8c648cc](https://github.com/carrtech-dev/ct-ops/commit/8c648cc37af1c48251ddee56e69bc73a6861a471))
* **terminal:** pin terminal panel to bottom of viewport ([4e532e1](https://github.com/carrtech-dev/ct-ops/commit/4e532e1c27a0f8847cd22021d8e66107734334b9))

## [0.31.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.30.0...web/v0.31.0) (2026-04-13)


### Features

* **hosts:** add notification severity and trend charts to metrics tab ([e009d6c](https://github.com/carrtech-dev/ct-ops/commit/e009d6c8c10c10e34073778304968de895f7d407))
* **hosts:** notification severity and trend charts on metrics tab ([271df68](https://github.com/carrtech-dev/ct-ops/commit/271df684725ef3f80b2d5dd04e084477b52c6ee6))

## [0.30.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.29.1...web/v0.30.0) (2026-04-13)


### Features

* **notifications:** add time-range selector to notification trend chart ([04c2392](https://github.com/carrtech-dev/ct-ops/commit/04c23929c2ef4066efd9a83f052c1a91290e2753))
* **notifications:** time-range selector on notification trend chart ([40e8b96](https://github.com/carrtech-dev/ct-ops/commit/40e8b96e5e6a054b73b485b892fb56ab1e75c417))

## [0.29.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.29.0...web/v0.29.1) (2026-04-13)


### Bug Fixes

* **notifications:** soft-delete notifications and fix chart axis label colours ([1508afb](https://github.com/carrtech-dev/ct-ops/commit/1508afbc2d49c0123fc7a77ce6f5c05bae94c79c))
* **notifications:** soft-delete notifications and fix chart axis label colours ([5742c30](https://github.com/carrtech-dev/ct-ops/commit/5742c30d975d2793f910e41ade217eb7a4b93855))

## [0.29.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.28.0...web/v0.29.0) (2026-04-13)


### Features

* **notifications:** add bulk actions, charts, and mark-unread support ([31a956f](https://github.com/carrtech-dev/ct-ops/commit/31a956f8e41b6b7045afa3d6bed509753fabae4e))
* **notifications:** bulk actions, severity charts, and mark-unread support ([25671ef](https://github.com/carrtech-dev/ct-ops/commit/25671efb36d72ec0f6cfd28226e675a83465cdb9))

## [0.28.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.27.0...web/v0.28.0) (2026-04-13)


### Features

* **notifications:** add Slack, Telegram, and in-app notification channels ([69c00ff](https://github.com/carrtech-dev/ct-ops/commit/69c00ff0d6937befff9c7da3a3a019582df395cf))
* **notifications:** Slack, Telegram, and in-app notification channels ([6bc5799](https://github.com/carrtech-dev/ct-ops/commit/6bc579968babac3881c6abe8c5c0b1b266667217))

## [0.27.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.26.0...web/v0.27.0) (2026-04-13)


### Features

* **terminal:** remember last username and reconnect on exit ([33711ea](https://github.com/carrtech-dev/ct-ops/commit/33711eaf3e43cf41db95b49c901e643383871c88))
* **terminal:** remember last username and reconnect on exit ([167b83a](https://github.com/carrtech-dev/ct-ops/commit/167b83a85e98cc4189bd90f6bab9d28c5a1ba404))


### Bug Fixes

* **terminal:** use useMemo instead of useEffect for saved username ([f5ff889](https://github.com/carrtech-dev/ct-ops/commit/f5ff8899df68a7cfa52f6e43d3f393ac08a5aad4))

## [0.26.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.25.1...web/v0.26.0) (2026-04-13)


### Features

* **terminal:** persist tabs across browser refresh ([a8b3dc3](https://github.com/carrtech-dev/ct-ops/commit/a8b3dc31c1b4df94427804f0d4ce2a6080915fea))
* **terminal:** persist tabs across browser refresh via sessionStorage ([94da926](https://github.com/carrtech-dev/ct-ops/commit/94da9266ebc81bbb640d74ecdf82b9534eb50d31))

## [0.25.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.25.0...web/v0.25.1) (2026-04-13)


### Bug Fixes

* **terminal:** move provider above sidebar for context access ([f465ff3](https://github.com/carrtech-dev/ct-ops/commit/f465ff3bb79570067fec8456913af25e40e10994))
* **terminal:** move TerminalPanelProvider above sidebar so trigger has context ([2bf71c6](https://github.com/carrtech-dev/ct-ops/commit/2bf71c624632a6c33634fa92656cc76fe0683bd7))

## [0.25.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.24.0...web/v0.25.0) (2026-04-13)


### Features

* **terminal:** persistent bottom panel with tabs ([67aad5d](https://github.com/carrtech-dev/ct-ops/commit/67aad5da8982cef5b61f35170556bf064e3a5bf3))
* **terminal:** redesign as persistent bottom panel with tabs ([1031bfd](https://github.com/carrtech-dev/ct-ops/commit/1031bfd8f707508cee73c02c8dd3db9824ceef56))


### Bug Fixes

* **terminal:** resolve lint errors for setState-in-effect and unused vars ([ca5e9fe](https://github.com/carrtech-dev/ct-ops/commit/ca5e9fe86dae719276257091dc21e20215928326))

## [0.24.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.23.3...web/v0.24.0) (2026-04-13)


### Features

* **terminal:** require per-user host authentication ([8539f5d](https://github.com/carrtech-dev/ct-ops/commit/8539f5d450f713e474ec0001ca834ff41b57ab36))
* **terminal:** require per-user host authentication for terminal sessions ([5a51c21](https://github.com/carrtech-dev/ct-ops/commit/5a51c21e97bf1c8c5edfff295aedfb2320b244a8))

## [0.23.3](https://github.com/carrtech-dev/ct-ops/compare/web/v0.23.2...web/v0.23.3) (2026-04-12)


### Bug Fixes

* **terminal:** add DB session diagnostics for agent connection debugging ([fbf89b9](https://github.com/carrtech-dev/ct-ops/commit/fbf89b9acd8becd505e8f582641f41444fdee87f))
* **terminal:** add real-time session diagnostics to trace agent connection failure ([6bb458e](https://github.com/carrtech-dev/ct-ops/commit/6bb458e615d14dc8f1f66f0121f98cb1f73374c2))

## [0.23.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.23.1...web/v0.23.2) (2026-04-12)


### Bug Fixes

* **terminal:** add agent connection signaling and diagnostic messages ([ae7183f](https://github.com/carrtech-dev/ct-ops/commit/ae7183f9861af42921ee3b37f12bf80edc991e21))
* **terminal:** add agent connection signaling and diagnostics ([c4549e5](https://github.com/carrtech-dev/ct-ops/commit/c4549e5d41f7484302f2632f1c95fd8b05d9fd1c))

## [0.23.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.23.0...web/v0.23.1) (2026-04-12)


### Bug Fixes

* **terminal:** show xterm container during connecting state to fix 0x0 dimensions ([e40f6d6](https://github.com/carrtech-dev/ct-ops/commit/e40f6d6784d3037feb8e747439c35097673e5f94))
* **terminal:** show xterm container during connecting to fix 0x0 PTY ([48032dc](https://github.com/carrtech-dev/ct-ops/commit/48032dced6c0fe0152cea59f2ac1d4581e2dddcb))

## [0.23.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.22.0...web/v0.23.0) (2026-04-12)


### Features

* **terminal:** add WebSocket terminal and restructure host page tabs ([8313aa4](https://github.com/carrtech-dev/ct-ops/commit/8313aa4b05811a5cff994a8532531426fb2c14ae))
* **terminal:** add WebSocket terminal and restructure host page tabs ([71d37d3](https://github.com/carrtech-dev/ct-ops/commit/71d37d3dde252fa5d2494a2d4d77c385d9255b30))

## [0.22.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.21.0...web/v0.22.0) (2026-04-12)


### Features

* **tasks:** add service autocomplete, interactive terminal, and task history management ([6246d21](https://github.com/carrtech-dev/ct-ops/commit/6246d2145488f9be2f13ff7df6c6e5930b2d4d8f))
* **tasks:** service autocomplete, interactive terminal, and task history management ([b2601a1](https://github.com/carrtech-dev/ct-ops/commit/b2601a133b6539fbc956a7bd99645fdc514d4e6d))


### Bug Fixes

* **terminal:** replace useEffect setState with setInterval callback to satisfy react-hooks/set-state-in-effect ([3ac45f6](https://github.com/carrtech-dev/ct-ops/commit/3ac45f6c5b43be5b8f8f17d5efc9059972fb8694))

## [0.21.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.20.0...web/v0.21.0) (2026-04-12)


### Features

* **tasks:** add custom script runner and service management task types ([50c5eaa](https://github.com/carrtech-dev/ct-ops/commit/50c5eaaadf6eb7b089d7d46e8a4d3871a88b072f))
* **tasks:** add custom script runner and service management task types ([471baf1](https://github.com/carrtech-dev/ct-ops/commit/471baf1b5a4519e7ab99218a847dc6cd88726b23))

## [0.20.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.19.0...web/v0.20.0) (2026-04-12)


### Features

* **metrics:** add chart zoom and smart metrics bucketing ([73db515](https://github.com/carrtech-dev/ct-ops/commit/73db515b24540a3767e188e9badc9b073e4a14c9))
* **metrics:** add chart zoom and smart metrics bucketing ([07b12cd](https://github.com/carrtech-dev/ct-ops/commit/07b12cda4c32c4e63fd32042590caff4c5827afd))

## [0.19.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.18.0...web/v0.19.0) (2026-04-11)


### Features

* **profile:** add dark mode with per-user theme preference ([065b7b3](https://github.com/carrtech-dev/ct-ops/commit/065b7b38d4a336a46108d3e4c3c2672658ebe9e5))
* **profile:** add dark mode with per-user theme preference ([ad01296](https://github.com/carrtech-dev/ct-ops/commit/ad012966aeac57873897c1e23679353adb8c17a2))

## [0.18.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.17.1...web/v0.18.0) (2026-04-11)


### Features

* **tasks:** add task cancellation with agent-side process kill and UI ([017e9e0](https://github.com/carrtech-dev/ct-ops/commit/017e9e078230d99b998657591eb4af00d32a0a75))
* **tasks:** add task cancellation with agent-side process kill and UI ([81315a1](https://github.com/carrtech-dev/ct-ops/commit/81315a1bd00e04871928ad28a171c0abef30578b))

## [0.17.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.17.0...web/v0.17.1) (2026-04-11)


### Bug Fixes

* **tasks:** resolve patch output deadlock, add timeouts and debug UI ([74a9a87](https://github.com/carrtech-dev/ct-ops/commit/74a9a874a6b8cca954729dcb1342632d84d2e757))
* **tasks:** resolve patch output deadlock, add timeouts and debug UI ([7bfd4f8](https://github.com/carrtech-dev/ct-ops/commit/7bfd4f8a40c45317d420b479f186c60c47b39fa8))

## [0.17.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.16.0...web/v0.17.0) (2026-04-11)


### Features

* **tasks:** add general agent task framework with Linux host patching ([#106](https://github.com/carrtech-dev/ct-ops/issues/106)) ([1a6b48a](https://github.com/carrtech-dev/ct-ops/commit/1a6b48a520d5079b61e4b9d71b2e49108f0da44a))
* **tasks:** add general agent task framework with Linux host patching ([#106](https://github.com/carrtech-dev/ct-ops/issues/106)) ([4cd4efa](https://github.com/carrtech-dev/ct-ops/commit/4cd4efa38252ce6fd485b1551936089895493990))

## [0.16.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.15.0...web/v0.16.0) (2026-04-11)


### Features

* **hosts:** add host groups with strategic collapsible nav ([#105](https://github.com/carrtech-dev/ct-ops/issues/105)) ([d75cf5e](https://github.com/carrtech-dev/ct-ops/commit/d75cf5ece2f2797a4897abcfd1aeb37e2ab93948))
* **hosts:** host groups + strategic collapsible nav ([#105](https://github.com/carrtech-dev/ct-ops/issues/105)) ([5883273](https://github.com/carrtech-dev/ct-ops/commit/58832734061a61c5cb63425abc43bdfbdb06b899))

## [0.15.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.14.3...web/v0.15.0) (2026-04-11)


### Features

* **agents:** add copy actions to enrollment token list ([14bd87e](https://github.com/carrtech-dev/ct-ops/commit/14bd87e226b3b32a532fa2dba539730f87c3ce94))
* **agents:** add copy actions to enrollment token list ([#101](https://github.com/carrtech-dev/ct-ops/issues/101)) ([c850aa8](https://github.com/carrtech-dev/ct-ops/commit/c850aa8b6e2da6d56692453d4cd8ae9189e2e8ca))

## [0.14.3](https://github.com/carrtech-dev/ct-ops/compare/web/v0.14.2...web/v0.14.3) (2026-04-11)


### Bug Fixes

* **ldap:** cap TLS certificate preview at 5 lines with vertical scroll ([17245ca](https://github.com/carrtech-dev/ct-ops/commit/17245cabc52543c90db509778a353c51893599d8))
* **ldap:** cap TLS certificate preview at 5 lines with vertical scroll ([3923409](https://github.com/carrtech-dev/ct-ops/commit/3923409718436f9a5e60efbd8ae80f7752152ccb))

## [0.14.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.14.1...web/v0.14.2) (2026-04-11)


### Bug Fixes

* **ldap:** properly constrain TLS certificate preview within modal ([10103cb](https://github.com/carrtech-dev/ct-ops/commit/10103cb1b0f892f87bddbbb49b35af18d1409790))
* **ldap:** properly constrain TLS certificate preview within modal ([5e70044](https://github.com/carrtech-dev/ct-ops/commit/5e70044ca11b474d4d4f5b4df5e0b2591f564a87)), closes [#92](https://github.com/carrtech-dev/ct-ops/issues/92)

## [0.14.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.14.0...web/v0.14.1) (2026-04-11)


### Bug Fixes

* **ldap:** constrain TLS certificate preview to modal width ([f160e3c](https://github.com/carrtech-dev/ct-ops/commit/f160e3cd9d62817c1a54426cc2bb921acc04b081))
* **ldap:** constrain TLS certificate preview to modal width ([6d76f44](https://github.com/carrtech-dev/ct-ops/commit/6d76f446e3cb3f884f80154a94515c98eb16a70a)), closes [#92](https://github.com/carrtech-dev/ct-ops/issues/92)

## [0.14.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.13.0...web/v0.14.0) (2026-04-11)


### Features

* **agent:** auto re-register after host deletion ([b6de1d8](https://github.com/carrtech-dev/ct-ops/commit/b6de1d8caaa45d9285ba64953865ccd7f89a9f00))
* **agent:** auto re-register after host deletion; fix service accounts UI ([1eb533d](https://github.com/carrtech-dev/ct-ops/commit/1eb533d49e332070120f445620d9049ade79758b))

## [0.13.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.12.2...web/v0.13.0) (2026-04-10)


### Features

* **phase4:** service accounts, LDAP login & identity management ([c5ba9c1](https://github.com/carrtech-dev/ct-ops/commit/c5ba9c1b8ab416aee98ca58eaaed0fc1dbdda7af))

## [0.12.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.12.1...web/v0.12.2) (2026-04-10)


### Bug Fixes

* **ci:** add validate-migrations.js to ESLint ignores and add dev.sh ([8590f9b](https://github.com/carrtech-dev/ct-ops/commit/8590f9b712c7b384bb7cf47d346f2ddccf02dd3e))

## [0.12.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.12.0...web/v0.12.1) (2026-04-10)


### Bug Fixes

* **db:** add migration timestamp validation ([644d265](https://github.com/carrtech-dev/ct-ops/commit/644d26589bc51022cbda5ba91ab2642a46588598))
* **db:** add migration timestamp validation to prevent skipped migrations ([b915029](https://github.com/carrtech-dev/ct-ops/commit/b91502924ddb2b6870098662884ccb70e39bd2c4))

## [0.12.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.11.1...web/v0.12.0) (2026-04-10)


### Features

* **ldap:** add edit dialog for LDAP configs and TLS certificate upload ([6fc619f](https://github.com/carrtech-dev/ct-ops/commit/6fc619f444f917fccf66d6897fc2762cd81343da))
* **phase4:** service accounts, LDAP sync & directory management ([db3ebf6](https://github.com/carrtech-dev/ct-ops/commit/db3ebf68e3d429463c817c5b4af506c0fb4a78f9))

## [0.11.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.11.0...web/v0.11.1) (2026-04-10)


### Bug Fixes

* **phase4:** fix migration ordering, metadata overwrite & add password/lock tracking ([96a9fd0](https://github.com/carrtech-dev/ct-ops/commit/96a9fd0ee37292909bea2ac0067ecc1b1903a792))
* **phase4:** fix migration ordering, metadata overwrite & add password/lock tracking ([1e303c2](https://github.com/carrtech-dev/ct-ops/commit/1e303c2ccc69acd0294a27671f71010ef36ef303))

## [0.11.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.10.1...web/v0.11.0) (2026-04-10)


### Features

* **phase4:** restructure service accounts, add host settings & LDAP login ([da1cc9b](https://github.com/carrtech-dev/ct-ops/commit/da1cc9b1feb8540fe636095506abf50da1453e0e))
* **phase4:** restructure service accounts, add host settings & LDAP login ([cda5150](https://github.com/carrtech-dev/ct-ops/commit/cda515088557a47fe3ba82288be74e702f20bdf1))


### Bug Fixes

* **lint:** use const for existingUser, remove unused TAG_LENGTH ([39e38ba](https://github.com/carrtech-dev/ct-ops/commit/39e38bacbcbd1a0d0ed1c59447a3f5f3b0ebf6f8))

## [0.10.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.10.0...web/v0.10.1) (2026-04-09)


### Bug Fixes

* **db:** bump migration 0014 timestamp to be monotonically after 0013 ([039d084](https://github.com/carrtech-dev/ct-ops/commit/039d0848ed04bf04e2d2a024ce1e8bcf55f188cd))
* **db:** bump migration 0014 timestamp to be monotonically after 0013 ([2ace491](https://github.com/carrtech-dev/ct-ops/commit/2ace491a0bdbf70e4cb7a66adf5c080ada9fe08c))

## [0.10.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.9.0...web/v0.10.0) (2026-04-09)


### Features

* **phase4:** implement service account and SSH key discovery ([a175e9a](https://github.com/carrtech-dev/ct-ops/commit/a175e9a12496c01873cd37683bb584afc367edbd))
* **phase4:** service account and SSH key discovery ([ba4c754](https://github.com/carrtech-dev/ct-ops/commit/ba4c7546fb477c041be2e6d68e7d7c7a825b3c8d))

## [0.9.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.8.4...web/v0.9.0) (2026-04-09)


### Features

* CI pr-checks workflow, system health page, and debt documentation cleanup ([aba140c](https://github.com/carrtech-dev/ct-ops/commit/aba140c0cf605c5dc19b5d2e67e11dbf3bd107ac))
* CI pr-checks, system health page, gen_cuid fix, and PROGRESS.md cleanup ([fc30879](https://github.com/carrtech-dev/ct-ops/commit/fc3087955dc6f176046e2e9c326e0e5d1280d028))


### Bug Fixes

* **ci:** fix all PR Checks lint and Go build failures ([99253fe](https://github.com/carrtech-dev/ct-ops/commit/99253fe298e06b68bac6622be77fa4ff89fa0071))

## [0.8.4](https://github.com/carrtech-dev/ct-ops/compare/web/v0.8.3...web/v0.8.4) (2026-04-09)


### Bug Fixes

* **web:** fix certificate page crashes — server action mismatches and invalid date RangeError ([5c0941b](https://github.com/carrtech-dev/ct-ops/commit/5c0941b059ff92629ef1d2e7ae2ada3a67a2b1cb))
* **web:** fix RangeError in certificate chain dates — Go uses snake_case JSON keys ([4dcd267](https://github.com/carrtech-dev/ct-ops/commit/4dcd267dcdc7c4ff5677f3dba1a58bc95dc1a063))

## [0.8.3](https://github.com/carrtech-dev/ct-ops/compare/web/v0.8.2...web/v0.8.3) (2026-04-09)


### Bug Fixes

* **web:** replace server action queryFns with API routes on certificates pages ([52cb1c5](https://github.com/carrtech-dev/ct-ops/commit/52cb1c56d94118d8c2849edcfee8b89aa649bf30))
* **web:** resolve Failed to find Server Action errors on certificates pages ([7b219e8](https://github.com/carrtech-dev/ct-ops/commit/7b219e86649ee54360352614b44118950a5bd4d4))

## [0.8.2](https://github.com/carrtech-dev/ct-ops/compare/web/v0.8.1...web/v0.8.2) (2026-04-09)


### Bug Fixes

* **web:** stop calling server action from useQuery on certificate detail page ([66b3fd6](https://github.com/carrtech-dev/ct-ops/commit/66b3fd62aadfc0c6b0a081bf03fd68023a35a484))
* **web:** stop calling server action from useQuery on certificate detail page ([e4c8117](https://github.com/carrtech-dev/ct-ops/commit/e4c8117b659b25018210f29d780fc5452af4c555))

## [0.8.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.8.0...web/v0.8.1) (2026-04-09)


### Bug Fixes

* **web:** fix EACCES on agent-dist volume mount ([b098402](https://github.com/carrtech-dev/ct-ops/commit/b098402d7ae85dea0ce4902060cd7da2e495be22))
* **web:** fix EACCES on agent-dist volume mount by using root entrypoint ([909494d](https://github.com/carrtech-dev/ct-ops/commit/909494ddd252feb20a0a2504b0bb94a4c51c208e))

## [0.8.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.7.1...web/v0.8.0) (2026-04-09)


### Features

* **checks:** add cert_file check type and fix cert result display ([bcb6cfb](https://github.com/carrtech-dev/ct-ops/commit/bcb6cfb2d8abf210af619efe582fd1747cecfe3c))

## [0.7.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.7.0...web/v0.7.1) (2026-04-08)


### Bug Fixes

* **ci:** track agent-dist dir so Docker COPY succeeds in CI ([15ee866](https://github.com/carrtech-dev/ct-ops/commit/15ee86647f43adcdb40ab6053539630791208d9b))
* **ci:** track agent-dist dir so Docker COPY succeeds in CI ([288291d](https://github.com/carrtech-dev/ct-ops/commit/288291d92299b051bf8102ebf722f02b71ca9188))

## [0.7.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.6.1...web/v0.7.0) (2026-04-08)


### Features

* **web:** add certificate check type to Add Check dialog ([64e1192](https://github.com/carrtech-dev/ct-ops/commit/64e1192e1b854689181042aaef95842123a9fad0))
* **web:** add certificate check type to Add Check dialog ([42f8ea3](https://github.com/carrtech-dev/ct-ops/commit/42f8ea30fc2b62d72a735a48ad2fb37c45c780c3))

## [0.6.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.6.0...web/v0.6.1) (2026-04-08)


### Bug Fixes

* **web:** agent self-update 503 — baked fallback + manifest version sync ([42a2626](https://github.com/carrtech-dev/ct-ops/commit/42a262603154e2aac3c8e0ce314b68a7eb29099a))
* **web:** agent self-update 503 — baked fallback + manifest version sync ([1a5670d](https://github.com/carrtech-dev/ct-ops/commit/1a5670d8ebc0c4cdc71c891d923bc53e56135709))

## [0.6.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.5.1...web/v0.6.0) (2026-04-08)


### Features

* **certificates:** implement Phase 3 certificate lifecycle management ([cf6826b](https://github.com/carrtech-dev/ct-ops/commit/cf6826bda93ec09fa7563d787cd4003ead665fd7))
* **certificates:** Phase 3 — certificate lifecycle management ([6de140e](https://github.com/carrtech-dev/ct-ops/commit/6de140e3d1d9eb36b0126c4371945ed92e97f371))

## [0.5.1](https://github.com/carrtech-dev/ct-ops/compare/web/v0.5.0...web/v0.5.1) (2026-04-08)


### Bug Fixes

* **web:** use ISO string for Date params in db.execute() raw SQL queries ([822d9df](https://github.com/carrtech-dev/ct-ops/commit/822d9df890631b93e41fd890d0011b53340df5db))
* **web:** use ISO string for Date params in db.execute() raw SQL queries ([78bf7d1](https://github.com/carrtech-dev/ct-ops/commit/78bf7d150c6a25fbf4f625fcd576f1cf1166bc6e))

## [0.5.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.4.0...web/v0.5.0) (2026-04-08)


### Features

* **web:** heartbeat interval chart on host metrics tab ([270d79c](https://github.com/carrtech-dev/ct-ops/commit/270d79c3ffcd45731cdb567d9604dc132519a779))


### Bug Fixes

* **agent:** gRPC reconnect reliability + heartbeat interval chart ([02baa79](https://github.com/carrtech-dev/ct-ops/commit/02baa79fe7a7cb3b042585b0051e8b4d913879a3))

## [0.4.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.3.0...web/v0.4.0) (2026-04-08)


### Features

* **phase2:** alert history pagination, TimescaleDB CAGGs, metric retention ([63f5676](https://github.com/carrtech-dev/ct-ops/commit/63f56762aa70985f4741faa9ee4dd017ffb0791e))
* **phase2:** alert history pagination, TimescaleDB CAGGs, metric retention ([ac5ff93](https://github.com/carrtech-dev/ct-ops/commit/ac5ff93138a2c556efd098e55650383dd0c983bd))

## [0.3.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.2.0...web/v0.3.0) (2026-04-07)


### Features

* **dist:** customer bundle + hardcoded agent repo + first-run start.sh ([d055a59](https://github.com/carrtech-dev/ct-ops/commit/d055a59e9096dcee6358078d72e3697bf0965ece))
* **dist:** customer bundle, hardcoded agent repo, first-run start.sh ([711cd04](https://github.com/carrtech-dev/ct-ops/commit/711cd04b05cb49bff3c99273040a1aea956d3906))

## [0.2.0](https://github.com/carrtech-dev/ct-ops/compare/web/v0.1.0...web/v0.2.0) (2026-04-07)


### Features

* agent --version flag, UI version in sidebar, update-available badge ([2e93adf](https://github.com/carrtech-dev/ct-ops/commit/2e93adfcf00094652ab7b3d6d937ead391c43012))
* agent --version flag, UI version in sidebar, update-available badge ([5468ffb](https://github.com/carrtech-dev/ct-ops/commit/5468ffb41241a67824bb558bac4a0e3d0188b38c))
* **agent,ingest,web:** collect real system metrics and add host detail page ([da19fae](https://github.com/carrtech-dev/ct-ops/commit/da19faed79f6ec70c55aa478032710a1a56412ad))
* **agent:** add --tls-skip-verify flag to agent install flow ([c6abbdc](https://github.com/carrtech-dev/ct-ops/commit/c6abbdca2d0deaaa4361b5e9b23e863dfab9bb14))
* **agent:** add --tls-skip-verify flag to agent install flow ([ab124d2](https://github.com/carrtech-dev/ct-ops/commit/ab124d2a3e350b01e34119652bac1b6a56e41810))
* **agent:** add automated releases, distribution, and self-update ([bc315dc](https://github.com/carrtech-dev/ct-ops/commit/bc315dc429ca2d9f8e9980b138f39108264a5691))
* **agent:** agent install, TLS, cross-platform builds, and auto-download ([b12296d](https://github.com/carrtech-dev/ct-ops/commit/b12296d9229c0f9d0128c2dd7df9be0378dba609))
* **agent:** multi-platform service install and version-aware binary cache ([b875381](https://github.com/carrtech-dev/ct-ops/commit/b8753813bbbea8be42e332997f9ff2ac1f160996))
* **agent:** one-command install with token and add -token/-address CLI flags ([cd3c228](https://github.com/carrtech-dev/ct-ops/commit/cd3c228954b67d8e85894536eea410e9779a5dff))
* **agent:** pin required agent version and auto-download on startup ([dd037af](https://github.com/carrtech-dev/ct-ops/commit/dd037afc82a4e07fe1c908bfeae533e042acd9cc))
* **agent:** server-hosted binaries and agent self-install ([87ba22c](https://github.com/carrtech-dev/ct-ops/commit/87ba22c5c1afaed82ea5f240bc926a52f1d29ea1))
* **alerts:** host silencing + fix migration runner skipping pending entries ([460bf0c](https://github.com/carrtech-dev/ct-ops/commit/460bf0c8534ea65f468847c73d54f95867fd9c45))
* **alerts:** test notifications, edit channels, and SMTP dispatch ([7ff498b](https://github.com/carrtech-dev/ct-ops/commit/7ff498b743aca25228de44fa2d1ad806013f2752))
* **alerts:** test notifications, edit channels, and SMTP dispatch ([bcd42fb](https://github.com/carrtech-dev/ct-ops/commit/bcd42fb02234d9a35c1357c6599d1c4d60a26af9))
* **checks:** add ad-hoc agent queries for port and service discovery ([dfad656](https://github.com/carrtech-dev/ct-ops/commit/dfad65698a5556140e00a21b9058aec45fc1cf2c))
* **checks:** add ad-hoc agent queries for port and service discovery ([cfafed1](https://github.com/carrtech-dev/ct-ops/commit/cfafed175314e1ed70819a11e9d9420e9e4f2043))
* **checks:** add check definition system with port, process, and HTTP checks ([76d0a01](https://github.com/carrtech-dev/ct-ops/commit/76d0a0169e6a659e950b188aee3bf615f59bee26))
* **checks:** add check definition system with port, process, and HTTP checks ([d33c458](https://github.com/carrtech-dev/ct-ops/commit/d33c458c1d759d252fdba0b327f343058eec2e9e))
* initial monorepo commit — Phase 0 foundation ([ca9b1f9](https://github.com/carrtech-dev/ct-ops/commit/ca9b1f9c5fcc1edb39cda332f967fde35791bf61))
* **metrics:** metric history, TimescaleDB hypertable, and offline chart visualisation ([c5081dc](https://github.com/carrtech-dev/ct-ops/commit/c5081dc1ffcda46924cf9eb1ca0405edc9d8c5e4))
* **metrics:** persist metric history and add chart with offline visualisation ([bc2b3d9](https://github.com/carrtech-dev/ct-ops/commit/bc2b3d93ec1aececcddc705930897c1279bf7e2f))
* Phase 0 — user profiles, settings, team management, and feature gating ([585998c](https://github.com/carrtech-dev/ct-ops/commit/585998ca9f02b83e82c527904e605c4601beb01c))
* Phase 1 — Go agent, gRPC ingest service, and host inventory UI ([ddf5a0a](https://github.com/carrtech-dev/ct-ops/commit/ddf5a0a7fcdbc1e514ad5c9126260c5feed314c2))
* **web:** add SMTP email notification channel for alert rules ([2003bfa](https://github.com/carrtech-dev/ct-ops/commit/2003bfa74117f602c450b45499c2ec3394adf650))
* **web:** add SSE streaming and host detail real-time updates ([3f823b3](https://github.com/carrtech-dev/ct-ops/commit/3f823b34511e034e3724433e6947b8eb3a6355cd))
* **web:** alert rule builder, state machine, and webhook notifications ([94f1509](https://github.com/carrtech-dev/ct-ops/commit/94f150936822dd0d8f8899ac05844e017a5ddc21))
* **web:** alert rules, notifications, and global alert defaults ([89926ce](https://github.com/carrtech-dev/ct-ops/commit/89926ce84df39b75beb5a7a8dbfd22a1cf793ee0))
* **web:** global alert defaults that auto-apply to new hosts on agent approval ([c60cad9](https://github.com/carrtech-dev/ct-ops/commit/c60cad9baec6b9a6332abb63ce7f0cf4b6c5ab53))
* **web:** prewarm agent binary cache on server startup ([8eae9d8](https://github.com/carrtech-dev/ct-ops/commit/8eae9d8ed04ec38c22269fc75e21c9d336ec1260))
* **web:** SSE streaming and host detail real-time updates ([704c738](https://github.com/carrtech-dev/ct-ops/commit/704c738d73b53a72d65e2b3988817d282916a39d))


### Bug Fixes

* add standalone-compatible migration script for Docker deployments ([6c56773](https://github.com/carrtech-dev/ct-ops/commit/6c56773c8939f120f04b9c67391e2441dbdb83b1))
* add workspace node_modules/.bin to PATH in builder stage ([dbab3a3](https://github.com/carrtech-dev/ct-ops/commit/dbab3a340ae1318316b0a3a568aeb3520ed4f1b2))
* **agent:** derive required agent version from release-please manifest ([5e97869](https://github.com/carrtech-dev/ct-ops/commit/5e97869ce9318c10151e8181d65275ed59a04fc5))
* **agent:** update required agent version to v0.9.0 ([833ad8d](https://github.com/carrtech-dev/ct-ops/commit/833ad8d9e45006122dfdbda17f5416208c0359ee))
* **checks:** remove type exports from 'use server' file causing ReferenceError ([90939f2](https://github.com/carrtech-dev/ct-ops/commit/90939f2bbe355572ce732e4ecd347e921e77b500))
* **checks:** remove type exports from 'use server' file causing ReferenceError ([26285e8](https://github.com/carrtech-dev/ct-ops/commit/26285e8dd4634b4545436ecd1d7b1376cf8c8e91))
* copy apps/web/node_modules from deps stage into builder ([2db1423](https://github.com/carrtech-dev/ct-ops/commit/2db14234b881d2600b811b10983ad2bc93c19a92))
* copy workspace config into builder stage so pnpm resolves node_modules ([f957fbf](https://github.com/carrtech-dev/ct-ops/commit/f957fbfb211246df8c82320e585e9110e7135a62))
* correct both Dockerfiles for monorepo workspace builds ([1485264](https://github.com/carrtech-dev/ct-ops/commit/1485264f918ef79556903675160217201c957a96))
* correct standalone paths for pnpm monorepo in web Dockerfile ([075f144](https://github.com/carrtech-dev/ct-ops/commit/075f144926934525039ed78d150589c663d5c042))
* **team:** restore soft-deleted users on re-invite instead of re-registering ([f29bb96](https://github.com/carrtech-dev/ct-ops/commit/f29bb96f56a9befdd9e8f9b00c5894b084a053c5))
* use monorepo root context for web Docker build ([a3500b2](https://github.com/carrtech-dev/ct-ops/commit/a3500b2e6edc778c064e9de46fb73a1d40629dfa))
* **web:** remove instrumentationHook from next.config (built-in since Next.js 15) ([f1bea56](https://github.com/carrtech-dev/ct-ops/commit/f1bea5604b09170ede385df393e5aa5c95c9208c))
