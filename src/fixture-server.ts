import express, { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { lookup as lookupMime } from 'mime-types';

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
  headers?: Record<string, string>;
};

type FixtureFileConfigMap = Record<string, FixtureFileConfig>;

async function writeResponseThrottled(data: Buffer, response: Response, bytesPerSec: number) {
  console.log(`writeResponseThrottled: Writing ${data.length} at ${bytesPerSec} bps`);
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
      let writeSize = (bytes <= bytesLeft) ? bytes : bytesLeft;

      const chunk = data.subarray(currentOffset, currentOffset + writeSize);
      // console.log(`writeChunk: just checking: chunk len is ${chunk.length}`);
      response.write(chunk, error => {
        if (error) {
          reject(error);
        } else {
          currentOffset += writeSize;
          resolve(writeSize);
        }
      });
    });
  };

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
  await new Promise<void>(resolve => setTimeout(() => resolve(), ms));
}

/**
 * Recursively traverse directory and return route/filepath pairs.
 */
function* walk(dir: string, prefix = ''): Generator<{ route: string; filepath: string }> {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const relPath = path.join(prefix, dirent.name);
    const absPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      yield* walk(absPath, relPath);
    } else if (dirent.isFile()) {
      yield { route: `/${relPath.split(path.sep).join('/')}`, filepath: absPath };
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
  private server: ReturnType<Express['listen']> | null;
  private fixtureFileConfig: FixtureFileConfigMap;

  constructor({
     port = 3000,
     basedir = __dirname,
  }: FixtureServerOptions = {}) {
    this.port = port;
    this.app = express();
    this.server = null;
    this.fixtureFileConfig = {};
    this.basedir = basedir;
    this._setupRoutes(basedir);
  }

  private _setupRoutes(basedir: string) {
    for (const { route, filepath } of walk(basedir)) {
      const filename = path.relative(basedir, filepath).split(path.sep).join('/');
      console.info(`adding route: ${route} -> ${filepath}`);
      this.app.get(route, async (req: Request, res: Response) => {
        const config = this.fixtureFileConfig[filename] || {};
        const { totalTimeMs, responseBitrate, headers } = config;

        // Set custom headers if present
        let contentTypeSet = false;
        if (headers && typeof headers === 'object') {
          Object.entries(headers).forEach(([key, value]) => {
            res.setHeader(key, value);
            if (key.toLowerCase() === 'content-type') {
              contentTypeSet = true;
            }
          });
        }

        // Set Content-Type using mime-types if not already set by headers
        if (!contentTypeSet) {
          const mimeType = lookupMime(filepath) || 'application/octet-stream';
          res.setHeader('Content-Type', mimeType);
        }

        if (totalTimeMs && totalTimeMs > 0) {
          // Response time throttling
          try {
            const data = await fs.promises.readFile(filepath);
            const bytesPerSec = data.length * 1000 / totalTimeMs;
            console.log(`${filepath}: writing out ${data.length} at ${bytesPerSec} bytes per sec`);

            await writeResponseThrottled(data, res, bytesPerSec);
            res.end();
          } catch (err) {
            // todo - better than this
            res.sendStatus(500);
          }
        } else if (responseBitrate && responseBitrate > 0) {
          // Bitrate (bits/sec) throttling
          try {
            const data = await fs.promises.readFile(filepath);
            console.log(`${filepath}: writing out ${data.length} at ${responseBitrate / 8} bytes per sec`);
            await writeResponseThrottled(data, res, responseBitrate / 8);
            res.end();
          } catch(err) {
            res.sendStatus(500);
          }
        } else {
          // No throttling, serve directly
          res.sendFile(filepath);
        }
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

  /**
   * Updates multiple fixture file configurations at once.
   */
  updateFixtureFileConfig(configMap: FixtureFileConfigMap): void {
    for (const [filename, config] of Object.entries(configMap)) {
      if (config == null) {
        delete this.fixtureFileConfig[filename];
      } else {
        this.fixtureFileConfig[filename] = { ...this.fixtureFileConfig[filename], ...config };
      }
    }
  }

  /**
   * Add/Update responseBitrate rule for a single file.
   */
  setFixtureFileResponseTime(filename: string, milliseconds: number): void {
    if (!this.fixtureFileConfig[filename]) this.fixtureFileConfig[filename] = {};
    this.fixtureFileConfig[filename].totalTimeMs = milliseconds;
  }

  /**
   * Remove responseBitrate rule for a single file.
   */
  removeFixtureFileResponseTime(filename: string): void {
    if (this.fixtureFileConfig[filename]) {
      delete this.fixtureFileConfig[filename].totalTimeMs;
      if (Object.keys(this.fixtureFileConfig[filename]).length === 0) {
        delete this.fixtureFileConfig[filename];
      }
    }
  }

  /**
   * Add/Update responseBitrate rule for a single file.
   */
  setFixtureFileResponseBitrate(filename: string, bps: number): void {
    if (!this.fixtureFileConfig[filename]) this.fixtureFileConfig[filename] = {};
    this.fixtureFileConfig[filename].responseBitrate = bps;
  }

  /**
   * Remove responseBitrate rule for a single file.
   */
  removeFixtureFileResponseBitrate(filename: string): void {
    if (this.fixtureFileConfig[filename]) {
      delete this.fixtureFileConfig[filename].responseBitrate;
      if (Object.keys(this.fixtureFileConfig[filename]).length === 0) {
        delete this.fixtureFileConfig[filename];
      }
    }
  }

  /**
   * Set custom response headers for a single file.
   */
  setFixtureFileHeaders(filename: string, headers: Record<string, string>): void {
    console.log(`setting headers for ${filename}: {${headers}}`);
    if (!this.fixtureFileConfig[filename]) this.fixtureFileConfig[filename] = {};
    this.fixtureFileConfig[filename].headers = { ...(this.fixtureFileConfig[filename].headers || {}), ...headers };
  }

  /**
   * Remove custom response headers for a single file.
   */
  removeFixtureFileHeaders(filename: string, headerNames: string[] | null = null): void {
    if (this.fixtureFileConfig[filename] && this.fixtureFileConfig[filename].headers) {
      if (!headerNames) {
        delete this.fixtureFileConfig[filename].headers;
      } else {
        for (const name of headerNames) {
          delete this.fixtureFileConfig[filename].headers![name];
        }
        if (Object.keys(this.fixtureFileConfig[filename].headers!).length === 0) {
          delete this.fixtureFileConfig[filename].headers;
        }
      }
      if (Object.keys(this.fixtureFileConfig[filename]).length === 0) {
        delete this.fixtureFileConfig[filename];
      }
    }
  }
}