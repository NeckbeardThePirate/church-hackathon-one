#!/usr/bin/env node
/**
 * Seeds Berean Standard Bible (BSB) text into D1 from wldeh/bible-api (en-bsb).
 * BSB license: https://berean.bible/
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BIBLE_BOOKS, BIBLE_CHAPTER_COUNT } from "../app/lib/bible/books.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const DB_NAME = "church-hackathon-bible";
const BASE =
  "https://raw.githubusercontent.com/wldeh/bible-api/main/bibles/en-bsb/books";
const onlyBook = process.argv.find((arg) => arg.startsWith("--book="))?.split("=")[1];

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function chaptersForBook(slug: string): number[] {
  const count = BIBLE_CHAPTER_COUNT[slug];
  if (!count) {
    throw new Error(`No chapter count configured for ${slug}`);
  }
  return Array.from({ length: count }, (_, index) => index + 1);
}

async function fetchChapter(slug: string, chapter: number) {
  const url = `${BASE}/${slug}/chapters/${chapter}.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url);
    if (response.ok) {
      return (await response.json()) as {
        data: { verse: string; text: string }[];
      };
    }
    if (response.status === 403 || response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`Failed to fetch ${slug} ${chapter}: ${response.status}`);
  }
  throw new Error(`Failed to fetch ${slug} ${chapter} after retries`);
}

async function main() {
  const books = onlyBook ? BIBLE_BOOKS.filter((book) => book.slug === onlyBook) : BIBLE_BOOKS;
  if (books.length === 0) {
    console.error(`Unknown book slug: ${onlyBook}`);
    process.exit(1);
  }

  const lines: string[] = ["DELETE FROM bible_verses;", "DELETE FROM bible_books;"];

  for (const book of BIBLE_BOOKS) {
    lines.push(
      `INSERT INTO bible_books (id, slug, name, sort_order) VALUES (${book.id}, ${sqlString(book.slug)}, ${sqlString(book.name)}, ${book.id});`,
    );
  }

  let verseCount = 0;
  for (const book of books) {
    const chapters = chaptersForBook(book.slug);
    console.log(`Fetching ${book.name} (${chapters.length} chapters)…`);
    for (const chapter of chapters) {
      const payload = await fetchChapter(book.slug, chapter);
      for (const row of payload.data) {
        const verse = Number(row.verse);
        if (!Number.isFinite(verse)) continue;
        lines.push(
          `INSERT INTO bible_verses (book_id, chapter, verse, text) VALUES (${book.id}, ${chapter}, ${verse}, ${sqlString(row.text)});`,
        );
        verseCount += 1;
      }
    }
  }

  const outPath = path.join(__dirname, "bsb-generated.sql");
  writeFileSync(outPath, `${lines.join("\n")}\n`);
  console.log(`Wrote ${verseCount} verses to ${outPath}`);

  const localFlag = process.argv.includes("--remote") ? [] : ["--local"];
  const migrate = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", DB_NAME, ...localFlag, "--file", "migrations/0001_bsb.sql"],
    { stdio: "inherit", cwd: rootDir },
  );
  if (migrate.status !== 0) process.exit(migrate.status ?? 1);

  const seed = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", DB_NAME, ...localFlag, "--file", "scripts/bsb-generated.sql"],
    { stdio: "inherit", cwd: rootDir },
  );
  if (seed.status !== 0) process.exit(seed.status ?? 1);

  console.log("BSB seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
