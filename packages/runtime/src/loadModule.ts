import path from "path";
import { install } from "source-map-support";
import type { Middleware } from "../types";

// Use this for loading backend functions on demand:
//
// - Load module on-demand
// - Return null if module is not found
// - Load middleware and merge into module
// - Compatible with dev server HMR
export default async function loadModule<Exports = {}>(
  // The module name as route (not filename), eg "/api/project/$id",
  // "/queue/update_score"
  name: string
): Promise<Readonly<Exports & Middleware> | null> {
  // Avoid path traversal. This turns "foobar", "/foobar", and "../../foobar" into "/foobar"
  const fromProjectRoot = path.join("/", name);
  let filename;
  try {
    filename = require.resolve(
      path.join(path.resolve("backend"), fromProjectRoot)
    );
  } catch {
    return null;
  }
  const exports = await require(filename);
  const middleware = await loadMiddleware(fromProjectRoot);
  // This module's exports take precendece over _middleware
  return { ...middleware, ...exports };
}

// Given a path, returns the combined middleware for that folder and all parent
// folders. For example, given the module name '/api/project/:id', this will return the
// combined middleware for 'backend/api/project', 'backend/api', and '/backend'.
async function loadMiddleware(name: string): Promise<Middleware | undefined> {
  if (name === "/") return undefined;
  const parent = await loadMiddleware(path.dirname(name));
  let filename;
  try {
    filename = require.resolve(
      path.join(path.resolve("backend"), name, "_middleware")
    );
  } catch {
    return parent;
  }
  const exports = await require(filename);
  // This middleware's exports take precendece over parent's
  return { ...parent, ...exports };
}

// Adds source maps for stack traces
install({ environment: "node" });
