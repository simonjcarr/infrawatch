# Changelog

## [0.8.0](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.7.0...bundle/v0.8.0) (2026-05-13)


### Features

* **web:** add docker container metric charts ([b7f06f3](https://github.com/carrtech-dev/ct-ops/commit/b7f06f397df8809fcf9b003efeb69b42745ffa1e))

## [0.7.0](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.6.0...bundle/v0.7.0) (2026-05-13)


### Features

* **docker:** upload container telemetry batches ([83a9de4](https://github.com/carrtech-dev/ct-ops/commit/83a9de407249a963a35671b647ee6bed7514f006))

## [0.6.0](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.5.0...bundle/v0.6.0) (2026-05-13)


### Features

* **hosts:** add docker containers tab ([#1356](https://github.com/carrtech-dev/ct-ops/issues/1356)) ([145ecd7](https://github.com/carrtech-dev/ct-ops/commit/145ecd7574f8b15e940a0cd0cb5cbd078da6527b))

## [0.5.0](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.4.0...bundle/v0.5.0) (2026-05-12)


### Features

* **ingest:** upsert docker container inventory ([#1353](https://github.com/carrtech-dev/ct-ops/issues/1353)) ([376e81e](https://github.com/carrtech-dev/ct-ops/commit/376e81eab2fd017283bacf8b24b60cbe891d6ded))

## [0.4.0](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.3.0...bundle/v0.4.0) (2026-05-12)


### Features

* **hosts:** display docker runtime status ([#1347](https://github.com/carrtech-dev/ct-ops/issues/1347)) ([f0b0deb](https://github.com/carrtech-dev/ct-ops/commit/f0b0deba7dc054bec74a2a26d7e4c400ac8e63b2))

## [0.3.0](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.2.0...bundle/v0.3.0) (2026-05-12)


### Features

* **ingest:** persist Docker runtime status ([2be7dff](https://github.com/carrtech-dev/ct-ops/commit/2be7dfffce5f70d67cd983fb7e0c31027dfb9683))

## [0.2.0](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.1.7...bundle/v0.2.0) (2026-05-12)


### Features

* **proto:** add Docker telemetry contract ([6801f46](https://github.com/carrtech-dev/ct-ops/commit/6801f46f201cde6eb901f8784f440174d2f7ae1d))
* **proto:** add Docker telemetry contract ([3a5251b](https://github.com/carrtech-dev/ct-ops/commit/3a5251b11d4d15c9a75c60a19756684628d65639))

## [0.1.7](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.1.6...bundle/v0.1.7) (2026-05-12)


### Bug Fixes

* **ansible:** scope ping logs by host name ([f13561f](https://github.com/carrtech-dev/ct-ops/commit/f13561f2ada5dcc3cf72a712acf42ebdd43db486))

## [0.1.6](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.1.5...bundle/v0.1.6) (2026-05-12)


### Bug Fixes

* **automation:** hide ansible controls when disabled ([0250e35](https://github.com/carrtech-dev/ct-ops/commit/0250e35d0b799781343fbe3f669c4c6f27e00236))

## [0.1.5](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.1.4...bundle/v0.1.5) (2026-05-12)


### Bug Fixes

* **upgrade:** avoid self-overwriting running script ([7cb15a6](https://github.com/carrtech-dev/ct-ops/commit/7cb15a679ceaa4283e83d1be42dbf8ee7656392c))

## [0.1.4](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.1.3...bundle/v0.1.4) (2026-05-12)


### Bug Fixes

* **web:** remove auth secrets from Docker build args ([#1329](https://github.com/carrtech-dev/ct-ops/issues/1329)) ([e91baf7](https://github.com/carrtech-dev/ct-ops/commit/e91baf7867e7196d34821f97bfc1bfbeb7213d1c))

## [0.1.3](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.1.2...bundle/v0.1.3) (2026-05-12)


### Bug Fixes

* **bundle:** verify ansible profile image pin ([1db8184](https://github.com/carrtech-dev/ct-ops/commit/1db8184f0ca834b40ff349fbfdffa1ac3d82501e))

## [0.1.2](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.1.1...bundle/v0.1.2) (2026-05-12)


### Bug Fixes

* **bundle:** resolve released image version tags ([68dd07c](https://github.com/carrtech-dev/ct-ops/commit/68dd07c1d72a8c04979c55b9a69133abc881f2ba))

## [0.1.1](https://github.com/carrtech-dev/ct-ops/compare/bundle/v0.1.0...bundle/v0.1.1) (2026-05-12)


### Bug Fixes

* **ansible-api:** report hostnames in ping output ([1af0cb6](https://github.com/carrtech-dev/ct-ops/commit/1af0cb6a933e6adf2cb9d83b6221343b0265af4c)), closes [#1316](https://github.com/carrtech-dev/ct-ops/issues/1316)
* **ansible:** scope ping output per host ([96ea431](https://github.com/carrtech-dev/ct-ops/commit/96ea4312e502862cf19ed0ae93b4b133060b364c))
* **bundle:** release customer bundle independently ([026dbdb](https://github.com/carrtech-dev/ct-ops/commit/026dbdbc563df20154320148083579e19bffcad7))
