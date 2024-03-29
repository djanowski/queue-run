import { URL } from "url";
import { Request } from "../http/fetch.js"; // don't import from http to avoid circular dependency
import { JobMetadata } from "../queue/index.js";

/* eslint-disable no-unused-vars */
/**
 * This middleware is called in the event of an error.
 *
 * @param error The error that was thrown
 * @param reference The reference object (HTTP request, job metadata, etc.)
 */
export type OnError = (
  error: Error,
  reference: unknown
) => Promise<void> | void;
/* eslint-enable no-unused-vars */

/**
 * The default OnError middleware.
 *
 * @param error The error that was thrown
 * @param reference The reference object (HTTP request, job metadata, etc.)
 */
export async function logError(error: Error, reference: unknown) {
  if (reference instanceof Request) {
    const { method, url } = reference as Request;
    console.error(
      '"%s %s" error: %s',
      method,
      new URL(url).pathname,
      String(error),
      error.stack
    );
  } else if (
    reference instanceof Object &&
    "jobId" in reference &&
    "queueName" in reference
  ) {
    const { jobId, queueName } = reference as JobMetadata;
    console.error(
      "Job failed on %s: %s: %s",
      queueName,
      jobId,
      String(error),
      error.stack
    );
  }
}
