import { fixtureSegmentPath } from './fixture-paths';
import { FixtureServer } from './fixture-server';

const port = 3000;
const server = new FixtureServer({ port: port});

(async () => {
  await server.listen();
  console.log(`Fixture server running at http://localhost:${port}`);

  // Set up a faked CDN Change
  server.setFixtureFileHeaders(
    fixtureSegmentPath('mux-promo', 'stream_0', 0),
    { 'x-cdn': 'fastly' }
  );

  // Just the text files
  server.setFixtureFileResponseTime('file1.txt', 2000);
  server.setFixtureFileResponseBitrate('file2.txt', 256 * 1024);
  server.setFixtureFileHeaders('file2.txt', {
    'X-CDN': "edgemv",
  });

})();