# Overkill

Overkill is a test authoring and runner toolkit for explicit, composable test
trees.

Install the standard distribution:

```sh
npm install -D @overkill-dev/test
```

The `@overkill-dev/test` package ships the public `overkill` binary and the
default authoring facade. See
[`source/packages/test/readme.md`](source/packages/test/readme.md) for the
quickstart and package surface.

Repository tests run through the published `@overkill-dev/run` package. The
`#test-runner` package import resolves it from this repository's dependencies,
including for package smoke tests with their own installed packages. Test files
continue to import source modules for the code under test.
