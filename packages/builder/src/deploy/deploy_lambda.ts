import { CloudWatchLogs } from "@aws-sdk/client-cloudwatch-logs";
import { Lambda } from "@aws-sdk/client-lambda";
import chalk from "chalk";
import getRepoInfo from "git-repo-info";
import { AbortSignal } from "node-abort-controller";
import { debuglog } from "node:util";
import ora from "ora";
import invariant from "tiny-invariant";
import { buildProject, displayManifest } from "../build/index.js";
import { deleteAPIGateway, setupAPIGateway } from "../setup/gateway.js";
import { getEnvVariables } from "./env_vars.js";
import { deleteLambdaRole } from "./lambda_role.js";
import { deleteStack, deployStack } from "./stack.js";
import updateAlias from "./update_alias.js";
import uploadLambda from "./upload_lambda.js";

const currentVersionAlias = "current";
const debug = debuglog("queue-run:deploy");

export async function deployLambda({
  buildDir,
  environment,
  envVars: cliEnvVars,
  project,
  region,
  signal = new AbortSignal(),
  sourceDir,
}: {
  buildDir: string;
  environment: "production" | "preview";
  envVars: Map<string, string>;
  project: string;
  region: string;
  signal?: AbortSignal;
  sourceDir: string;
}): Promise<{
  httpUrl: string;
  websocketUrl: string;
}> {
  // Note: queue names have 80 characters limit, when we combine
  // {qrPrefix}{project}_{branch}__{queueName} we have a total of 27 characters
  // available.
  if (!project && /^[a-zA-Z0-9-]{1,40}$/.test(project))
    throw new Error(
      "Project name must be 40 characters or less, alphanumeric and dashes"
    );

  const lambdaName = `qr-${project}`;
  debug('Lamba name: "%s"', lambdaName);
  const queuePrefix = `${lambdaName}__`;
  debug('Queue prefix: "%s"', queuePrefix);

  const { lambdaRuntime, zip, manifest } = await buildProject({
    buildDir,
    full: true,
    signal,
    sourceDir,
  });
  invariant(zip);
  if (signal?.aborted) throw new Error("Timeout");

  await displayManifest(buildDir);

  console.info(chalk.bold("\nDeploying Lambda function\n"));

  const spinner = ora("Setting up API Gateway...").start();
  const { httpApiId, httpUrl, websocketUrl, websocketApiId } =
    await setupAPIGateway({
      project,
      region,
    });
  spinner.stop();

  const envVars = await loadEnvVars({
    environment,
    envVars: cliEnvVars,
    httpUrl,
    project,
    region,
    websocketUrl,
    websocketApiId,
  });

  if (signal?.aborted) throw new Error();

  const cw = new CloudWatchLogs({ region });
  const logGroupName = `/aws/lambda/${lambdaName}`;
  const logStreamName = `deploy/${crypto.randomUUID!()}`;

  await cw.createLogGroup({ logGroupName }).catch(() => undefined);
  await cw
    .createLogStream({ logGroupName, logStreamName })
    .catch(() => undefined);

  const limits = {
    memory: manifest.limits.memory,
    timeout: manifest.limits.timeout,
  };

  // Upload new Lambda function and publish a new version.
  // This doesn't make any difference yet: event sources are tied to an alias,
  // and the alias points to an earlier version (or no version on first deploy).
  const versionArn = await uploadLambda({
    envVars,
    lambdaName,
    lambdaRuntime,
    limits,
    region,
    zip,
  });

  const { nextSequenceToken } = await cw.putLogEvents({
    logGroupName,
    logStreamName,
    logEvents: [
      { message: `Uploaded new version ${versionArn}`, timestamp: Date.now() },
    ],
  });
  if (signal?.aborted) throw new Error();

  const lambdaArn = versionArn.replace(/:(\d+)$/, "");
  const aliasArn = versionArn.replace(/(\d+)$/, currentVersionAlias);
  await updateAlias({ aliasArn, versionArn, region });
  if (signal?.aborted) throw new Error();

  // If aborted in time and stack deploy cancelled, then deployStack will throw.
  await deployStack({
    buildDir,
    httpApiId,
    lambdaArn,
    signal,
    websocketApiId,
  });

  await cw.putLogEvents({
    logGroupName,
    logStreamName,
    logEvents: [
      {
        message: `Switched to new version ${versionArn}`,
        timestamp: Date.now(),
      },
    ],
    sequenceToken: nextSequenceToken!,
  });

  return { httpUrl, websocketUrl };
}

