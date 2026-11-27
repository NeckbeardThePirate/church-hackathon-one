#!/usr/bin/env python3
"""Build SQL for Matthew Henry on John and Matthew 6.

Source: Matthew Henry, Commentary on the Whole Bible, Volume V (Matthew to John),
public domain, Christian Classics Ethereal Library.
https://www.ccel.org/ccel/henry/mhc5
Plain text: https://www.ccel.org/ccel/h/henry/mhc5/cache/mhc5.txt

Usage:
  python3 -I scripts/build-commentary-sql.py [mhc5.txt] [out.sql]

With no text path, the script downloads the CCEL file and writes
data/matthew-henry.sql. Apply schema first, then the generated file:

  npx wrangler d1 execute church-hackathon-bible --remote --file=migrations/0005_commentaries.sql
  npx wrangler d1 execute church-hackathon-bible --remote --file=data/matthew-henry.sql
"""
import re
import sys
import urllib.request
from pathlib import Path

CCEL_TXT = "https://www.ccel.org/ccel/h/henry/mhc5/cache/mhc5.txt"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "matthew-henry.sql"

AUTHOR = "Matthew Henry"
YEAR = 1710
WORK = "Commentary on the Whole Bible"
ATTRIBUTION = (
    "Matthew Henry, Commentary on the Whole Bible, vol. 5 (Matthew to John), "
    "1706–1721. Public domain. Text from the Christian Classics Ethereal Library (ccel.org)."
)
LOC = 1_000_000
BOOKS = {
    "M A T T H E W.": ("matthew", 40, "Matt", "Matthew"),
    "J O H N.": ("john", 43, "John", "John"),
}
# Matthew: chapter 6 only (the Lord's Prayer). John: every chapter.
KEEP = {"matthew": {6}, "john": None}

TITLE_RE = re.compile(r"^[A-Z][A-Za-z0-9'’].*\.$")
CHAP_RE = re.compile(r"^CHAP\.\s+([IVXLCDM]+)\.")
SPACED_BOOK_RE = re.compile(r"^[A-Z]( [A-Z])+\.$")
PLAIN_BOOKS = {"Matthew", "Mark", "Luke", "John"}
VERSE_LINE_RE = re.compile(r"^(\d{1,3})\s+\S")
VERSE_NUM_RE = re.compile(r"(?:^|\s)(\d{1,3})\s+(?=[A-Za-z])")
CHAPTER_VERSES = {
    "matthew": {6: 34},
    "john": {
        1: 51, 2: 25, 3: 36, 4: 54, 5: 47, 6: 71, 7: 53, 8: 59, 9: 41, 10: 42,
        11: 57, 12: 50, 13: 38, 14: 31, 15: 27, 16: 33, 17: 26, 18: 40, 19: 42,
        20: 31, 21: 25,
    },
}
ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def roman_to_int(value: str) -> int:
    total = 0
    prev = 0
    for char in reversed(value.upper()):
        current = ROMAN[char]
        if current < prev:
            total -= current
        else:
            total += current
            prev = current
    return total


def to_roman(number: int) -> str:
    pairs = (
        (50, "l"),
        (40, "xl"),
        (10, "x"),
        (9, "ix"),
        (5, "v"),
        (4, "iv"),
        (1, "i"),
    )
    out = []
    for value, glyph in pairs:
        while number >= value:
            out.append(glyph)
            number -= value
    return "".join(out)


def q(value):
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def unwrap(lines):
    paragraphs = []
    current = []
    for line in lines:
        stripped = line.strip().strip("_").strip()
        if not stripped or set(stripped) <= {"_"}:
            if current:
                paragraphs.append(" ".join(current))
                current = []
            continue
        current.append(stripped)
    if current:
        paragraphs.append(" ".join(current))
    return "\n\n".join(paragraphs).strip()


def chapter_url(file_slug: str, chapter: int) -> str:
    # CCEL file i is the book introduction. Chapter 1 is file ii.
    return f"https://ccel.org/ccel/henry/mhc5.{file_slug}.{to_roman(chapter + 1)}.html"


