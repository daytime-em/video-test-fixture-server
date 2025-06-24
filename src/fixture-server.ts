import express, { Express, Request, Response } from "express";
import fs, { openAsBlob } from "fs";
import path from "path";
import { Readable } from "stream";
import { lookup as lookupMime } from "mime-types";
import { FixtureMediaPlaylist, FixtureSegment, FixtureStream } from "./fixtures";
import { FailRules, SuccessRules, RedirectRules } from "./rules";


type FixtureFileConfig = {
  /**
   * If set, total time (in ms) to serve the file (overrides responseBitrate).
   */
  totalTimeMs?: number;
  /**
   * If set, bits per second for throttling.
   * Ignored if totalTimeMs is set.
   */
  responseBitrate?: number;
  /**
   * If set, will add these headers to the response
   */
  headers?: Record<string, string>;
  /**
   * If set will send this status code/message with the response
   */
  statusLine?: { code: number; message?: string };
  /**
   * If set, will send this instead of the fixture data.
   */
  errorBody?: any;
  /**
   * If true, skips writing anything out in the response body
   */
  skipsWrite?: boolean;
};

type FixtureFileConfigMap = Record<string, FixtureFileConfig>;

async function writeResponseThrottled(
  data: Buffer,
  response: Response,
  bytesPerSec: number
) {
  console.log(
    `writeResponseThrottled: Writing ${data.length} at ${bytesPerSec} bps`
  );
  const dataLen = data.length;
  const bytesPerHundredMs = Math.floor(bytesPerSec / 10);

  let currentOffset = 0;

  function writeChunk(bytes: number): Promise<number> {
    return new Promise((resolve, reject) => {
      let bytesLeft = dataLen - currentOffset;
      console.log(`writeChunk: ${bytesLeft} bytes left`);
      if (bytesLeft <= 0) {
        resolve(0);
        return;
      }
      let writeSize = bytes <= bytesLeft ? bytes : bytesLeft;

      const chunk = data.subarray(currentOffset, currentOffset + writeSize);
      // console.log(`writeChunk: just checking: chunk len is ${chunk.length}`);
      response.write(chunk, (error) => {
        if (error) {
          reject(error);
        } else {
          currentOffset += writeSize;
          resolve(writeSize);
        }
      });
    });
  }

  while (true) {
    console.log(`Writing chunk`);
    const writeLen = await writeChunk(bytesPerHundredMs);
    if (writeLen <= 0) {
      break;
    }
    await waitFor(100);
  }
}

async function waitFor(ms: number) {
  await new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}

function fileRouteFromPath(relPath: string): string {
  if (relPath.startsWith("/")) {
    return relPath;
  } else {
    return `/${relPath}`;
  }
}

function isValidURL(str: string) {
  try {
    new URL(str); // Attempt to create a URL object
    return true; // If successful, it's a valid URL
  } catch (e) {
    return false; // If an error is thrown, it's not a valid URL
  }
}

/**
 * Recursively traverse directory and return route/filepath pairs.
 */
function* walk(
  dir: string,
  prefix = ""
): Generator<{ route: string; absPath: string }> {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const relPath = path.join(prefix, dirent.name);
    const absPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      yield* walk(absPath, relPath);
    } else if (dirent.isFile()) {
      yield { route: `/${relPath.split(path.sep).join("/")}`, absPath };
    }
  }
}

interface FixtureServerOptions {
  port?: number;
  basedir?: string;
}

export class FixtureServer {
  public app: Express;
  public port: number;
  public basedir: string;
  private server: ReturnType<Express["listen"]> | null;
  // todo - delete
  private fixtureFileConfig: FixtureFileConfigMap;

  private routes: Record<string, FixtureFileConfig>;

  constructor({ port = 3000, basedir = __dirname }: FixtureServerOptions = {}) {
    this.port = port;
    this.app = express();
    this.server = null;
    this.fixtureFileConfig = {};
    this.basedir = basedir;
    this._setupRoutes(basedir);

    this.routes = {};
  }