async function loadEnvVars({
  environment,
  envVars,
  httpUrl,
  project,
  region,
  websocketUrl,
  websocketApiId,
}: {
  environment: "production" | "preview";
  envVars: Map<string, string>;
  httpUrl: string;
  project: string;
  region: string;
  websocketUrl: string;
  websocketApiId: string;
}) {
  // Environment from database
  const merged = await getEnvVariables({
    environment,
    project,
    region,
  });

  // Command line environment variables over-ride database
  for (const [key, value] of Array.from(envVars.entries()))
    merged.set(key, value);

  // These always take precedence
  merged.set("NODE_ENV", "production");
  merged.set("QUEUE_RUN_ENV", environment);
  merged.set("QUEUE_RUN_URL", httpUrl);
  merged.set("QUEUE_RUN_WS", websocketUrl);
  merged.set("QUEUE_RUN_WS_API_ID", websocketApiId);

  const { branch, tag, sha } = getRepoInfo();
  merged.set("GIT_BRANCH", branch);
  merged.set("GIT_SHA", sha);
  if (tag) merged.set("GIT_TAG", tag);

  return merged;
}

export async function deleteLambda({
  project,
  region,
}: {
  project: string;
  region: string;
}) {
  const lambdaName = `qr-${project}`;
  await deleteStack(lambdaName);
  const lambda = new Lambda({ region });

  const spinner = ora(`Deleting Lambda function ${lambdaName}`).start();
  try {
    await lambda.deleteFunction({ FunctionName: lambdaName });
  } catch (error) {
    if ((error as { name: string }).name !== "ResourceNotFoundException")
      throw error;
  }
  await deleteLambdaRole({ lambdaName, region });
  await deleteAPIGateway({ project, region });
  spinner.succeed();
}

export async function getRecentVersions({
  region,
  slug,
}: {
  region: string;
  slug: string;
}): Promise<
  Array<{
    arn: string;
    isCurrent: boolean;
    modified: Date;
    size: number;
    version: string;
  }>
> {
  const lambdaName = `qr-${slug}`;
  const lambda = new Lambda({ region });

  const { FunctionVersion: currentVersion } = await lambda.getAlias({
    FunctionName: lambdaName,
    Name: currentVersionAlias,
  });
  const versions = (await getAllVersions(lambdaName))
    .filter(({ version }) => version !== "$LATEST")
    .sort((a, b) => +b.version - +a.version);

  return versions.map((version) => ({
    ...version,
    isCurrent: version.version === currentVersion,
  }));
}

async function getAllVersions(
  lambdaName: string,
  nextToken?: string
): Promise<
  Array<{
    arn: string;
    modified: Date;
    size: number;
    version: string;
  }>
> {
  const lambda = new Lambda({});
  const { NextMarker, Versions } = await lambda.listVersionsByFunction({
    FunctionName: lambdaName,
    ...(nextToken && { Marker: nextToken }),
  });
  if (!Versions) return [];
  const versions = Versions.map((version) => ({
    arn: version.FunctionArn!,
    modified: new Date(version.LastModified!),
    size: version.CodeSize!,
    version: version.Version!,
  }));
  return NextMarker
    ? [...versions, ...(await getAllVersions(lambdaName, NextMarker))]
    : versions;
}
