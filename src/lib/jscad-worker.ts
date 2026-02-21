"use client";

import { useCallback, useRef, useEffect } from "react";

/**
 * JSCAD Web Worker — evaluates JSCAD code in a sandboxed environment.
 * Communicates with the main thread via postMessage.
 */

// Types for messages between main thread and worker
export interface WorkerRequest {
  type: "evaluate";
  code: string;
  parameters?: Record<string, unknown>;
}

export interface WorkerResponse {
  type: "result" | "error" | "parameters";
  geometries?: unknown[];
  parameterDefinitions?: ParameterDefinition[];
  error?: JscadExecutionError;
  metadata?: {
    boundingBox?: number[][];
    volume?: number;
    polygonCount?: number;
  };
}

export interface JscadExecutionError {
  message: string;
  stack?: string;
  line?: number;
  column?: number;
  source?: string;
}

export interface ParameterDefinition {
  name: string;
  type: "float" | "int" | "text" | "choice" | "checkbox";
  initial?: unknown;
  caption?: string;
  min?: number;
  max?: number;
  step?: number;
  values?: string[];
  captions?: string[];
}

class JscadWorkerError extends Error {
  line?: number;
  column?: number;
  source?: string;

  constructor(details: JscadExecutionError) {
    super(details.message);
    this.name = "JscadWorkerError";
    this.stack = details.stack ?? this.stack;
    this.line = details.line;
    this.column = details.column;
    this.source = details.source;
  }
}

/**
 * Creates and manages a JSCAD evaluation Web Worker.
 */
export class JscadWorker {
  private worker: Worker | null = null;
  private pendingResolve: ((value: WorkerResponse) => void) | null = null;
  private pendingReject: ((reason: JscadWorkerError) => void) | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    const baseOrigin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://localhost";

    const workerCode = `
importScripts('https://unpkg.com/@jscad/modeling@2.12.0/dist/jscad-modeling.min.js');

const modeling = jscadModeling;
self.window = self;
const injectedBaseOrigin = ${JSON.stringify(baseOrigin)};
self.window.location = { protocol: 'https:', origin: injectedBaseOrigin };
const baseOrigin = injectedBaseOrigin || 'https://localhost';

const remoteModuleCache = new Map();

const parseErrorLocation = (value) => {
  const text = [value?.stack, value?.message].filter(Boolean).join('\n');
  const regex = /(?:at\s+)?([^\s()]+):(\d+):(\d+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const [, source, lineText, columnText] = match;
    const line = Number(lineText);
    const column = Number(columnText);
    if (Number.isFinite(line) && line > 0 && Number.isFinite(column) && column > 0) {
      return { line, column, source };
    }
  }

  return {};
};

const formatRuntimeError = (value) => {
  const normalizedError = value instanceof Error ? value : new Error(String(value));
  const rawMessage = normalizedError.message || String(value);
  const stackText = normalizedError.stack || '';
  let message = rawMessage;

  const isExtrudeFromSlicesPlaneError =
    rawMessage.includes("Cannot read properties of undefined (reading '0')") &&
    /calculatePlane/.test(stackText) &&
    /extrudeFromSlices/.test(stackText);

  if (isExtrudeFromSlicesPlaneError) {
    message = [
      'Invalid slice generated for extrudeFromSlices().',
      'One of the generated slices is degenerate (duplicate or invalid points), so JSCAD cannot calculate a plane.',
      'Ensure your callback returns a valid slice with non-zero edges for capped start/end slices.',
      'Typical fixes: remove duplicate consecutive points, avoid zero-scale transforms, and only return null when capStart/capEnd are disabled for skipped ends.',
    ].join(' ');
  }

  return {
    normalizedError,
    message,
    location: parseErrorLocation(normalizedError),
  };
};

const normalizeRemoteUrl = (url) => {
  const match = url.match(/^https?:\\/\\/github\\.com\\/([^/]+)\\/([^/]+)\\/blob\\/([^/]+)\\/(.+)$/);
  if (match) {
    return 'https://raw.githubusercontent.com/' + match[1] + '/' + match[2] + '/' + match[3] + '/' + match[4];
  }
  return url;
};

const isRemotePath = (path) => /^https?:\\/\\//.test(path);
const isLocalPath = (path) => path.startsWith('/jscad-libs/') || path.startsWith('jscad-libs/');

const resolveLocalUrl = (spec) => {
  const normalized = spec.startsWith('/') ? spec : '/' + spec;
  try {
    return new URL(normalized, baseOrigin).toString();
  } catch (error) {
    return baseOrigin.replace(/\\/$/, '') + normalized;
  }
};

const normalizeModuleUrl = (spec) => {
  if (isRemotePath(spec)) return normalizeRemoteUrl(spec);
  if (isLocalPath(spec)) return resolveLocalUrl(spec);
  return spec;
};

const fetchRemoteTextSync = (url) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.send(null);
  if (xhr.status >= 200 && xhr.status < 300) return xhr.responseText;
  throw new Error('Failed to fetch: ' + url + ' (' + xhr.status + ')');
};

const evaluateRemoteModule = (url) => {
  const normalized = normalizeModuleUrl(url);
  if (remoteModuleCache.has(normalized)) return remoteModuleCache.get(normalized).exports;

  const code = fetchRemoteTextSync(normalized);
  const module = { exports: {} };
  remoteModuleCache.set(normalized, module);

  const localRequire = (path) => {
    if (path === '@jscad/modeling') return modeling;
    if (path.startsWith('@jscad/modeling/')) {
      const subpath = path.replace('@jscad/modeling/', '');
      const parts = subpath.split('/');
      let result = modeling;
      for (const part of parts) result = result?.[part];
      return result;
    }
    if (isRemotePath(path) || isLocalPath(path)) return evaluateRemoteModule(path);
    throw new Error('Unknown module: ' + path);
  };

  const include = (path) => {
    if (!path) return;
    if (isRemotePath(path) || isLocalPath(path)) {
      evaluateRemoteModule(path);
      return;
    }
    throw new Error('include() only supports URLs or /jscad-libs paths');
  };

  const fn = new Function('require', 'module', 'exports', 'include', 'window', code);
  fn(localRequire, module, module.exports, include, self);

  return module.exports;
};

self.onmessage = function(e) {
  const { type, code, parameters } = e.data;
  
  if (type === 'evaluate') {
    try {
      if (!modeling) throw new Error('JSCAD not loaded');

      const mockRequire = (path) => {
        if (path === '@jscad/modeling') return modeling;
        if (path.startsWith('@jscad/modeling/')) {
          const subpath = path.replace('@jscad/modeling/', '');
          const parts = subpath.split('/');
          let result = modeling;
          for (const part of parts) result = result?.[part];
          return result;
        }
        if (isRemotePath(path) || isLocalPath(path)) return evaluateRemoteModule(path);
        throw new Error('Unknown module: ' + path);
      };

      const include = (path) => {
        if (!path) return;
        if (isRemotePath(path) || isLocalPath(path)) {
          evaluateRemoteModule(path);
          return;
        }
        throw new Error('include() only supports URLs or /jscad-libs paths');
      };

      const moduleExports = {};
      const module = { exports: moduleExports };
      var window = self;
      
      const fn = new Function('require', 'module', 'exports', 'include', code);
      fn(mockRequire, module, moduleExports, include);

      const exports = module.exports;
      let parameterDefinitions = [];
      if (typeof exports.getParameterDefinitions === 'function') {
        parameterDefinitions = exports.getParameterDefinitions();
        self.postMessage({ type: 'parameters', parameterDefinitions });
      }
      
      if (typeof exports.main === 'function') {
        const result = exports.main(parameters || {});
        const geometries = Array.isArray(result) ? result : [result];
        self.postMessage({ type: 'result', geometries, parameterDefinitions, metadata: { polygonCount: geometries.length } });
      } else {
        throw new Error('No main() exported');
      }
    } catch (error) {
      const runtimeError = formatRuntimeError(error);
      self.postMessage({
        type: 'error',
        error: {
          message: runtimeError.message,
          stack: runtimeError.normalizedError.stack,
          line: runtimeError.location.line,
          column: runtimeError.location.column,
          source: runtimeError.location.source,
        },
      });
    }
  }
};
`;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    this.worker = new Worker(URL.createObjectURL(blob));

