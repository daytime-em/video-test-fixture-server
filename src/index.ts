import { FixtureServer } from './fixture-server';

import { types, parse } from 'hls-parser';
// import fs from 'fs';
import { promises as fs } from 'fs';

const port = 3000;
const server = new FixtureServer({ port: port});

(async () => {
  await server.listen();
  console.log(`Fixture server running at http://localhost:${port}`);

  // Set up a fake CDN Change
  const mvp = parse((await fs.readFile('mux-promo/stream.m3u8')).toString('utf8'));
  

  // Just the text files
  server.setFixtureFileResponseTime('file1.txt', 2000);
  server.setFixtureFileResponseBitrate('file2.txt', 256 * 1024);
  server.setFixtureFileHeaders('file2.txt', {
    'X-CDN': "edgemv",
  });

})();