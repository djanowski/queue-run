import path from "path";
import { compile, Key, pathToRegexp } from "path-to-regexp";
import { URL } from "url";

/**
 * URL path or query parameters.
 */
type Params = { [key: string]: any | any[] } | null | undefined;

/* eslint-disable no-unused-vars */
interface URLFunction {
  /**
   * Returns URL for the given path by expanding path parameters and adding
   * query string parameters.
   *
   * @param path URL string or object, relative parth or absolute
   * @param params Path parameters
   * @param query Query parameters
   * @returns Expanded URL
   *
   * ```
   * url("/bookmarks/:id", { id: '123' })
   * url("/bookmarks/[id]", { id: '123' })
   * => https://example.com/bookmarks/123
   * ```
   *
   * Excess parameters are added as query string parameters, but you can
   * explicitly pass query parameters as the second argument:
   *
   * ```
   * url("/bookmarks", { sort: 'date' })
   * url("/bookmarks", null, { sort: 'date' })
   * => https://example.com/bookmarks?sort=date
   * ```
   *
   * Path parameters can be specified using the notation `[name]` or `:name`
   * for single value, and `[name]*` or `:name*` for multiple values.
   *
   * If `url.baseUrl` is set, relative URLs are expanded to absolute URLs.
   *
   * URLs with `file:` path are supported relative to `url.rootDir`.
   */
  (path: string | URL, params?: Params, query?: Params): string;

  /**
   * Returns a URL constructor function for the given path.
   *
   * `url.for(path)(params)` is equivalent to `url(path, params)`.
   *
   * @param path URL string or object, relative parth or absolute
   * @returns URL constructor function
   */
  for<P extends Params, Q extends Params>(
    path: string | URL
  ): URLConstructor<P, Q>;

  /**
   * Returns URL constructor function for this module.
   *
   * Shortcut for `url.for(import.meta.url)`.
   *
   * @returns URL constructor function
   * @throws Called not from within a request handler
   */
  self<P extends Params, Q extends Params>(): URLConstructor<P, Q>;

  /**
   * The base URL.
   *
   * If set, then URLs functions expand relative paths to absolute URL using
   * this base URL.
   *
   * Absolute URLs are not affected.
   */
  baseUrl: string | undefined;

  /**
   * The root directory. Used to determine the path when using url.self().
   *
   * For example, if the root directory is "api/", and the module
   * "api/bookmarks/[id].ts" calls `url.self()`, the resulting URL
   * constructor uses the path "bookmarks/[id]".
   */
  rootDir: string;
}

interface URLConstructor<P extends Params, Q extends Params> {
  /**
   * Returns URL by expanding path parameters and adding query string
   * parameters.
   *
   * @param params Path parameters
   * @param query Query parameters
   * @returns Expanded URL
   *
   * ```
   * const myURL = url.for("/bookmarks/:id");
   * myURL({ id: '123' })
   * => https://example.com/bookmarks/123
   * ```
   */
  (params?: P, query?: Q): string;

  /**
   * Always returns a relative URL.
   *
   * @param params Path parameters
   * @param query Query parameters
   * @returns Expanded URL
   *
   * ```
   * const myURL = url.for("/bookmarks/:id");
   * myURL.relative({ id: '123' })
   * => /bookmarks/123
   * ```
   */
  relative(params?: P, query?: Q): string;

  /**
   * Returns the path.
   *
   * ```
   * const myURL = url.for("/bookmarks/:id");
   * String(myURL)
   * => /bookmarks/:id
   * ```
   */
  toString(): string;
}
/* eslint-enable no-unused-vars */

const url: URLFunction = (pathOrURL, params, query) =>
  newURLContructor(pathOrURL)(params, query);

url.for = (pathOrUrl) => newURLContructor(pathOrUrl);
url.self = () => newURLContructor(selfPath());
url.rootDir = "";
url.baseUrl = undefined;

function newURLContructor<P extends Params | null, Q extends Params | null>(
  pathOrUrl: string | URL
): URLConstructor<P, Q> {
  const { baseUrl } = url;
  const { origin, pathname } = parseURL(pathOrUrl, baseUrl);

  // Support [name] and :name notation
  const normalized = replaceBracket(pathname);
  const compiled = compile(normalized);

  const keys: Key[] = [];
  pathToRegexp(normalized, keys);
  // Path parameters from the URL, so we can tell which parameters
  // to apply to the query string
  const pathParams = new Set(keys.map((key) => key.name));

  const constructor = function (params?: P, query?: Q) {
    const url = new URL(compiled(params ?? {}), origin ?? "relative:/");
    if (params) {
      const leftOver = Object.entries(params).filter(
        ([key]) => !pathParams.has(key)
      );
      addQueryParameters(url, leftOver);
    }
    if (query) addQueryParameters(url, Object.entries(query));
    return url.href.replace(/^relative:/, "");
  };

  constructor.relative = (params?: P, query?: Q) => {
    const { pathname } = parseURL(pathOrUrl);
    const relative = `relative:${pathname}`;
    return newURLContructor(relative)(params, query);
  };

  constructor.toString = () =>
    baseUrl ? new URL(pathname, baseUrl).href : pathname;
  constructor.toJSON = () => constructor.toString();

  return constructor;
}

function parseURL(
  pathOrUrl: URL | string,
  baseUrl?: string | undefined
): {
  origin: string | undefined;
  pathname: string;
} {
  const { pathname, protocol, origin } =
    pathOrUrl instanceof URL
      ? pathOrUrl
      : new URL(pathOrUrl, baseUrl ?? "relative:/");

  if (protocol === "file:") {
    const rootDir = url.rootDir ?? "";
    const relative = path.relative(
      // This is so "/" is interpreted relative to current working directory
      path.resolve(process.cwd(), path.join(".", rootDir)),
      pathname
    );
    if (relative.startsWith(".."))
      throw new Error(`File path is outside of root directory "${rootDir}"`);
    return parseURL(relative.replace(/\.\w+$/, ""), baseUrl);
  } else {
    return protocol === "relative:"
      ? { pathname, origin: undefined }
      : { origin, pathname };
  }
}

function addQueryParameters(url: URL, params: [string, any][]) {
  for (const [name, value] of params) {
    if (Array.isArray(value))
      value.forEach((value) =>
        url.searchParams.append(name, String(value ?? ""))
      );
    else if (value !== undefined)
      url.searchParams.append(name, String(value ?? ""));
  }
}

function replaceBracket(path: string): string {
  return path.replace(
    /\[(.+?)\]/g,
    (_, name) => ":" + (name.startsWith("...") ? name.slice(3) + "*" : name)
  );
}

function selfPath(depth: number = 2): string {
  let filename: string | null | undefined = null;
  const prepare = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_, callSites) => {
      filename = callSites[depth]?.getFileName();
      // Normally this would be file://, with Jest we get filename, not a URL
      if (!filename?.startsWith("file://")) filename = `file://${filename}`;
    };

    const error = new Error();
    Error.captureStackTrace(error);
    error.stack;
  } finally {
    Error.prepareStackTrace = prepare;
  }

  if (typeof filename === "string") return filename;
  else throw new Error("Could not determine filename");
}

export default url;