    this.worker.onerror = (e) => {
      console.error('[JSCAD Worker] Error:', e);
    };

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === "parameters") return;
      if (e.data.type === "error") {
        this.pendingReject?.(new JscadWorkerError(e.data.error ?? { message: "Unknown error" }));
      } else {
        this.pendingResolve?.(e.data);
      }
      this.pendingResolve = null;
      this.pendingReject = null;
    };
  }

  evaluate(
    code: string,
    parameters?: Record<string, unknown>
  ): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new JscadWorkerError({ message: "Worker not initialized" }));
        return;
      }

      this.pendingResolve = resolve;
      this.pendingReject = reject;

      const request: WorkerRequest = {
        type: "evaluate",
        code,
        parameters,
      };

      this.worker.postMessage(request);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingReject) {
          this.pendingReject(new JscadWorkerError({ message: "JSCAD evaluation timed out (30s)" }));
          this.pendingResolve = null;
          this.pendingReject = null;
          // Restart worker
          this.terminate();
          this.initWorker();
        }
      }, 30000);
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}

// React hook for using the JSCAD worker
export function useJscadWorker() {
  const workerRef = useRef<JscadWorker | null>(null);

  useEffect(() => {
    workerRef.current = new JscadWorker();
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const execute = useCallback(async (
    code: string,
    parameters?: Record<string, unknown>
  ): Promise<{ geometry?: unknown[]; error?: JscadExecutionError }> => {
    if (!workerRef.current) {
      return { error: { message: "Worker not initialized" } };
    }

    try {
      const result = await workerRef.current.evaluate(code, parameters);
      if (result.error) {
        return { error: result.error };
      }
      return { geometry: result.geometries as unknown[] };
    } catch (err) {
      if (err instanceof JscadWorkerError) {
        return {
          error: {
            message: err.message,
            stack: err.stack,
            line: err.line,
            column: err.column,
          },
        };
      }
      if (err instanceof Error) {
        return { error: { message: err.message, stack: err.stack } };
      }
      return { error: { message: "Unknown error" } };
    }
  }, []);

  return { execute };
}
