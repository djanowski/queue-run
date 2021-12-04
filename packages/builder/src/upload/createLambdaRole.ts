import type { Role } from "@aws-sdk/client-iam";
import { IAM } from "@aws-sdk/client-iam";
import { lambdaRolePath } from "../constants";

const Version = "2012-10-17";

const assumeRolePolicy = {
  Version,
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ],
};

const loggingPolicy = {
  Version,
  Statement: [
    {
      Effect: "Allow",
      Action: "logs:CreateLogGroup",
      Resource: "arn:aws:logs:us-east-1:122210178198:*",
    },
    {
      Effect: "Allow",
      Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
      Resource: ["arn:aws:logs:us-east-1:122210178198:log-group:/aws/lambda/*"],
    },
  ],
};

const sqsPolicy = {
  Version,
  Statement: [
    {
      Effect: "Allow",
      Action: [
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:ReceiveMessage",
      ],
      Resource: "arn:aws:sqs:*",
    },
  ],
};

export default async function createLambdaRole({
  lambdaName,
  region,
}: {
  lambdaName: string;
  region: string;
}): Promise<Role> {
  const iam = new IAM({ region });
  const role = await upsertRole(iam, lambdaName);
  await updatePolicies(iam, role, lambdaName);
  return role;
}

async function upsertRole(iam: IAM, lambdaName: string): Promise<Role> {
  const roleName = `Lambda.${lambdaName}`;
  const { Role: role } = await iam.getRole({ RoleName: roleName });
  if (role) return role;

  const { Role: newRole } = await iam.createRole({
    Path: lambdaRolePath,
    RoleName: roleName,
    AssumeRolePolicyDocument: JSON.stringify(assumeRolePolicy),
  });
  if (!newRole) throw new Error("Failed to create role");

  console.info("λ: Created role %s", roleName);
  return newRole;
}

async function updatePolicies(iam: IAM, role: Role, lambdaName: string) {
  await updatePolicy(iam, role, "Logging", loggingPolicy);
  await updatePolicy(iam, role, "SQS", {
    ...sqsPolicy,
    Statement: [
      {
        ...sqsPolicy.Statement[0],
        Resource: `arn:aws:sqs:${lambdaName}__`,
      },
    ],
  });
}

async function updatePolicy(
  iam: IAM,
  role: Role,
  policyName: string,
  policy: unknown
) {
  await iam.putRolePolicy({
    RoleName: role.RoleName,
    PolicyName: policyName,
    PolicyDocument: JSON.stringify(policy),
  });
  console.info("λ: Updated policy %s", policyName);
}