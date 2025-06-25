# test-fixture-server

Serves media files for testing players. You can customize responses using a rule system, and create additional routes to the same media with unique rules

## How to use

```shell
# or package manager of your choice
yarn install

yarn dev
```

## How to configure

The server must be configured in code. You can clone routes and add rules to an instance of `FixtureServer` in index.ts.

### Referencing the test streams

The `fixtures` module provides methods for finding and parsing the media files that comprise the test streams.

```typescript
const fixtureStream = await parseFixtureStream("blue-moon")
console.log(`Stream has ${fixtureStream.variants.length} variants`);
fixtureStream.variants.forEach((it, index) => {
  console.log(`Variant ${index} has ${it.segments.length} segments`);
});
```

### Adding Rules

By default, we try to serve the fixture files as-is, with no changes. If you want to customize response behavior, you can add rules to a `FixtureServer`

```typescript
// custom header and throttled response time for each segment
const fixtureStream = await parseFixtureStream("blue-moon")
fixtureStream.variants.forEach((variant) => {
  variant.forEach(segment => {
    server.requestSucceeds(segment.segmentFile.route, { 
      headers: { "my-custom-header": "my-custom-value" },
      responseTimeMs: 5000
    })
  });
});
```

### Cloning routes

You can create new routes to media that have their own rules

```typescript
// Original stream can be used, but cloned stream will have an error
const fixtureStream = await parseFixtureStream("blue-moon")
const clonedStream = server.cloneRoute(fixtureStream.playlistFile.route, "blue-moon-fails");
server.requestFails(clonedStream.playlistFile.route, {
  statusLine: { code: 503, message: "Temporarily Unavailable" },
  errorBody: "A fake error occurred for testing"
 });
```

## Adding Assets

You can add assets to the server by adding them to `resources/files`

There's a script, `scripts/create-basic-fixture-from-file.sh` that will create a simple HLS stream with 3 levels based on an mp4 file you choose. You can customize that script, or you can make your own for more-complex cases.

### Stream files and GitHub

Be careful. GitHub has a maximum size per-commit, so for long streams you may have trouble pushing if you commit all your segments at once. This is a huge pain, and I wasn't able to find a way around it. Sorry.
