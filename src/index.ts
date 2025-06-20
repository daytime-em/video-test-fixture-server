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

  // todo - maybe some apis for finding mvps/mps/segments and applying rules to them?
  //  yes, liking lightweight types on top of this (but should allow accessing *Playlist/Variant/Segment objects)
  // fixtures.ts:
  //  findFixtureStream():  FixtureStream
  //  FixtureFile
  //    relativePath: string
  //    absolutePath: string
  //  FixtureStream
  //    mvpFile: FixtureFile
  //    variants: FixtureVariant
  //    masterPlaylist: MasterPlaylist
  //  FixtureVariant
  //    mediaPlaylistFile: FixtureFile
  //    mediaPlaylist: MediaPlaylist 
  //    segmentAtTime(seconds: number): FixtureSegment
  //    segmentsInTimeRange(startSec: number, endSec: number): FixtureSegment[]
  //  FixtureSegment
  //    segmentFile: FixtureFile
  //    mediaSegment: Segment
  //
  // todo - changes for FixtureServer
  //  FixtureServer
  //    setFileResponseTime(file: FixtureFile | string, time: number)
  //    setFileResponseBitrate(file: FixtureFile | string, bitsPerSec: number)
  //    setFileHeaders(file: FixtureFile | string, headers: Map<string, string | number | string[]>)
  //
  //  todo - FixtureServer stores routes in a set (route name is also key on config map)
  //  todo - FixtureServer validates that routes exist when setting rules
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
      const segmentPath = `${streamName}/${path.dirname(variant.uri)}/${cdn1Segment.uri}`;
      console.log(`setting headers for segment at ${segmentPath}`);
      server.setFixtureFileHeaders(segmentPath, { "x-cdn": "fastly" });
    })
    segmentsCdn2.forEach(cdn2Segment => {
      const segmentPath = `${streamName}/${path.dirname(variant.uri)}/${cdn2Segment.uri}`;
      console.log(`setting headers for segment at ${segmentPath}`);
      server.setFixtureFileHeaders(segmentPath, { "x-cdn": "edgemv"} );
    });
  });
  
  const fixtureStream = await parseFixtureStream("tears-of-steel")
  console.log(`Parsed fixture stream ${fixtureStream.streamName} at ${fixtureStream.playlistFile.relativePath}`);

  for (const variant of fixtureStream.variants) {
    console.log(`Has variant at ${variant.playlistFile.relativePath}`);
    for (const segment of variant.segments) {
      console.log(`has segment at ${segment.segmentFile.relativePath}`);
    }
  }
  
  // Just the text files
  server.setFixtureFileResponseTime('file1.txt', 2000);
  server.setFixtureFileResponseBitrate('file2.txt', 256 * 1024);
  server.setFixtureFileHeaders('file2.txt', {
    'X-CDN': "edgemv",
  });

})();
