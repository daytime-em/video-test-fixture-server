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
  const fixtureStream = await parseFixtureStream("blue-moon")
  console.log(`Parsed fixture stream ${fixtureStream.streamName} at ${fixtureStream.playlistFile.relativePath}`);
  console.log(`Parsed Variant ${fixtureStream.variants[0].playlistFile.relativePath}`);
  const cdn1Segments = fixtureStream.variants[0].segmentsInTimeRange(0, 75);
  const cdn2Segments = fixtureStream.variants[0].segmentsInTimeRange(75);
  cdn1Segments?.forEach(it => server.requestSucceeds(
    it.segmentFile.relativePath, { headers: { "x-cdn" : "fastly" } }
  ));
  cdn2Segments?.forEach(it => server.requestSucceeds(
    it.segmentFile.relativePath, { headers: { "x-cdn" : "edgemv" } }
  ));
  
  // Just the text files
  server.requestSucceeds('file1.txt', { responseTimeMs: 2000 });
  server.requestSucceeds('file2.txt', { responseBitsPerSec: 256 * 1024 });

  server.cloneFixtureStream(
    fixtureStream,
    "cloned-blue-moon"
  )

})();
