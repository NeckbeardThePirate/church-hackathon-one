import assert from "node:assert/strict";
import test from "node:test";
import { embedLibraryPage, searchConfessions } from "./library-search.ts";

test("library embedding pages pass the gateway id through", async () => {
  const options: unknown[] = [];
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      async run(_model: string, _input: unknown, gateway?: unknown) {
        options.push(gateway);
        return { data: [[0.2, 0.3]] };
      },
    },
    BIBLE: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async all() {
                assert.match(sql, /confession_sections/);
                return {
                  results: [
                    {
                      rowid: 4,
                      id: "wcf-1",
                      doc_title: "Westminster",
                      year: "1646",
                      label: "1.1",
                      title: "Of Scripture",
                      text: "The whole counsel",
                    },
                  ],
                };
              },
            };
          },
        };
      },
    },
    LIBRARY_VECTORS: {
      async upsert() {},
    },
  };

  const page = await embedLibraryPage(env as unknown as Parameters<typeof embedLibraryPage>[0], "confessions", 0, 10);

  assert.equal(page.processed, 1);
  assert.equal(page.nextCursor, null);
  assert.deepEqual(options, [{ gateway: { id: "study-buddy", metadata: { stage: "embed" } } }]);
});

test("library search embeddings pass the gateway id through", async () => {
  const options: unknown[] = [];
  let queried = false;
  const env = {
    AI_GATEWAY_ID: "study-buddy",
    AI: {
      async run(_model: string, input: { text?: string[] }, runOptions?: unknown) {
        options.push({ text: input.text, options: runOptions });
        return { data: [[0.1, 0.2, 0.3]] };
      },
    },
    LIBRARY_VECTORS: {
      async query() {
        queried = true;
        return { matches: [{ id: "c:wcf-1" }] };
      },
    },
    BIBLE: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [
                    {
                      id: "wcf-1",
                      doc_title: "Westminster Confession of Faith",
                      year: "1646",
                      label: "1.1",
                      title: "Of the Holy Scripture",
                      text: "The whole counsel of God",
                    },
                  ],
                };
              },
            };
          },
        };
      },
    },
  };

  const hits = await searchConfessions(env as unknown as Parameters<typeof searchConfessions>[0], "scripture", {
    mode: "semantic",
    k: 2,
  });

  assert.equal(queried, true);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.id, "wcf-1");
  assert.deepEqual(options, [
    {
      text: ["scripture"],
      options: { gateway: { id: "study-buddy", metadata: { stage: "embed" } } },
    },
  ]);
});
