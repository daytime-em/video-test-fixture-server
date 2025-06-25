export type SuccessRules = {
  headers?: Record<string, string>;
  responseBitsPerSec?: number;
  responseTimeMs?: number;
};

export type RedirectRules = {
  code?: number;
  headers?: Record<string, string>;
  /**
   * Can be a relative path, route, or a full URL.
   * Location header applied after headers in the base rules
   */
  location: string;
};

export type FailRules = {
  statusLine: { code: number; message?: string };
  headers?: Record<string, string>;
  errorBody?: any;
};
