/* Hermetic tests transpile application TS without invoking the Start runtime or network. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { createRequire } = require("node:module");

const root = path.resolve(__dirname, "../..");
const projectRequire = createRequire(path.join(root, "package.json"));

function loadTs(relativePath, stubs = {}, globals = {}) {
  const cache = new Map();
  function resolveFile(filename) {
    for (const candidate of [
      filename,
      filename + ".ts",
      filename + ".tsx",
      filename + ".js",
      path.join(filename, "index.ts"),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error("Test module could not be resolved: " + filename);
  }
  function load(filename) {
    const absolute = resolveFile(path.resolve(root, filename));
    if (!absolute.startsWith(root + path.sep)) throw new Error("Test source escaped the checkout");
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const result = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: absolute,
    });
    function localRequire(specifier) {
      if (Object.prototype.hasOwnProperty.call(stubs, specifier)) return stubs[specifier];
      if (specifier === "@tanstack/react-start/server-only") return {};
      if (specifier.startsWith("@/")) return load(path.join(root, "src", specifier.slice(2)));
      if (specifier.startsWith(".")) return load(path.resolve(path.dirname(absolute), specifier));
      if (specifier.startsWith("@supabase/") || specifier.startsWith("@tanstack/")) {
        throw new Error("Server/router dependency must be explicitly faked: " + specifier);
      }
      return projectRequire(specifier);
    }
    const context = vm.createContext({
      module,
      exports: module.exports,
      require: localRequire,
      process: { env: Object.create(null) },
      fetch: async () => {
        throw new Error("Network is disabled in this fixture");
      },
      AbortController,
      AbortSignal,
      DOMException,
      Response,
      Request,
      Headers,
      TextEncoder,
      TextDecoder,
      ReadableStream,
      URL,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      console: { log() {}, warn() {}, error() {} },
      ...globals,
    });
    new vm.Script(result.outputText, { filename: absolute }).runInContext(context);
    return module.exports;
  }
  return load(relativePath);
}
module.exports = { loadTs };
