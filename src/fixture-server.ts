import express, { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { lookup as lookupMime } from 'mime-types';

const FILES_DIR = path.join(__dirname, 'resources', 'files');

type FixtureFileConfig = {
  /**
   * If set, total time (in ms) to serve the file (overrides responseBitrate).
   * If null, no throttling.
   */
  totalTimeMs?: number;
  /**
   * If set, bytes per second for throttling.
   * Ignored if totalTimeMs is set.
   */
  responseBitrate?: number;
  headers?: Record<string, string>;
};

type FixtureFileConfigMap = Record<string, FixtureFileConfig>;

/**
 * Helper: Throttle a stream to fit a given total duration.
 */
function createTimedThrottledStream(data: Buffer, totalTimeMs: number): Readable {
  const stream = new Readable({
    read(size) {
      if ((this as any)._offset >= (this as any)._data.length) {
        this.push(null);
        return;
      }
      const chunkSize = Math.ceil((this as any)._data.length / (this as any)._steps);
      const end = Math.min((this as any)._offset + chunkSize, (this as any)._data.length);
      this.push((this as any)._data.slice((this as any)._offset, end));
      (this as any)._offset = end;
      (this as any)._step++;
      if ((this as any)._offset < (this as any)._data.length) {
        setTimeout(() => (this as any)._read(size), (this as any)._interval);
      }
    }
  }) as Readable & { _data: Buffer; _offset: number; _steps: number; _step: number; _interval: number };
  (stream as any)._data = Buffer.from(data);
  (stream as any)._offset = 0;
  (stream as any)._steps = Math.ceil(totalTimeMs / 50); // Send at most every 50ms
  (stream as any)._step = 0;
  (stream as any)._interval = totalTimeMs / (stream as any)._steps;
  return stream;
}

/**
 * Helper: Throttle a stream for a given bytes-per-second rate.
 */
function createBitrateThrottledStream(data: Buffer, bps: number): Readable {
  const stream = new Readable({
    read(size) {
      if ((this as any)._offset >= (this as any)._data.length) {
        this.push(null);
        return;
      }
      const chunkSize = bps / 10; // send chunks every 100ms
      const end = Math.min((this as any)._offset + chunkSize, (this as any)._data.length);
      this.push((this as any)._data.slice((this as any)._offset, end));
      (this as any)._offset = end;
      if ((this as any)._offset < (this as any)._data.length) {
        setTimeout(() => (this as any)._read(size), 100);
      }
    }
  }) as Readable & { _data: Buffer; _offset: number };
  (stream as any)._data = Buffer.from(data);
  (stream as any)._offset = 0;
  return stream;
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
      yield { route: `/files/${relPath.split(path.sep).join('/')}`, filepath: absPath };
    }
  }
}

interface FixtureServerOptions {
  port?: number;
}

export class FixtureServer {
  public app: Express;
  public port: number;
  private server: ReturnType<Express['listen']> | null;
  private fixtureFileConfig: FixtureFileConfigMap;

  constructor({ port = 3000 }: FixtureServerOptions = {}) {
    this.port = port;
    this.app = express();
    this.server = null;
    this.fixtureFileConfig = {};
    this._setupRoutes();
  }

  private _setupRoutes() {
    for (const { route, filepath } of walk(FILES_DIR)) {
      const filename = path.relative(FILES_DIR, filepath).split(path.sep).join('/');
      this.app.get(route, (req: Request, res: Response) => {
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
          // Timed throttling
          fs.readFile(filepath, (err, data) => {
            if (err) {
              res.sendStatus(404);
              return;
            }
            createTimedThrottledStream(data, totalTimeMs).pipe(res);
          });
        } else if (responseBitrate && responseBitrate > 0) {
          // Bitrate (bytes/sec) throttling
          fs.readFile(filepath, (err, data) => {
            if (err) {
              res.sendStatus(404);
              return;
            }
            createBitrateThrottledStream(data, responseBitrate).pipe(res);
          });
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