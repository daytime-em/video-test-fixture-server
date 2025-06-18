
function fixtureManifestPath(streamName: string): string {
  return streamName;
}

function fixtureMediaPlaylistPath(streamName: string, variantName: string) {
  return `${fixtureManifestPath}/${variantName}/playlist.m3u8`;
}

function fixtureSegmentPath(streamName: string, variantName: string, segmentNumber: number, fileExtension: string = "ts") {
  return `${fixtureManifestPath}/${variantName}/${segmentNumber}.${fileExtension}`;
}

export {
  fixtureManifestPath,
  fixtureMediaPlaylistPath,
  fixtureSegmentPath
};
