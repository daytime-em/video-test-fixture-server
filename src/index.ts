import { FixtureServer } from './fixture-server';

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
  // only 1 variant
  const cdn1Segments = fixtureStream.variants[0].segmentsInTimeRange(0, 75);
  const cdn2Segments = fixtureStream.variants[0].segmentsInTimeRange(75);
  cdn1Segments?.forEach(it => server.requestSucceeds(
    it.segmentFile.relativePath, { headers: { "x-cdn" : "fastly" } }
  ));
  cdn2Segments?.forEach(it => server.requestSucceeds(
    it.segmentFile.relativePath, { headers: { "x-cdn" : "edgemv" } }
  ));
  
  // Set up redirection case
  const muxPromo = await parseFixtureStream("mux-promo");
  const clonedPromo = server.cloneFixtureStream(
    muxPromo,
    "mux-promo-with-redirect"
  );
  // only 1 variant
  clonedPromo.variants[0].segments.forEach((it, index) => {
    server.requestRedirects(it.segmentFile.route, {
      location: muxPromo.variants[0].segments[index].segmentFile.route
    });
  });
  
  // Clone mux-promo, but make the multivariant playlist fail (HTTP 500)
  const muxPromoManifestFails = server.cloneFixtureStream(muxPromo, "mux-promo-manifest-fails");
  server.requestFails(muxPromoManifestFails.playlistFile.route,
   { statusLine: { code: 500, message: "Internal Server Error" } }
  );

  // Clone mux-promo, but make all segments in the first variant fail (HTTP 500)
  const muxPromoSegmentsFail = server.cloneFixtureStream(muxPromo, "mux-promo-segments-fail");
  muxPromoSegmentsFail.variants[0].segments.forEach(seg => {
    server.requestFails(seg.segmentFile.route, 
      { statusLine: { code: 500, message: "Internal Server Error" } }
    );
  });
  
  // Just the text files
  server.requestSucceeds('file1.txt', { responseTimeMs: 2000 });
  // server.requestSucceeds('file2.txt', { responseBitsPerSec: 256 * 1024 });
  server.requestRedirects('file2.txt', { location: "file1.txt" });
})();