  private async _respond(absPath: string, req: Request, res: Response) {
    const relPath = path
      .relative(this.basedir, absPath)
      .split(path.sep)
      .join("/");
    const config = this.fixtureFileConfig[req.url] || {};

    // todo - Look for status line and response body
    // Response should fail

    // Response is a redirect

    // Response should succeed 
    const { totalTimeMs, responseBitrate, headers } = config;

    // Set custom headers if present
    let contentTypeSet = false;
    if (headers && typeof headers === "object") {
      Object.entries(headers).forEach(([key, value]) => {
        res.setHeader(key, value);
        if (key.toLowerCase() === "content-type") {
          contentTypeSet = true;
        }
      });
    }

    // Set Content-Type using mime-types if not already set by headers
    if (!contentTypeSet) {
      const mimeType = lookupMime(absPath) || "application/octet-stream";
      res.setHeader("Content-Type", mimeType);
    }

    if (totalTimeMs && totalTimeMs > 0) {
      // Response time throttling
      try {
        const data = await fs.promises.readFile(absPath);
        const bytesPerSec = (data.length * 1000) / totalTimeMs;
        console.log(
          `${absPath}: writing out ${data.length} at ${bytesPerSec} bytes per sec`
        );

        await writeResponseThrottled(data, res, bytesPerSec);
        res.end();
      } catch (err) {
        // todo - better than this
        res.sendStatus(500);
      }
    } else if (responseBitrate && responseBitrate > 0) {
      // Bitrate (bits/sec) throttling
      try {
        const data = await fs.promises.readFile(absPath);
        console.log(
          `${absPath}: writing out ${data.length} at ${
            responseBitrate / 8
          } bytes per sec`
        );
        await writeResponseThrottled(data, res, responseBitrate / 8);
        res.end();
      } catch (err) {
        res.sendStatus(500);
      }
    } else {
      // No throttling, serve directly
      res.sendFile(absPath);
    }
  }

  private _setupRoutes(basedir: string) {
    for (const { route, absPath } of walk(basedir)) {
      console.info(`_setupRoutes: adding route: ${route} -> ${absPath}`);

      this.app.get(route, async (req: Request, res: Response) => {
        this._respond(absPath, req, res);
      });
    }
  }