def split_sections(lines):
    """Yield (title or None, body lines) for one chapter."""
    sections = []
    title = None
    body = []
    started = False
    for line in lines:
        stripped = line.strip()
        if TITLE_RE.match(stripped) and not stripped.startswith("CHAP."):
            if started or body:
                sections.append((title, body))
            title = stripped
            body = []
            started = True
            continue
        if stripped.startswith("CHAP."):
            continue
        body.append(line)
    if body or title:
        sections.append((title, body))
    return sections


def paragraphs_of(body):
    paragraphs = []
    current = []
    for line in body:
        stripped = line.strip()
        if not stripped or set(stripped) <= {"_"}:
            if current:
                paragraphs.append(current)
                current = []
            continue
        current.append(stripped)
    if current:
        paragraphs.append(current)
    return paragraphs


def section_text_and_range(body, slug, chapter, inherited):
    paragraphs = paragraphs_of(body)
    if not paragraphs:
        return None, inherited
    limit = CHAPTER_VERSES.get(slug, {}).get(chapter, 176)
    first = paragraphs[0]
    opening = VERSE_LINE_RE.match(first[0])
    nums = []
    if opening:
        for line in first:
            match = VERSE_LINE_RE.match(line)
            if match and int(match.group(1)) <= limit:
                nums.append(int(match.group(1)))
            # Wrapped quote lines also carry verse numbers mid-line.
            for found in VERSE_NUM_RE.findall(line):
                number = int(found)
                if 1 <= number <= limit:
                    nums.append(number)
    if nums:
        commentary_paras = paragraphs[1:]
        start = chapter * LOC + min(nums)
        end = chapter * LOC + max(nums)
        inherited = (start, end)
    else:
        commentary_paras = paragraphs
        start, end = inherited
    commentary = "\n\n".join(" ".join(para) for para in commentary_paras).strip()
    if len(commentary) < 80:
        return None, inherited
    return (commentary, start, end), inherited


def keep_chapter(slug, chapter):
    allowed = KEEP[slug]
    return allowed is None or chapter in allowed


def parse(text: str):
    rows = []
    book = None
    chapter = None
    chapter_lines = []
    intro_lines = []
    in_john_intro = False

    def flush_chapter():
        if not book or not chapter or not keep_chapter(book[0], chapter):
            return
        inherited = (chapter * LOC + 1, chapter * LOC + CHAPTER_VERSES[book[0]][chapter])
        for title, body in split_sections(chapter_lines):
            parsed, inherited = section_text_and_range(body, book[0], chapter, inherited)
            if not parsed:
                continue
            commentary, start, end = parsed
            verse_start = start % LOC
            verse_end = end % LOC
            chapter_end = CHAPTER_VERSES[book[0]][chapter]
            if verse_start == 1 and verse_end == chapter_end:
                label = f"{book[3]} {chapter}"
            elif verse_start == verse_end:
                label = f"{book[3]} {chapter}:{verse_start}"
            else:
                label = f"{book[3]} {chapter}:{verse_start}–{verse_end}"
            slug_ch = "mt" if book[0] == "matthew" else "jn"
            row_id = f"mhc-{slug_ch}-{chapter}-{verse_start}-{verse_end if verse_end != 999 else 'ch'}"
            if title and title not in commentary[:80]:
                stored = f"{title}\n\n{commentary}"
            else:
                stored = commentary
            rows.append(
                {
                    "id": row_id,
                    "label": label,
                    "url": chapter_url(book[2], chapter),
                    "book_id": book[1],
                    "start": start,
                    "end": end,
                    "text": stored,
                }
            )

    def close_john_intro():
        nonlocal in_john_intro
        if not in_john_intro:
            return
        intro = unwrap(intro_lines)
        marker = "It is not material to enquire"
        if marker in intro:
            intro = intro[intro.index(marker) :]
        if len(intro) >= 80:
            rows.append(
                {
                    "id": "mhc-jn-intro",
                    "label": "John (introduction)",
                    "url": "https://ccel.org/ccel/henry/mhc5.John.i.html",
                    "book_id": 43,
                    "start": 1 * LOC + 1,
                    "end": 1 * LOC + 18,
                    "text": intro,
                }
            )
        in_john_intro = False

    for raw in text.splitlines():
        stripped = raw.strip()
        if in_john_intro and stripped in BOOKS:
            close_john_intro()
        if in_john_intro:
            intro_lines.append(raw)
            continue
        # A new gospel (plain "Mark" or a spaced header) ends the previous book.
        # Otherwise Mark 6 is stored as Matthew 6.
        if stripped in PLAIN_BOOKS or (SPACED_BOOK_RE.match(stripped) and stripped not in BOOKS):
            flush_chapter()
            book = None
            chapter = None
            chapter_lines = []
            if stripped == "John":
                in_john_intro = True
                intro_lines = []
            continue
        if stripped in BOOKS:
            flush_chapter()
            book = BOOKS[stripped]
            chapter = None
            chapter_lines = []
            continue
        chap = CHAP_RE.match(stripped)
        if chap and book:
            flush_chapter()
            chapter = roman_to_int(chap.group(1))
            chapter_lines = []
            continue
        if book and chapter and keep_chapter(book[0], chapter):
            chapter_lines.append(raw)
    flush_chapter()

    # Duplicate verse ranges in one chapter get a suffix.
    seen = {}
    unique = []
    for row in rows:
        count = seen.get(row["id"], 0) + 1
        seen[row["id"]] = count
        if count > 1:
            row = {**row, "id": f"{row['id']}-{count}"}
        unique.append(row)
    return unique


