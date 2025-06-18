import { FixtureServer } from './fixture-server';

const server = new FixtureServer({ port: 3000 });

(async () => {
  await server.listen();
  console.log('Fixture server running at http://localhost:3000');

  // Just the text files
  server.setFixtureFileResponseTime('file1.txt', 2000);
  server.setFixtureFileResponseBitrate('file2.txt', 256 * 1024);
  server.setFixtureFileHeaders('file2.txt', {
    'X-CDN': "edgemv",
  });

})();