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
  error?: string;
  metadata?: {
    boundingBox?: number[][];
    volume?: number;
    polygonCount?: number;
  };
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

/**
 * Creates and manages a JSCAD evaluation Web Worker.
 */
export class JscadWorker {
  private worker: Worker | null = null;
  private pendingResolve: ((value: WorkerResponse) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    // Create an inline worker that evaluates JSCAD code
    // Using importScripts to load JSCAD from CDN since dynamic imports don't work in inline workers
    const workerCode = `
      // Load JSCAD modeling library from CDN
      importScripts('https://unpkg.com/@jscad/modeling@2.12.0/dist/jscad-modeling.min.js');
      
      const modeling = jscadModeling;
      self.window = self;
      if (!self.window.location) {
        self.window.location = self.location || { protocol: 'https:', origin: 'https://localhost' };
      }

      const remoteModuleCache = new Map();

      const normalizeRemoteUrl = (url) => {
        const match = url.match(/^https?:\\/\\/github\\.com\\/([^/]+)\\/([^/]+)\\/blob\\/([^/]+)\\/(.+)$/);
        if (match) {
          return 'https://raw.githubusercontent.com/' + match[1] + '/' + match[2] + '/' + match[3] + '/' + match[4];
        }
        return url;
      };

      const isRemotePath = (path) => /^https?:\/\//.test(path);
      const isLocalPath = (path) => path.startsWith('/jscad-libs/') || path.startsWith('jscad-libs/');

      const resolveRemoteUrl = (baseUrl, spec) => new URL(spec, baseUrl).toString();

      const normalizeModuleUrl = (spec, baseUrl) => {
        if (isRemotePath(spec)) return normalizeRemoteUrl(spec);
        if (isLocalPath(spec)) {
          const normalized = spec.startsWith('/') ? spec : '/' + spec;
          return new URL(normalized, self.location.origin).toString();
        }
        if (baseUrl) return resolveRemoteUrl(baseUrl, spec);
        return spec;
      };

      const fetchRemoteTextSync = (url) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.send(null);
        if (xhr.status >= 200 && xhr.status < 300) {
          return xhr.responseText;
        }
        throw new Error('Failed to fetch remote module: ' + url + ' (' + xhr.status + ')');
      };

      const evaluateRemoteModule = (url, baseUrl) => {
        const normalized = normalizeModuleUrl(url, baseUrl);
        if (remoteModuleCache.has(normalized)) {
          return remoteModuleCache.get(normalized).exports;
        }

        const code = fetchRemoteTextSync(normalized);
        const module = { exports: {} };
        remoteModuleCache.set(normalized, module);

        const localRequire = (path) => {
          if (path === '@jscad/modeling') return modeling;
          if (path.startsWith('@jscad/modeling/')) {
            const subpath = path.replace('@jscad/modeling/', '');
            const parts = subpath.split('/');
            let result = modeling;
            for (const part of parts) {
              result = result?.[part];
            }
            return result;
          }
          if (isRemotePath(path) || isLocalPath(path) || path.startsWith('./') || path.startsWith('../')) {
            const resolved = normalizeModuleUrl(path, normalized);
            return evaluateRemoteModule(resolved);
          }
          throw new Error('Unknown module: ' + path);
        };

        const include = (path) => {
          if (!path) return;
          if (isRemotePath(path) || isLocalPath(path) || path.startsWith('./') || path.startsWith('../')) {
            const resolved = normalizeModuleUrl(path, normalized);
            evaluateRemoteModule(resolved);
            return;
          }
          throw new Error('include() only supports remote URLs or /jscad-libs paths');
        };

        const fn = new Function('require', 'module', 'exports', 'include', 'window', code);
        fn(localRequire, module, module.exports, include, self);

        return module.exports;
      };

      self.onmessage = function(e) {
        const { type, code, parameters } = e.data;
        
        if (type === 'evaluate') {
          try {
            if (!modeling) {
              self.postMessage({ 
                type: 'error', 
                error: 'Failed to load JSCAD modeling library' 
              });
              return;
            }
            
            const mockRequire = (path) => {
              if (path === '@jscad/modeling') return modeling;
              if (path.startsWith('@jscad/modeling/')) {
                const subpath = path.replace('@jscad/modeling/', '');
                const parts = subpath.split('/');
                let result = modeling;
                for (const part of parts) {
                  result = result?.[part];
                }
                return result;
              }
              if (isRemotePath(path) || isLocalPath(path)) {
                return evaluateRemoteModule(path);
              }
              if (path === '@jscad/modeling/src/primitives') return modeling?.primitives;
              if (path === '@jscad/modeling/src/booleans') return modeling?.booleans;
              if (path === '@jscad/modeling/src/transforms') return modeling?.transforms;
              if (path === '@jscad/modeling/src/extrusions') return modeling?.extrusions;
              if (path === '@jscad/modeling/src/colors') return modeling?.colors;
              if (path === '@jscad/modeling/src/hulls') return modeling?.hulls;
              if (path === '@jscad/modeling/src/measurements') return modeling?.measurements;
              throw new Error('Unknown module: ' + path);
            };

            const include = (path) => {
              if (!path) return;
              if (isRemotePath(path) || isLocalPath(path)) {
                evaluateRemoteModule(path);
                return;
              }
              throw new Error('include() only supports remote URLs or /jscad-libs paths');
            };

            // Evaluate the code in a Function constructor sandbox
            const moduleExports = {};
            const module = { exports: moduleExports };
            
            const fn = new Function('require', 'module', 'exports', 'include', code);
            fn(mockRequire, module, moduleExports, include);
            
            const exports = module.exports;
            
            // Extract parameter definitions if available
            let parameterDefinitions = [];
            if (typeof exports.getParameterDefinitions === 'function') {
              parameterDefinitions = exports.getParameterDefinitions();
              self.postMessage({
                type: 'parameters',
                parameterDefinitions
              });
            }
            
            // Call main function
            if (typeof exports.main === 'function') {
              const result = exports.main(parameters || {});
              
              // Normalize result to array
              const geometries = Array.isArray(result) ? result : [result];
              
              self.postMessage({
                type: 'result',
                geometries: geometries,
                parameterDefinitions,
                metadata: {
                  polygonCount: geometries.length
                }
              });
            } else {
              throw new Error('No main() function exported');
            }
          } catch (error) {
            self.postMessage({
              type: 'error',
              error: error.message || String(error)
            });
          }
        }
      };
    `;

    const blob = new Blob([workerCode], { type: "application/javascript" });
    this.worker = new Worker(URL.createObjectURL(blob));

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.type === "parameters") {
        return;
      }

      if (e.data.type === "error") {
        this.pendingReject?.(new Error(e.data.error));
      } else {
        this.pendingResolve?.(e.data);
      }
      this.pendingResolve = null;
      this.pendingReject = null;
    };

    this.worker.onerror = (e) => {
      this.pendingReject?.(new Error(e.message));
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
        reject(new Error("Worker not initialized"));
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
          this.pendingReject(new Error("JSCAD evaluation timed out (30s)"));
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
  ): Promise<{ geometry?: unknown[]; error?: string }> => {
    if (!workerRef.current) {
      return { error: "Worker not initialized" };
    }

    try {
      const result = await workerRef.current.evaluate(code, parameters);
      if (result.error) {
        return { error: result.error };
      }
      return { geometry: result.geometries as unknown[] };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }, []);

  return { execute };
}
