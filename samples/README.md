# samples

This folder contains real fixture files used by resolver tests and other integration-style checks.

## Sample Files

### Local Exports (`exports/`)
- `sample-export.ts` - Basic export used by resolve tests
- `sample-class.ts` - Class with public methods/properties
- `sample-functions.ts` - Function exports
- `sample-complex-types.ts` - Complex type definitions
- `sample-dependencies.ts` - Dependencies for import tests
- `sample-default-export.ts` - Default export patterns
- `sample-namespace.ts` - Namespace exports
- `sample-re-export.ts` - Re-export patterns
- `sample-type-alias.ts` - Type aliases vs interfaces

### Imports (`imports/`)
- `sample.ts` - Basic import examples
- `imported.ts` - File with symbols to import
- `multipleImports.ts` - Multiple import statements
- `complex-sample.ts` - Complex import patterns

### Type Checking (`check/`)
- `error.ts` - File with type errors
- `ok.ts` - File without errors

### Mock node_modules (`node_modules/`)
Test fixtures for testing node_modules resolution without real dependencies:

- `simple-package/` - Basic package with `types` field in package.json
- `@scoped/package/` - Scoped package (@scope/name)
- `complex-exports/` - Package with modern `exports` field
- `no-types/` - Package without type definitions (error case)

## Usage

- Tests in this repository should read from and search real files in `samples/` rather than using mocked file fixtures.
- The `samples/node_modules/` structure allows testing various package.json export patterns without installing real packages.
