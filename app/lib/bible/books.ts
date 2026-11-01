export type BibleBook = {
  id: number;
  slug: string;
  name: string;
  aliases: string[];
};

/** Berean Standard Bible (BSB) — 66-book Protestant canon, wldeh/bible-api slugs. */
export const BIBLE_BOOKS: BibleBook[] = [
  { id: 1, slug: "genesis", name: "Genesis", aliases: ["gen", "ge", "gn"] },
  { id: 2, slug: "exodus", name: "Exodus", aliases: ["exod", "ex", "exo"] },
  { id: 3, slug: "leviticus", name: "Leviticus", aliases: ["lev", "le", "lv"] },
  { id: 4, slug: "numbers", name: "Numbers", aliases: ["num", "nu", "nm", "nb"] },
  { id: 5, slug: "deuteronomy", name: "Deuteronomy", aliases: ["deut", "deu", "dt"] },
  { id: 6, slug: "joshua", name: "Joshua", aliases: ["josh", "jos", "jsh"] },
  { id: 7, slug: "judges", name: "Judges", aliases: ["judg", "jdg", "jg", "jdgs"] },
  { id: 8, slug: "ruth", name: "Ruth", aliases: ["ru", "rt"] },
  { id: 9, slug: "1samuel", name: "1 Samuel", aliases: ["1 sam", "1sam", "1 sa", "1sa", "i samuel", "i sam"] },
  { id: 10, slug: "2samuel", name: "2 Samuel", aliases: ["2 sam", "2sam", "2 sa", "2sa", "ii samuel", "ii sam"] },
  { id: 11, slug: "1kings", name: "1 Kings", aliases: ["1 kgs", "1kgs", "1 ki", "1ki", "1 kings", "i kings"] },
  { id: 12, slug: "2kings", name: "2 Kings", aliases: ["2 kgs", "2kgs", "2 ki", "2ki", "2 kings", "ii kings"] },
  { id: 13, slug: "1chronicles", name: "1 Chronicles", aliases: ["1 chr", "1chr", "1 ch", "1ch", "i chronicles"] },
  { id: 14, slug: "2chronicles", name: "2 Chronicles", aliases: ["2 chr", "2chr", "2 ch", "2ch", "ii chronicles"] },
  { id: 15, slug: "ezra", name: "Ezra", aliases: ["ezr"] },
  { id: 16, slug: "nehemiah", name: "Nehemiah", aliases: ["neh", "ne"] },
  { id: 17, slug: "esther", name: "Esther", aliases: ["est", "es"] },
  { id: 18, slug: "job", name: "Job", aliases: ["jb"] },
  { id: 19, slug: "psalms", name: "Psalms", aliases: ["psalm", "ps", "psa", "pss"] },
  { id: 20, slug: "proverbs", name: "Proverbs", aliases: ["prov", "pro", "prv", "pr"] },
  { id: 21, slug: "ecclesiastes", name: "Ecclesiastes", aliases: ["eccl", "ecc", "ec", "qoh"] },
  { id: 22, slug: "song", name: "Song of Solomon", aliases: ["song of songs", "sos", "ss", "cant"] },
  { id: 23, slug: "isaiah", name: "Isaiah", aliases: ["isa", "is"] },
  { id: 24, slug: "jeremiah", name: "Jeremiah", aliases: ["jer", "je", "jr"] },
  { id: 25, slug: "lamentations", name: "Lamentations", aliases: ["lam", "la"] },
  { id: 26, slug: "ezekiel", name: "Ezekiel", aliases: ["ezek", "eze", "ezk"] },
  { id: 27, slug: "daniel", name: "Daniel", aliases: ["dan", "da", "dn"] },
  { id: 28, slug: "hosea", name: "Hosea", aliases: ["hos", "ho"] },
  { id: 29, slug: "joel", name: "Joel", aliases: ["jl"] },
  { id: 30, slug: "amos", name: "Amos", aliases: ["am"] },
  { id: 31, slug: "obadiah", name: "Obadiah", aliases: ["obad", "ob"] },
  { id: 32, slug: "jonah", name: "Jonah", aliases: ["jnh", "jon"] },
  { id: 33, slug: "micah", name: "Micah", aliases: ["mic", "mc"] },
  { id: 34, slug: "nahum", name: "Nahum", aliases: ["nah", "na"] },
  { id: 35, slug: "habakkuk", name: "Habakkuk", aliases: ["hab", "hb"] },
  { id: 36, slug: "zephaniah", name: "Zephaniah", aliases: ["zeph", "zep", "zp"] },
  { id: 37, slug: "haggai", name: "Haggai", aliases: ["hag", "hg"] },
  { id: 38, slug: "zechariah", name: "Zechariah", aliases: ["zech", "zec", "zc"] },
  { id: 39, slug: "malachi", name: "Malachi", aliases: ["mal", "ml"] },
  { id: 40, slug: "matthew", name: "Matthew", aliases: ["matt", "mat", "mt"] },
  { id: 41, slug: "mark", name: "Mark", aliases: ["mk", "mr"] },
  { id: 42, slug: "luke", name: "Luke", aliases: ["lk", "lu"] },
  { id: 43, slug: "john", name: "John", aliases: ["jn", "jhn", "joh"] },
  { id: 44, slug: "acts", name: "Acts", aliases: ["act", "ac"] },
  { id: 45, slug: "romans", name: "Romans", aliases: ["rom", "ro", "rm"] },
  { id: 46, slug: "1corinthians", name: "1 Corinthians", aliases: ["1 cor", "1cor", "1 co", "1co", "i corinthians"] },
  { id: 47, slug: "2corinthians", name: "2 Corinthians", aliases: ["2 cor", "2cor", "2 co", "2co", "ii corinthians"] },
  { id: 48, slug: "galatians", name: "Galatians", aliases: ["gal", "ga"] },
  { id: 49, slug: "ephesians", name: "Ephesians", aliases: ["eph", "ephes"] },
  { id: 50, slug: "philippians", name: "Philippians", aliases: ["phil", "php", "pp"] },
  { id: 51, slug: "colossians", name: "Colossians", aliases: ["col", "co"] },
  { id: 52, slug: "1thessalonians", name: "1 Thessalonians", aliases: ["1 thess", "1thess", "1 th", "1th"] },
  { id: 53, slug: "2thessalonians", name: "2 Thessalonians", aliases: ["2 thess", "2thess", "2 th", "2th"] },
  { id: 54, slug: "1timothy", name: "1 Timothy", aliases: ["1 tim", "1tim", "1 ti", "1ti"] },
  { id: 55, slug: "2timothy", name: "2 Timothy", aliases: ["2 tim", "2tim", "2 ti", "2ti"] },
  { id: 56, slug: "titus", name: "Titus", aliases: ["tit", "ti"] },
  { id: 57, slug: "philemon", name: "Philemon", aliases: ["phlm", "phm"] },
  { id: 58, slug: "hebrews", name: "Hebrews", aliases: ["heb", "he"] },
  { id: 59, slug: "james", name: "James", aliases: ["jas", "jm"] },
  { id: 60, slug: "1peter", name: "1 Peter", aliases: ["1 pet", "1pet", "1 pe", "1pe", "1 pt", "1pt"] },
  { id: 61, slug: "2peter", name: "2 Peter", aliases: ["2 pet", "2pet", "2 pe", "2pe", "2 pt", "2pt"] },
  { id: 62, slug: "1john", name: "1 John", aliases: ["1 jn", "1jn", "1 joh", "1john"] },
  { id: 63, slug: "2john", name: "2 John", aliases: ["2 jn", "2jn"] },
  { id: 64, slug: "3john", name: "3 John", aliases: ["3 jn", "3jn"] },
  { id: 65, slug: "jude", name: "Jude", aliases: ["jud", "jd"] },
  { id: 66, slug: "revelation", name: "Revelation", aliases: ["rev", "re", "apocalypse", "revelations"] },
];

