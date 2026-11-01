#!/usr/bin/env python3
"""Build SQL inserts for father_quotes + confession_* tables.

Usage: python3 -I scripts/build-library-sql.py <commentaries.sqlite> <creeds_dir> <out.sql>
  commentaries.sqlite: https://github.com/HistoricalChristianFaith/Commentaries-Database/releases
  creeds_dir: creeds/*.json from https://github.com/NonlinearFruit/Creeds.json
Then: npx wrangler d1 execute church-hackathon-bible --remote --file=<out.sql>
"""
import json, os, re, sqlite3, sys

BOOKS = ["genesis","exodus","leviticus","numbers","deuteronomy","joshua","judges","ruth","1samuel","2samuel",
 "1kings","2kings","1chronicles","2chronicles","ezra","nehemiah","esther","job","psalms","proverbs","ecclesiastes",
 "song","isaiah","jeremiah","lamentations","ezekiel","daniel","hosea","joel","amos","obadiah","jonah","micah",
 "nahum","habakkuk","zephaniah","haggai","zechariah","malachi","matthew","mark","luke","john","acts","romans",
 "1corinthians","2corinthians","galatians","ephesians","philippians","colossians","1thessalonians",
 "2thessalonians","1timothy","2timothy","titus","philemon","hebrews","james","1peter","2peter","1john","2john",
 "3john","jude","revelation"]
BOOK_ID = {slug: i + 1 for i, slug in enumerate(BOOKS)}
BOOK_ID["songofsolomon"] = BOOK_ID["song"]
OSIS = ["Gen","Exod","Lev","Num","Deut","Josh","Judg","Ruth","1Sam","2Sam","1Kgs","2Kgs","1Chr","2Chr","Ezra","Neh",
 "Esth","Job","Ps","Prov","Eccl","Song","Isa","Jer","Lam","Ezek","Dan","Hos","Joel","Amos","Obad","Jonah","Mic","Nah",
 "Hab","Zeph","Hag","Zech","Mal","Matt","Mark","Luke","John","Acts","Rom","1Cor","2Cor","Gal","Eph","Phil","Col",
 "1Thess","2Thess","1Tim","2Tim","Titus","Phlm","Heb","Jas","1Pet","2Pet","1John","2John","3John","Jude","Rev"]
OSIS_ID = {o: i + 1 for i, o in enumerate(OSIS)}

def q(v):
    if v is None: return "NULL"
    if isinstance(v, int): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def clean(t):
    return re.sub(r"\s+", " ", (t or "")).strip()

def fathers(db, out):
    con = sqlite3.connect(db)
    meta = {r[0]: r[1:] for r in con.execute("select name, default_year, father_category, condemned_by_council from father_meta")}
    n = skipped = 0
    for (cid, author, append, book, ls, le, txt, url, title) in con.execute(
        "select id, father_name, append_to_author_name, book, location_start, location_end, txt, source_url, source_title from commentary"):
        year, cat, condemned = meta.get(author, (None, None, 0))
        bid = BOOK_ID.get(book)
        text = clean(txt)
        # Fathers only: drop scripture, Second Temple, and modern (often still-copyrighted) authors.
        if not bid or not text or cat in ("Canonical Scriptures", "Second Temple Judaism", "Reformation & Modern"):
            skipped += 1; continue
        try: year = int(str(year).strip())
        except (TypeError, ValueError): year = None
        name = author + (append or "")
        out.write(f"INSERT OR REPLACE INTO father_quotes VALUES ({q(cid)},{q(name)},{q(year)},{q(cat)},{q(clean(title) or None)},{q(url or None)},{bid},{int(ls)},{int(le or ls)},{q(text)},{1 if condemned else 0});\n")
        n += 1
    print(f"fathers: {n} rows ({skipped} skipped)", file=sys.stderr)

def osis_loc(ref):
    m = re.fullmatch(r"([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?", ref)
    if not m or m.group(1) not in OSIS_ID: return None
    return OSIS_ID[m.group(1)], int(m.group(2)) * 1000000 + int(m.group(3) or 0)

def proof_rows(sid, proofs, out):
    for p in proofs or []:
        for ref in p.get("References", []):
            a, _, b = ref.partition("-")
            s = osis_loc(a); e = osis_loc(b) if b else s
            if not s or not e or s[0] != e[0]: continue
            end = e[1] if e[1] % 1000000 else e[1] + 999
            out.write(f"INSERT INTO confession_proofs VALUES ({q(sid)},{s[0]},{s[1]},{end});\n")

def confessions(creeds_dir, out):
    n = 0
    for fname in sorted(os.listdir(creeds_dir)):
        if not fname.endswith(".json"): continue
        d = json.load(open(os.path.join(creeds_dir, fname)))
        m = d["Metadata"]
        if not str(m.get("SourceAttribution", "")).startswith("Public Domain"):
            print(f"skip (copyright): {fname}", file=sys.stderr); continue
        slug, title, year, fmt = fname[:-5], m["Title"], m.get("Year"), m.get("CreedFormat")
        rows = []  # (label, title, text, proofs)
        data = d["Data"]
        if isinstance(data, dict):
            rows.append(("", "", data.get("Content", ""), data.get("Proofs")))
        else:
            for item in data:
                if "Question" in item:
                    rows.append((f"Q{item['Number']}", item["Question"], f"Q. {item['Question']} A. {item['Answer']}", item.get("Proofs")))
                    for sub in item.get("SubQuestions") or []:
                        rows.append((f"Q{item['Number']}.{sub['Number']}", sub["Question"], f"Q. {sub['Question']} A. {sub['Answer']}", None))
                elif "Sections" in item:
                    for sec in item["Sections"]:
                        label = f"{item['Chapter']}.{sec.get('Section', '')}".rstrip(".")
                        rows.append((label, item.get("Title", ""), sec.get("Content", ""), sec.get("Proofs")))
                else:
                    rows.append((f"Art. {item.get('Article', '')}", item.get("Title", ""), item.get("Content", ""), item.get("Proofs")))
        for label, sec_title, text, proofs in rows:
            text = clean(text)
            if not text: continue
            sid = f"{slug}:{label or 'all'}"
            label_out = (f"Ch. {label}" if fmt == "Confession" else label) or None
            out.write(f"INSERT OR REPLACE INTO confession_sections VALUES ({q(sid)},{q(slug)},{q(title)},{q(year)},{q(fmt)},{q(label_out)},{q(clean(sec_title) or None)},{q(text)});\n")
            proof_rows(sid, proofs, out)
            n += 1
    print(f"confessions: {n} sections", file=sys.stderr)

if __name__ == "__main__":
    db, creeds_dir, out_path = sys.argv[1:4]
    with open(out_path, "w") as out:
        out.write("DELETE FROM father_quotes;\nDELETE FROM confession_sections;\nDELETE FROM confession_proofs;\n")
        fathers(db, out)
        confessions(creeds_dir, out)
        out.write("INSERT INTO father_quotes_fts(father_quotes_fts) VALUES('rebuild');\n")
        out.write("INSERT INTO confession_sections_fts(confession_sections_fts) VALUES('rebuild');\n")