def download(dest: Path) -> None:
    request = urllib.request.Request(CCEL_TXT, headers={"User-Agent": "StudyBuddy/0.1 (church study library)"})
    with urllib.request.urlopen(request, timeout=120) as response:
        dest.write_bytes(response.read())


def emit(rows, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as out:
        out.write("-- Matthew Henry, Commentary on the Whole Bible, vol. 5.\n")
        out.write("-- Public domain. Text: Christian Classics Ethereal Library.\n")
        out.write("-- https://ccel.org/ccel/henry/mhc5\n")
        out.write("DELETE FROM commentary_entries WHERE id LIKE 'mhc-%';\n")
        for row in rows:
            out.write(
                "INSERT INTO commentary_entries "
                "(id, author, year, work, section_label, source_url, attribution, book_id, loc_start, loc_end, text) "
                f"VALUES ({q(row['id'])},{q(AUTHOR)},{YEAR},{q(WORK)},{q(row['label'])},{q(row['url'])},"
                f"{q(ATTRIBUTION)},{row['book_id']},{row['start']},{row['end']},{q(row['text'])});\n"
            )
        out.write("INSERT INTO commentary_entries_fts(commentary_entries_fts) VALUES('rebuild');\n")
    print(f"wrote {len(rows)} sections to {out_path}", file=sys.stderr)


def main():
    args = sys.argv[1:]
    if len(args) >= 2:
        source, out_path = Path(args[0]), Path(args[1])
    elif len(args) == 1:
        source, out_path = Path(args[0]), DEFAULT_OUT
    else:
        source, out_path = Path("/tmp/mhc5.txt"), DEFAULT_OUT
        if not source.exists():
            print(f"downloading {CCEL_TXT}", file=sys.stderr)
            download(source)
    text = source.read_text(encoding="utf-8", errors="replace")
    head = text[:1200]
    if "Henry, Matthew" not in head or "Public domain" not in head or "Matthew to John" not in head:
        raise SystemExit("refusing to parse: file is not the CCEL Matthew Henry volume V text")
    rows = parse(text)
    john = sum(1 for row in rows if row["book_id"] == 43)
    matthew = sum(1 for row in rows if row["book_id"] == 40)
    if john < 40 or matthew < 3:
        raise SystemExit(f"parse looked short (john={john}, matthew={matthew})")
    emit(rows, out_path)


if __name__ == "__main__":
    main()
