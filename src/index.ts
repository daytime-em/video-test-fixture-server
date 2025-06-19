import { FixtureServer } from './fixture-server';

import { parse } from 'hls-parser';
// import fs from 'fs';
import { promises as fs } from 'fs';
import { MasterPlaylist, MediaPlaylist } from 'hls-parser/types';
import path from 'path';

const port = 3000;
const server = new FixtureServer({ port: port});
const FILES_DIR = path.join(__dirname, 'files');

(async () => {
  await server.listen();
  console.log(`Fixture server running at http://localhost:${port}`);

  // todo - doesn't work because the config keys are relative paths
  // todo - fix by moving this kind of think into the fixture server
  // Set up a fake CDN Change
  const streamName = "mux-promo"
  const streamPath = `${FILES_DIR}/${streamName}`
  const mvp = parse((await fs.readFile(`${streamPath}/stream.m3u8`)).toString('utf8')) as MasterPlaylist;
  const changeCdnSegmentNum = 2;
  mvp.variants.forEach(async variant => {
    const mediaPl = parse((await fs.readFile(`${streamPath}/${variant.uri}`)).toString('utf-8')) as MediaPlaylist;
    const segmentsCdn1 = mediaPl.segments.slice(0, changeCdnSegmentNum);
    const segmentsCdn2 = mediaPl.segments.slice(changeCdnSegmentNum, undefined);
    segmentsCdn1.forEach(cdn1Segment => {
      const segmentPath = `${streamPath}/${path.dirname(variant.uri)}/${cdn1Segment.uri}`;
      console.log(`setting headers for segment at ${segmentPath}`);
      server.setFixtureFileHeaders(segmentPath, { "x-cdn": "fastly" });
    })
    segmentsCdn2.forEach(cdn2Segment => {
      const segmentPath = `${streamPath}/${path.dirname(variant.uri)}/${cdn2Segment.uri}`;
      console.log(`setting headers for segment at ${segmentPath}`);
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