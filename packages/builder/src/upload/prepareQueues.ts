import { QueueConfig } from "@assaf/untitled-runtime";
import { SQS } from "@aws-sdk/client-sqs";
import { queueURLToARN, queueURLToName } from "../util";

export async function createQueues({
  configs,
  prefix,
  region,
}: {
  configs: Map<string, { config?: QueueConfig }>;
  prefix: string;
  region: string;
}): Promise<string[]> {
  const sqs = new SQS({ region });

  return await Promise.all(
    Array.from(configs.entries()).map(async ([name, { config }]) => {
      const fifo = config?.fifo ? ".fifo" : "";
      const { QueueUrl } = await sqs.createQueue({
        QueueName: `${prefix}${name}${fifo}`,
      });
      if (!QueueUrl) throw new Error(`Could not create queue ${name}`);
      const arn = queueURLToARN(QueueUrl);
      console.info("µ: Created queue %s", name);
      return arn;
    })
  );
}

export async function deleteOldQueues({
  prefix,
  queueArns,
  region,
}: {
  prefix: string;
  queueArns: string[];
  region: string;
}) {
  const sqs = new SQS({ region });

  const { QueueUrls } = await sqs.listQueues({
    QueueNamePrefix: prefix,
  });
  if (!QueueUrls) return;

  const set = new Set(queueArns);
  const toDelete = QueueUrls.filter(
    (QueueUrl) => !set.has(queueURLToARN(QueueUrl))
  );
  if (toDelete.length === 0) return;

  console.info(
    "µ: Deleting old queues %s …",
    toDelete.map(queueURLToName).join(", ")
  );
  await Promise.all(
    toDelete.map(async (QueueUrl) => sqs.deleteQueue({ QueueUrl }))
  );
}