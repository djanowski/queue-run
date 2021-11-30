import { lambda } from "./clients";
import { handler } from "./constants";
import createLambdaRole from "./createLambdaRole";
import createZip from "./createZip";

export default async function uploadLambda({
  lambdaName,
  dirname,
}: {
  lambdaName: string;
  dirname: string;
}): Promise<string> {
  const zip = await createZip(dirname);
  const revisionId = await createOrUpdateLambda(lambdaName, zip);
  return await publishNewVersion({ lambdaName, revisionId });
}

async function createOrUpdateLambda(
  lambdaName: string,
  zipFile: Uint8Array
): Promise<string> {
  try {
    const { Configuration: existing } = await lambda.getFunction({
      FunctionName: lambdaName,
    });

    if (existing) {
      console.info("λ: Updating %s code …", existing.FunctionArn);
      const newCode = await lambda.updateFunctionCode({
        FunctionName: lambdaName,
        Publish: false,
        ZipFile: zipFile,
        RevisionId: existing.RevisionId,
      });
      if (!newCode.RevisionId)
        throw new Error("Could not update function with new code");

      const newCodeRevisionId = await waitForNewRevision(
        lambdaName,
        newCode.RevisionId
      );

      console.info("λ: Updating %s configuration …", existing.FunctionArn);
      const updated = await lambda.updateFunctionConfiguration({
        FunctionName: lambdaName,
        Handler: handler,
        RevisionId: newCodeRevisionId,
      });
      if (!updated.RevisionId)
        throw new Error("Could not update function with new configuration");
      const finalRevisionId = await waitForNewRevision(
        lambdaName,
        updated.RevisionId
      );

      console.info("λ: Updated %s", updated.FunctionArn);
      return finalRevisionId;
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === "ResourceNotFoundException"))
      throw error;
  }

  const role = await createLambdaRole();
  console.info("λ: Creating new function %s …", lambdaName);
  const newLambda = await lambda.createFunction({
    Code: { ZipFile: zipFile },
    FunctionName: lambdaName,
    Handler: handler,
    PackageType: "Zip",
    Publish: false,
    Role: role.Arn,
    Runtime: "nodejs14.x",
    TracingConfig: { Mode: "Active" },
  });
  if (!newLambda.RevisionId) throw new Error("Could not create function");

  const finalRevisionId = await waitForNewRevision(
    lambdaName,
    newLambda.RevisionId
  );
  console.info("λ: Created %s", newLambda.FunctionArn);
  return finalRevisionId;
}

async function waitForNewRevision(
  lambdaName: string,
  revisionId: string
): Promise<string> {
  const { Configuration } = await lambda.getFunction({
    FunctionName: lambdaName,
  });
  if (!Configuration?.RevisionId)
    throw new Error("Could not get function configuration");

  if (Configuration.RevisionId === revisionId) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return await waitForNewRevision(lambdaName, revisionId);
  } else {
    return Configuration.RevisionId;
  }
}

async function publishNewVersion({
  lambdaName,
  revisionId,
}: {
  lambdaName: string;
  revisionId: string;
}): Promise<string> {
  const { Version: version } = await lambda.publishVersion({
    FunctionName: lambdaName,
    RevisionId: revisionId,
  });
  if (!version) throw new Error("Could not publish function");
  return version;
}