  /**
   * Start the server.
   */
  listen(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        resolve();
      });
    });
  }

  /**
   * Stop the server.
   */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err?: Error) => (err ? reject(err) : resolve()));
      } else {
        resolve();
      }
    });
  }

  cloneRoute(originalRelPath: string, newRelPath: string): string {
    console.log(`cloning route ${originalRelPath} -> ${newRelPath}`);
    const fileAbsPath = path.join(
      this.basedir,
      originalRelPath
    );
    const newRoute = fileRouteFromPath(newRelPath);

    console.log(`Adding route: ${newRoute} -> ${fileAbsPath}`);
    this.app.get(newRoute, async (req: Request, res: Response) => {
      this._respond(fileAbsPath, req, res);
    });

    return newRoute;
  }

  cloneFixtureStream(
    originalStream: FixtureStream,
    newStreamName: string
  ): FixtureStream {
    const pathParts = originalStream.playlistFile.relativePath.split(path.sep).slice(1)
    const clonedPath = path.join(newStreamName, ...pathParts);
    return new FixtureStream(
      newStreamName,
      { 
        relativePath: originalStream.playlistFile.relativePath, 
        route: this.cloneRoute(originalStream.playlistFile.relativePath, clonedPath)
      },
      originalStream.masterPlaylist,
      originalStream.variants.map(variant => 
        this.cloneFixturePlaylist(variant, newStreamName)
      )
    );
  }

  cloneFixturePlaylist(
    originalPlaylist: FixtureMediaPlaylist,
    newStreamName: string,
  ): FixtureMediaPlaylist {
    const pathParts = originalPlaylist.playlistFile.relativePath.split(path.sep).slice(1)
    const clonedPath = path.join(newStreamName, ...pathParts);

    return new FixtureMediaPlaylist(
      { 
        relativePath: clonedPath,
        route: this.cloneRoute(originalPlaylist.playlistFile.relativePath, clonedPath)
      },
      originalPlaylist.mediaPlaylist,
      originalPlaylist.segments.map(it => this.cloneFixtureSegment(it, newStreamName))
    );
  }

  cloneFixtureSegment(
    originalSegment: FixtureSegment,
    newStreamName: string
  ): FixtureSegment {
    const pathParts = originalSegment.segmentFile.relativePath.split(path.sep).slice(1)
    const clonedPath = path.join(newStreamName, ...pathParts);

    return new FixtureSegment(
      {
        relativePath: originalSegment.segmentFile.relativePath, 
        route: this.cloneRoute(originalSegment.segmentFile.relativePath, clonedPath)
      },
      originalSegment.mediaSegment
    );
  }

  requestSucceeds(name: string, rules: SuccessRules): void {
    name = fileRouteFromPath(name);
    let config: FixtureFileConfig = {
      headers: rules.headers,
      responseBitrate: rules.responseBitsPerSec,
      totalTimeMs: rules.responseTimeMs,
    };

    this.fixtureFileConfig[name] = config;
  }

  requestRedirects(name: string, rules: RedirectRules, statusCode: number = 302): void {
    name = fileRouteFromPath(name);
    let location = rules.location;
    if (!isValidURL(location)) {
      location = fileRouteFromPath(location);
    }
    let headers = rules.headers || {};

    let config: FixtureFileConfig = {
      headers: { ...headers, ...{ "Location": location } },
      statusLine: { code: statusCode, message: "Found" }
    }
    this.fixtureFileConfig[name] = config;
  }

  requestFails(name: string, rules: FailRules): void {
    name = fileRouteFromPath(name);

    let config: FixtureFileConfig = {
      headers: rules.headers,
      errorBody: rules.errorBody,
      statusLine: rules.statusLine,
    }
    this.fixtureFileConfig[name] = config;
  }

  removeRules(name: string): void {
    delete this.fixtureFileConfig[name];
  }

  // // TODO - i guess delete these in favor of an API with, like, rules
  // /**
  //  * Add/Update responseBitrate rule for a single file.
  //  */
  // setFixtureFileResponseTime(filename: string, milliseconds: number): void {
  //   filename = fileRouteFromPath(filename);

  //   if (!this.fixtureFileConfig[filename])
  //     this.fixtureFileConfig[filename] = {};
  //   this.fixtureFileConfig[filename].totalTimeMs = milliseconds;
  // }

  // /**
  //  * Remove responseBitrate rule for a single file.
  //  */
  // removeFixtureFileResponseTime(filename: string): void {
  //   filename = fileRouteFromPath(filename);
  //   if (this.fixtureFileConfig[filename]) {
  //     delete this.fixtureFileConfig[filename].totalTimeMs;
  //     if (Object.keys(this.fixtureFileConfig[filename]).length === 0) {
  //       delete this.fixtureFileConfig[filename];
  //     }
  //   }
  // }

  // /**
  //  * Add/Update responseBitrate rule for a single file.
  //  */
  // setFixtureFileResponseBitrate(filename: string, bps: number): void {
  //   filename = fileRouteFromPath(filename);
  //   if (!this.fixtureFileConfig[filename])
  //     this.fixtureFileConfig[filename] = {};
  //   this.fixtureFileConfig[filename].responseBitrate = bps;
  // }

  // /**
  //  * Remove responseBitrate rule for a single file.
  //  */
  // removeFixtureFileResponseBitrate(filename: string): void {
  //   filename = fileRouteFromPath(filename);
  //   if (this.fixtureFileConfig[filename]) {
  //     delete this.fixtureFileConfig[filename].responseBitrate;
  //     if (Object.keys(this.fixtureFileConfig[filename]).length === 0) {
  //       delete this.fixtureFileConfig[filename];
  //     }
  //   }
  // }

  // /**
  //  * Set custom response headers for a single file.
  //  */
  // setFixtureFileHeaders(
  //   filename: string,
  //   headers: Record<string, string>
  // ): void {
  //   filename = fileRouteFromPath(filename);
  //   for (const [key, value] of Object.entries(headers)) {
  //     console.log(`setting header for ${filename}: {${key}: ${value}}`);
  //   }
  //   if (!this.fixtureFileConfig[filename])
  //     this.fixtureFileConfig[filename] = {};
  //   this.fixtureFileConfig[filename].headers = {
  //     ...(this.fixtureFileConfig[filename].headers || {}),
  //     ...headers,
  //   };
  // }

  // /**
  //  * Remove custom response headers for a single file.
  //  */
  // removeFixtureFileHeaders(
  //   filename: string,
  //   headerNames: string[] | null = null
  // ): void {
  //   filename = fileRouteFromPath(filename);
  //   if (
  //     this.fixtureFileConfig[filename] &&
  //     this.fixtureFileConfig[filename].headers
  //   ) {
  //     if (!headerNames) {
  //       delete this.fixtureFileConfig[filename].headers;
  //     } else {
  //       for (const name of headerNames) {
  //         delete this.fixtureFileConfig[filename].headers![name];
  //       }
  //       if (
  //         Object.keys(this.fixtureFileConfig[filename].headers!).length === 0
  //       ) {
  //         delete this.fixtureFileConfig[filename].headers;
  //       }
  //     }
  //     if (Object.keys(this.fixtureFileConfig[filename]).length === 0) {
  //       delete this.fixtureFileConfig[filename];
  //     }
  //   }
  // }
}
