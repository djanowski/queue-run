import * as db from "#lib/db.js";
import { Request, Response } from "queue-run";

export async function authenticate(request: Request) {
  const header = request.headers.get("Authorization");
  const token = header && header.match(/^Bearer (.*)$/)?.[1];
  if (!token)
    throw new Response("Missing Authorization header with bearer token", {
      status: 401,
    });
  const user = await db.authenticate(token);
  if (!user) throw new Response("Access Denied!", { status: 403 });
  return user;
  // TODO: verify JWT token
  // TODO: example with signed cookies
}
