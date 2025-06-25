import express, { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { lookup as lookupMime } from "mime-types";
import {
  FixtureMediaPlaylist,
  FixtureSegment,
  FixtureStream,
} from "./fixtures";
import { FailRules, SuccessRules, RedirectRules } from "./rules";

type FixtureFileConfig = {
  successRules?: SuccessRules;
  redirectRules?: RedirectRules;
  failRules?: FailRules;
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
  private fixtureFileConfig: FixtureFileConfigMap;

  constructor({ port = 3000, basedir = __dirname }: FixtureServerOptions = {}) {
    this.port = port;
    this.app = express();
    this.server = null;
    this.fixtureFileConfig = {};
    this.basedir = basedir;
    this._setupRoutes(basedir);
  }

  private async _respond(absPath: string, req: Request, res: Response) {
    const relPath = path
      .relative(this.basedir, absPath)
      .split(path.sep)
      .join("/");
    const config = this.fixtureFileConfig[req.url] || {};

    // Response should fail
    if (config.failRules) {
      const { statusLine, errorBody, headers } = config.failRules;
      if (headers && typeof headers === "object") {
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      }
      res.statusCode = statusLine?.code ?? 500;
      res.statusMessage = statusLine?.message ?? "";
      if (errorBody) {
        res.write(errorBody);
      }
      res.end();
      return;
    }

    // Response is a redirect
    if (config.redirectRules) {
      const { code, headers, location } = config.redirectRules;
      res.statusCode = code ?? 302;
      res.statusMessage = "Found";

      if (headers && typeof headers === "object") {
        Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
      }
      let realLocation: string;
      if (!isValidURL(location)) {
        realLocation = fileRouteFromPath(location);
      } else {
        realLocation = location;
      }
      res.setHeader("Location", realLocation);

      res.end();
      return;
    }

    // Response should succeed
    const { responseTimeMs, responseBitsPerSec, headers } =
      config.successRules ?? {};

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

    if (responseTimeMs && responseTimeMs > 0) {
      // Response time throttling
      try {
        const data = await fs.promises.readFile(absPath);
        const bytesPerSec = (data.length * 1000) / responseTimeMs;
        console.log(
          `${absPath}: writing out ${data.length} at ${bytesPerSec} bytes per sec`
        );

        await writeResponseThrottled(data, res, bytesPerSec);
        res.end();
      } catch (err) {
        // todo - better than this
        res.sendStatus(500);
      }
    } else if (responseBitsPerSec && responseBitsPerSec > 0) {
      // Bitrate (bits/sec) throttling
      try {
        const data = await fs.promises.readFile(absPath);
        console.log(
          `${absPath}: writing out ${data.length} at ${
            responseBitsPerSec / 8
          } bytes per sec`
        );
        await writeResponseThrottled(data, res, responseBitsPerSec / 8);
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
    const fileAbsPath = path.join(this.basedir, originalRelPath);
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
    const pathParts = originalStream.playlistFile.relativePath
      .split(path.sep)
      .slice(1);
    const clonedPath = path.join(newStreamName, ...pathParts);
    return new FixtureStream(
      newStreamName,
      {
        relativePath: originalStream.playlistFile.relativePath,
        route: this.cloneRoute(
          originalStream.playlistFile.relativePath,
          clonedPath
        ),
      },
      originalStream.masterPlaylist,
      originalStream.variants.map((variant) =>
        this.cloneFixturePlaylist(variant, newStreamName)
      )
    );
  }

  cloneFixturePlaylist(
    originalPlaylist: FixtureMediaPlaylist,
    newStreamName: string
  ): FixtureMediaPlaylist {
    const pathParts = originalPlaylist.playlistFile.relativePath
      .split(path.sep)
      .slice(1);
    const clonedPath = path.join(newStreamName, ...pathParts);

    return new FixtureMediaPlaylist(
      {
        relativePath: clonedPath,
        route: this.cloneRoute(
          originalPlaylist.playlistFile.relativePath,
          clonedPath
        ),
      },
      originalPlaylist.mediaPlaylist,
      originalPlaylist.segments.map((it) =>
        this.cloneFixtureSegment(it, newStreamName)
      )
    );
  }

  cloneFixtureSegment(
    originalSegment: FixtureSegment,
    newStreamName: string
  ): FixtureSegment {
    const pathParts = originalSegment.segmentFile.relativePath
      .split(path.sep)
      .slice(1);
    const clonedPath = path.join(newStreamName, ...pathParts);

    return new FixtureSegment(
      {
        relativePath: originalSegment.segmentFile.relativePath,
        route: this.cloneRoute(
          originalSegment.segmentFile.relativePath,
          clonedPath
        ),
      },
      originalSegment.mediaSegment
    );
  }

  requestSucceeds(route: string, rules: SuccessRules): void {
    route = fileRouteFromPath(route);
    let config: FixtureFileConfig = {
      successRules: rules,
    };

    this.fixtureFileConfig[route] = config;
  }

  requestRedirects(route: string, rules: RedirectRules): void {
    route = fileRouteFromPath(route);

    let config: FixtureFileConfig = {
      redirectRules: rules,
    };
    this.fixtureFileConfig[route] = config;
  }

  requestFails(route: string, rules: FailRules): void {
    route = fileRouteFromPath(route);

    let config: FixtureFileConfig = {
      failRules: rules,
    };
    this.fixtureFileConfig[route] = config;
  }

  removeRules(route: string): void {
    delete this.fixtureFileConfig[route];
  }
}
