// JSCAD Worker - Minimal version for reliability

// Load JSCAD library
importScripts('https://unpkg.com/@jscad/modeling@2.12.0/dist/jscad-modeling.min.js');

const modeling = jscadModeling;
self.window = self;

console.log('[JSCAD Worker] JSCAD loaded');

// Signal ready
self.postMessage({ type: 'ready' });

self.onmessage = function(e) {
  const { type, code, parameters } = e.data;
  
  if (type === 'evaluate') {
    try {
      // Simple require implementation
      const require = function(path) {
        if (path === '@jscad/modeling') return modeling;
        if (path.startsWith('@jscad/modeling/')) {
          const subpath = path.replace('@jscad/modeling/', '');
          const parts = subpath.split('/');
          let result = modeling;
          for (const part of parts) result = result?.[part];
          return result;
        }
        throw new Error('Unknown module: ' + path);
      };

      // Create module context
      const module = { exports: {} };
      const exports = module.exports;
      
      // Create the function and execute
      const fn = new Function('require', 'module', 'exports', code);
      fn(require, module, exports);
      
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
