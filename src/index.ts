import { FixtureServer } from './fixture-server';

import { types, parse } from 'hls-parser';
// import fs from 'fs';
import { promises as fs } from 'fs';
import { MasterPlaylist, MediaPlaylist, Segment } from 'hls-parser/types';
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
  const changeCdnSegmentNum = 5;
  mvp.variants.forEach(async variant => {
    console.log(`variant url is ${variant.uri}`);
    const mediaPl = parse((await fs.readFile(`${streamPath}/${variant.uri}`)).toString('utf-8')) as MediaPlaylist;
    const segmentsCdn1 = mediaPl.segments.slice(0, changeCdnSegmentNum);
    const segmentsCdn2 = mediaPl.segments.slice(changeCdnSegmentNum, undefined);
    segmentsCdn1.forEach(cdn1Segment => {
      const segmentPath = `${streamPath}/${cdn1Segment.uri}`;
      server.setFixtureFileHeaders(segmentPath, { "x-cdn": "fastly" });
    })
    segmentsCdn2.forEach(cdn2Segment => {
      const segmentPath = `${streamPath}/${cdn2Segment.uri}`;
      server.setFixtureFileHeaders(segmentPath, { "x-cdn": "edgemv"} );
    });
  });
  

  // Just the text files
  server.setFixtureFileResponseTime('file1.txt', 2000);
  server.setFixtureFileResponseBitrate('file2.txt', 256 * 1024);
  server.setFixtureFileHeaders('file2.txt', {
    'X-CDN': "edgemv",
  });

})();