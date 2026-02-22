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

function sanitizeGeometry(value) {
  if (value == null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) return value.map(sanitizeGeometry);

  const clean = {};
  for (const key of Object.keys(value)) {
    if (key === '__v1Wrapped') continue;
    const prop = value[key];
    if (typeof prop === 'function') continue;
    clean[key] = sanitizeGeometry(prop);
  }
  return clean;
}

function canonicalizeGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return geometry;

  try {
    // Some imported/v1-compatible geometries keep pending transforms that are
    // only applied when converted via geom3.toPolygons(). The viewport builds
    // meshes from polygon vertices directly, so we canonicalize here.
    if (Array.isArray(geometry.polygons) && modeling?.geometries?.geom3?.toPolygons) {
      const polygons = modeling.geometries.geom3.toPolygons(geometry);
      if (Array.isArray(polygons) && polygons.length > 0) {
        return { ...geometry, polygons };
      }
    }
  } catch (_) {
    // Fallback to original geometry when canonicalization is not possible.
  }

  return geometry;
}

function readSourceSync(url, cacheHints) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);
  xhr.setRequestHeader('Cache-Control', 'no-cache');
  if (cacheHints?.etag) {
    xhr.setRequestHeader('If-None-Match', cacheHints.etag);
  }
  if (cacheHints?.lastModified) {
    xhr.setRequestHeader('If-Modified-Since', cacheHints.lastModified);
  }
  xhr.send(null);

  if (xhr.status === 304) {
    return { status: 304 };
  }

  if (xhr.status >= 200 && xhr.status < 300) {
    return {
      status: xhr.status,
      source: xhr.responseText,
      etag: xhr.getResponseHeader('ETag'),
      lastModified: xhr.getResponseHeader('Last-Modified'),
    };
  }

  throw new Error('Failed to load module ' + url + ' (status ' + xhr.status + ')');
}

function executeExternalModule(path, parentUrl) {
  const normalized = normalizeSpec(path, parentUrl);
  const cached = remoteModuleCache.get(normalized);
  if (evaluatingModules.has(normalized)) {
    throw new Error('Circular external module reference: ' + normalized);
  }

  const response = readSourceSync(normalized, cached);
  if (response.status === 304) {
    if (!cached) {
      throw new Error('Received 304 for uncached module ' + normalized);
    }
    return cached.exports;
  }

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

    const fn = new Function('require', 'module', 'exports', 'include', 'window', response.source);
    fn(localRequire, externalModule, externalModule.exports, include, self.window);
    externalModule.etag = response.etag;
    externalModule.lastModified = response.lastModified;
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
      if (!Array.isArray(result)) {
        throw new Error('main() must return an array of geometry objects, even when there is only one object.');
      }

      if (result.length === 0) {
        throw new Error('main() returned an empty array. Return at least one geometry object.');
      }

      const geometries = result;
      const invalidIndex = geometries.findIndex((item) => !item || typeof item !== 'object');
      if (invalidIndex !== -1) {
        throw new Error('main() array contains an invalid geometry at index ' + invalidIndex + '.');
      }
      const canonicalGeometries = geometries.map(canonicalizeGeometry);
      const sanitizedGeometries = sanitizeGeometry(canonicalGeometries);
      
      self.postMessage({ 
        type: 'result', 
        geometries: sanitizedGeometries, 
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
