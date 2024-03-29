import * as db from "#lib/db.js";
import { url } from "queue-run";
import { urlForBookmark } from "./[id].js";

export async function get() {
  const bookmarks = await db.findAll();
  return (
    <feed xmlns="http://www.w3.org/2005/Atom">
      <url>{String(url.self())}</url>
      <title>Bookmarks</title>
      <link rel="self" href={url.self()()} />
      <>
        {Object.entries(bookmarks).map(([id, bookmark]) => (
          <entry>
            <title>{bookmark.title}</title>
            <link href={urlForBookmark(bookmark)} />
            <id>{id}</id>
            <updated>{bookmark.updated}</updated>
            <summary>{bookmark.title}</summary>
          </entry>
        ))}
      </>
    </feed>
  );
}

export const authenticate = false;
