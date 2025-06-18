import { FixtureServer } from './fixture-server';

const server = new FixtureServer({ port: 3000 });

(async () => {
  await server.listen();
  console.log('Fixture server running at http://localhost:3000');

  // Usage examples:
  server.setFixtureFileResponseTime('file1.txt', 2000);
  server.setFixtureFileResponseBitrate('file4.txt', 256 * 1024);
  server.setFixtureFileHeaders('file4.txt', {
    'X-CDN': "edgemv",
  });
  server.setFixtureFileHeaders('file1.txt', { 'X-Demo-Header': 'example', 'Content-Language': 'en' });
  server.setFixtureFileHeaders('file2.txt', { 'Cache-Control': 'no-store' });

})();