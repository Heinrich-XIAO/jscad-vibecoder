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
  private isReady = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private staticWorkerUrl = '/jscad-worker.js';

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    // Reset state
    this.isReady = false;
    this.readyPromise = null;
    this.readyResolve = null;

    try {
      this.worker = new Worker(this.staticWorkerUrl, { type: 'classic' });
    } catch (e) {
      console.error('[JSCAD Worker] Failed to create worker:', e);
      return;
    }

    this.worker.onerror = (e) => {
      console.error('[JSCAD Worker] Error:', e);
      if (this.pendingReject) {
        this.pendingReject(new JscadWorkerError({ 
          message: `Worker error: ${e.message || 'Unknown worker error'}` 
        }));
        this.pendingResolve = null;
        this.pendingReject = null;
      }
      this.terminate();
      this.initWorker();
    };

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      // Check for ready message (using any to avoid TS strict type issues)
      const data = e.data as any;
      if (data.type === 'ready') {
        this.isReady = true;
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
        }
        return;
      }
      
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

  private waitForReady(): Promise<void> {
    if (this.isReady) return Promise.resolve();
    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve) => {
        this.readyResolve = resolve;
        setTimeout(() => {
          if (this.readyResolve) {
            this.readyResolve();
            this.readyResolve = null;
          }
        }, 15000);
      });
    }
    return this.readyPromise;
  }

  evaluate(
    code: string,
    parameters?: Record<string, unknown>,
    attempt = 0
  ): Promise<WorkerResponse> {
    return new Promise(async (resolve, reject) => {
      if (!this.worker) {
        if (attempt < 2) {
          this.initWorker();
          setTimeout(() => {
            this.evaluate(code, parameters, attempt + 1)
              .then(resolve)
              .catch(reject);
          }, 500);
          return;
        }
        reject(new JscadWorkerError({ message: "Worker failed to initialize after retries" }));
        return;
      }

      // Wait for worker to be ready
      await this.waitForReady();

      this.pendingResolve = resolve;
      this.pendingReject = reject;

      const request: WorkerRequest = {
        type: "evaluate",
        code,
        parameters,
      };

      this.worker.postMessage(request);

      setTimeout(() => {
        if (this.pendingReject) {
          this.pendingReject(new JscadWorkerError({ message: "JSCAD evaluation timed out (30s)" }));
          this.pendingResolve = null;
          this.pendingReject = null;
          this.terminate();
          this.initWorker();
        }
      }, 30000);
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.isReady = false;
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
