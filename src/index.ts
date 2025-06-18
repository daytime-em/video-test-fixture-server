import { FixtureServer } from './fixture-server';

import { types, parse } from 'hls-parser';
// import fs from 'fs';
import { promises as fs } from 'fs';
import { MasterPlaylist } from 'hls-parser/types';
import path from 'path';

const port = 3000;
const server = new FixtureServer({ port: port});
const FILES_DIR = path.join(__dirname, 'files');

(async () => {
  await server.listen();
  console.log(`Fixture server running at http://localhost:${port}`);

  // Set up a fake CDN Change
  const streamName = "mux-promo"
  const streamPath = `${FILES_DIR}/${streamName}`
  const mvp = parse((await fs.readFile(`${streamPath}/stream.m3u8`)).toString('utf8')) as MasterPlaylist;
  mvp.variants.forEach(async variant => {
    console.log(`variant url is ${variant.uri}`);
  });
  

  // Just the text files
  server.setFixtureFileResponseTime('file1.txt', 2000);
  server.setFixtureFileResponseBitrate('file2.txt', 256 * 1024);
  server.setFixtureFileHeaders('file2.txt', {
    'X-CDN': "edgemv",
  });

})();