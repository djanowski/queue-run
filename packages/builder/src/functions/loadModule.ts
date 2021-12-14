import * as swc from "@swc/core";
import { JscTarget } from "@swc/core";
import { R_OK } from "node:constants";
import * as fs from "node:fs";
import { lstat } from "node:fs/promises";
import * as path from "node:path";
import vm from "node:vm";
import sourceMapSupport from "source-map-support";

const globalRequire = require;

const sourceMaps = new Map<string, string>();

sourceMapSupport.install({
  environment: "node",
  retrieveSourceMap: (filename) => {
    const map = sourceMaps.get(filename);
    return map ? { url: filename, map } : null;
  },
});

// Half-assed implementatio of Node's require module loading that support hot reload.
export default function loadModule({
  cache,
  envVars,
  filename,
  jscTarget,
  parent,
}: {
  cache: NodeJS.Dict<NodeJS.Module>;
  envVars: Record<string, string>;
  filename: string;
  jscTarget: JscTarget;
  parent?: NodeJS.Module;
}): NodeJS.Module {
  const require: NodeJS.Require = (id: string) => {
    if (id.startsWith(".")) {
      const child =
        cache[id] ??
        loadModule({
          cache,
          envVars,
          filename: require.resolve(id),
          jscTarget,
          parent: module,
        });
      if (!module.children.find(({ id }) => id === child.id))
        module.children.push(child);
      return child.exports;
    } else {
      const fromNodeModule = requireFromNodeModules(
        filename,
        require.resolve.paths(filename)
      );
      if (fromNodeModule) return fromNodeModule;
      else return globalRequire(id);
    }
  };

  require.cache = cache;
  require.main = undefined;
  require.extensions = {
    ...globalRequire.extensions,
    ".json": (module: NodeJS.Module, filename: string) => {
      module.exports.default = JSON.parse(
        fs.readFileSync(require.resolve(filename), "utf8")
      );
    },
    ".js": compileSourceFile({
      envVars,
      jscTarget,
      sourceMaps,
      syntax: "ecmascript",
    }),
    ".ts": compileSourceFile({
      envVars,
      jscTarget,
      sourceMaps,
      syntax: "typescript",
    }),
  };

  const resolve: NodeJS.RequireResolve = (id: string) => {
    const fullPath = path.resolve(path.dirname(module.filename), id);
    const found = [".ts", "/index.ts", ".js", "/index.js", ".json", ""]
      .map((ext) => `${fullPath}${ext}`)
      .find((path) => lstat(path).catch(() => false));
    return found ?? globalRequire.resolve(id);
  };
  resolve.paths = (id) => nodeModulePaths(id);
  require.resolve = resolve;

  const module: NodeJS.Module = {
    children: [],
    exports: {},
    filename,
    id: filename,
    isPreloading: false,
    loaded: false,
    parent,
    path: path.dirname(filename),
    paths: parent?.paths ?? globalRequire.resolve.paths("") ?? [],
    require,
  };
  cache[filename] = module;

  const extension = require.extensions[path.extname(filename)];
  if (extension) extension(module, filename);
  module.loaded = true;
  return module;
}

function requireFromNodeModules(filename: string, paths: string[] | null) {
  if (!paths) return null;
  const found = paths
    .map((dir) => path.resolve(dir, filename))
    .find((path) => lstat(path).catch(() => false));
  return found ? require(found) : null;
}

function nodeModulePaths(filename: string): string[] | null {
  if (filename.startsWith(".")) return null;
  const dirname = path.dirname(filename);
  const paths = [];
  try {
    fs.accessSync(path.resolve(dirname, "package.json"), R_OK);
    paths.push(path.resolve(dirname, "node_modules"));
  } catch {
    // No package.json
  }
  if (dirname === "/" || dirname === process.cwd()) return paths;
  const parent = nodeModulePaths(path.dirname(dirname));
  return parent ? [...parent, ...paths] : paths;
}

function compileSourceFile({
  envVars,
  jscTarget,
  sourceMaps,
  syntax,
}: {
  envVars: Record<string, string>;
  jscTarget: JscTarget;
  sourceMaps: Map<string, string>;
  syntax: "typescript" | "ecmascript";
}) {
  return (module: NodeJS.Module, filename: string) => {
    const { code, map: sourceMap } = swc.transformFileSync(filename, {
      envName: process.env.NODE_ENV,
      jsc: { parser: { syntax }, target: jscTarget },
      module: { type: "commonjs", noInterop: true },
      sourceMaps: true,
      swcrc: false,
    });
    if (sourceMap) sourceMaps.set(filename, sourceMap);

    vm.compileFunction(
      code,
      ["exports", "require", "module", "__filename", "__dirname", "process"],
      {
        filename,
      }
    )(
      module.exports,
      module.require,
      module,
      filename,
      path.dirname(filename),
      { ...process, env: envVars }
    );
    module.loaded = true;
  };
}
