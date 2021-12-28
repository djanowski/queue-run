# Severless Runtime using AWS Lambda

This runtime is completely serverless. You can self-host this runtime on your AWS account.

It uses Lambda for all backends, SQS for queues, API Gateway for HTTP and WebSockets, and DynamoDB for WS sessions.

When you use `npx queue-run setup` it deploys this runtime as a Lambda Layer "qr-runtime".