/** Chapter counts (Protestant canon), matches wldeh/bible-api en-bsb layout. */
export const BIBLE_CHAPTER_COUNT: Record<string, number> = {
  genesis: 50,
  exodus: 40,
  leviticus: 27,
  numbers: 36,
  deuteronomy: 34,
  joshua: 24,
  judges: 21,
  ruth: 4,
  "1samuel": 31,
  "2samuel": 24,
  "1kings": 22,
  "2kings": 25,
  "1chronicles": 29,
  "2chronicles": 36,
  ezra: 10,
  nehemiah: 13,
  esther: 10,
  job: 42,
  psalms: 150,
  proverbs: 31,
  ecclesiastes: 12,
  song: 8,
  isaiah: 66,
  jeremiah: 52,
  lamentations: 5,
  ezekiel: 48,
  daniel: 12,
  hosea: 14,
  joel: 3,
  amos: 9,
  obadiah: 1,
  jonah: 4,
  micah: 7,
  nahum: 3,
  habakkuk: 3,
  zephaniah: 3,
  haggai: 2,
  zechariah: 14,
  malachi: 4,
  matthew: 28,
  mark: 16,
  luke: 24,
  john: 21,
  acts: 28,
  romans: 16,
  "1corinthians": 16,
  "2corinthians": 13,
  galatians: 6,
  ephesians: 6,
  philippians: 4,
  colossians: 4,
  "1thessalonians": 5,
  "2thessalonians": 3,
  "1timothy": 6,
  "2timothy": 4,
  titus: 3,
  philemon: 1,
  hebrews: 13,
  james: 5,
  "1peter": 5,
  "2peter": 3,
  "1john": 5,
  "2john": 1,
  "3john": 1,
  jude: 1,
  revelation: 22,
};

const bySlug = new Map(BIBLE_BOOKS.map((book) => [book.slug, book]));

const aliasToBook = new Map<string, BibleBook>();
for (const book of BIBLE_BOOKS) {
  aliasToBook.set(normalizeAlias(book.name), book);
  aliasToBook.set(normalizeAlias(book.slug), book);
  for (const alias of book.aliases) {
    aliasToBook.set(normalizeAlias(alias), book);
  }
}

function normalizeAlias(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function bookBySlug(slug: string): BibleBook | undefined {
  return bySlug.get(slug);
}

export function bookByAlias(fragment: string): BibleBook | undefined {
  return aliasToBook.get(normalizeAlias(fragment));
}
