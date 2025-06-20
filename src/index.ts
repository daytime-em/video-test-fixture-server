import { FixtureServer } from './fixture-server';

import { parse } from 'hls-parser';
// import fs from 'fs';
import { promises as fs } from 'fs';
import { MasterPlaylist, MediaPlaylist } from 'hls-parser/types';
import path from 'path';
import { parseFixtureStream } from './fixtures';

const port = 3000;
const FILES_DIR = path.join(__dirname, 'files');
const server = new FixtureServer({ port: port, basedir: FILES_DIR});

(async () => {
  await server.listen();
  console.log(`Fixture server running at http://localhost:${port}`);

  // Set up fake CDN change
  const fixtureStream = await parseFixtureStream("mux-promo")
  console.log(`Parsed fixture stream ${fixtureStream.streamName} at ${fixtureStream.playlistFile.relativePath}`);
  console.log(`Parsed Variant ${fixtureStream.variants[0].playlistFile.relativePath}`);
  const cdn1Segments = fixtureStream.variants[0].segmentsInTimeRange(0, 20);
  const cdn2Segments = fixtureStream.variants[0].segmentsInTimeRange(20, 30);
  cdn1Segments?.forEach(it => server.setFixtureFileHeaders(
    it.segmentFile.relativePath, { "x-cdn" : "fastly" }
  ));
  cdn2Segments?.forEach(it => server.setFixtureFileHeaders(
    it.segmentFile.relativePath, { "x-cdn" : "edgemv" }
  ));
  
  // Just the text files
  server.setFixtureFileResponseTime('file1.txt', 2000);
  server.setFixtureFileResponseBitrate('file2.txt', 256 * 1024);
  server.setFixtureFileHeaders('file2.txt', {
    'X-CDN': "edgemv",
  });

})();
