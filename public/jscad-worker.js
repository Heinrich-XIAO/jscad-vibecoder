// JSCAD Worker - Minimal version for reliability

// Load JSCAD library
importScripts('https://unpkg.com/@jscad/modeling@2.12.0/dist/jscad-modeling.min.js');

const modeling = jscadModeling;
self.window = self;

const remoteModuleCache = new Map();
const evaluatingModules = new Set();

function isRemoteSpec(path) {
  return /^https?:\/\//i.test(path);
}

function isLocalSpec(path) {
  return typeof path === 'string' && path.startsWith('/jscad-libs/');
}

function isRelativeSpec(path) {
  return typeof path === 'string' && (path.startsWith('./') || path.startsWith('../'));
}

function normalizeSpec(path, parentUrl) {
  if (!path || typeof path !== 'string') {
    throw new Error('Expected non-empty module path');
  }

  if (isRemoteSpec(path)) {
    return new URL(path).toString();
  }

  if (isLocalSpec(path)) {
    return new URL(path, self.location.origin).toString();
  }

  if (isRelativeSpec(path)) {
    if (!parentUrl) {
      throw new Error('Relative module path requires a parent module: ' + path);
    }
    return new URL(path, parentUrl).toString();
  }

  throw new Error('Unsupported module path: ' + path);
}

function readSourceSync(url) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.send(null);

  if (xhr.status >= 200 && xhr.status < 300) {
    return xhr.responseText;
  }

  throw new Error('Failed to load module ' + url + ' (status ' + xhr.status + ')');
}

function executeExternalModule(path, parentUrl) {
  const normalized = normalizeSpec(path, parentUrl);
  const cached = remoteModuleCache.get(normalized);
  if (cached) return cached.exports;

  if (evaluatingModules.has(normalized)) {
    throw new Error('Circular external module reference: ' + normalized);
  }

  const source = readSourceSync(normalized);
  const externalModule = { exports: {} };
  remoteModuleCache.set(normalized, externalModule);
  evaluatingModules.add(normalized);

  try {
    const localRequire = function(spec) {
      if (spec === '@jscad/modeling') return modeling;
      if (spec.startsWith('@jscad/modeling/')) {
        const subpath = spec.replace('@jscad/modeling/', '');
        const parts = subpath.split('/');
        let result = modeling;
        for (const part of parts) result = result?.[part];
        return result;
      }
      if (isRemoteSpec(spec) || isLocalSpec(spec) || isRelativeSpec(spec)) {
        return executeExternalModule(spec, normalized);
      }
      throw new Error('Unknown module: ' + spec);
    };

    const include = function(spec) {
      if (!spec) return;
      if (isRemoteSpec(spec) || isLocalSpec(spec) || isRelativeSpec(spec)) {
        executeExternalModule(spec, normalized);
        return;
      }
      throw new Error('include() requires a remote URL or /jscad-libs path: ' + spec);
    };

    const fn = new Function('require', 'module', 'exports', 'include', 'window', source);
    fn(localRequire, externalModule, externalModule.exports, include, self.window);
    return externalModule.exports;
  } finally {
    evaluatingModules.delete(normalized);
  }
}

console.log('[JSCAD Worker] JSCAD loaded');

// Signal ready
self.postMessage({ type: 'ready' });

self.onmessage = function(e) {
  const { type, code, parameters } = e.data;
  
  if (type === 'evaluate') {
    try {
      // Main-file require/include implementation
      const require = function(path) {
        if (path === '@jscad/modeling') return modeling;
        if (path.startsWith('@jscad/modeling/')) {
          const subpath = path.replace('@jscad/modeling/', '');
          const parts = subpath.split('/');
          let result = modeling;
          for (const part of parts) result = result?.[part];
          return result;
        }
        if (isRemoteSpec(path) || isLocalSpec(path)) {
          return executeExternalModule(path);
        }
        throw new Error('Unknown module: ' + path);
      };

      const include = function(path) {
        if (!path) return;
        if (isRemoteSpec(path) || isLocalSpec(path)) {
          executeExternalModule(path);
          return;
        }
        throw new Error('include() requires a remote URL or /jscad-libs path: ' + path);
      };

      // Create module context
      const module = { exports: {} };
      const exports = module.exports;
      
      // Create the function and execute
      const fn = new Function('require', 'module', 'exports', 'include', 'window', code);
      fn(require, module, exports, include, self.window);
      
      // Get main function
      const main = exports.main || module.exports.main;
      
      if (typeof main !== 'function') {
        throw new Error('No main() function exported');
      }
      
      // Execute main
      const result = main(parameters || {});
      const geometries = Array.isArray(result) ? result : [result];
      
      self.postMessage({ 
        type: 'result', 
        geometries, 
        metadata: { polygonCount: geometries.length } 
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        error: {
          message: error.message || String(error),
          stack: error.stack,
        },
      });
    }
  }
};
