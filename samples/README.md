# samples

This folder contains real fixture files used by resolver tests and other integration-style checks.

- `sample-export.ts` exposes a local symbol used by `tests/resolveLocalExport.test.ts`.
- Tests in this repository should read from and search real files in `samples/` rather than using mocked file fixtures.
