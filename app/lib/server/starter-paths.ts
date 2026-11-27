/**
 * Ready-made learn paths for an empty workspace.
 * Lesson prose is prepared ahead of time so opening one does not call a model.
 * Passage and library wording is copied from D1 when the row exists, and from the
 * bundled public-domain text otherwise. Nothing here migrates D1.
 */
import { findBibleReferences } from "@/app/lib/bible/parse-reference";
import { isStarterPathId, STARTER_PLAN_IDS, type StarterPathId } from "@/app/lib/learn/starters";
import type {
  LearnLesson,
  LearnPlan,
  LibraryCitation,
  QuizItem,
  ScriptureReading,
  TeachBlock,
} from "@/app/lib/learn/types";
import { isEmptyLearnPath, type Project } from "@/app/lib/projects";
import { fetchPassagesFromD1, type PassageResult } from "./bible-db";
import { resolveLibraryRefs } from "./learn/library-cite";
import { shuffleQuizChoices } from "./learn/quiz-items.ts";
import type { LibraryEnv } from "./library-search";

const JOHN_KEY = "The Word was God and became flesh.";
const LIFE_KEY = "Believing brings life.";
const LORDS_KEY =
  "Both address God as Father and ask for daily bread; Matthew is longer, with extra petitions Luke omits.";

const WCF_8_2 =
  "The Son of God, the second person in the Trinity, being very and eternal God, of one substance and equal with the Father, did, when the fullness of time was come, take upon him man's nature, with all the essential properties, and common infirmities thereof, yet without sin; being conceived by the power of the Holy Ghost, in the womb of the virgin Mary, of her substance. So that two whole, perfect, and distinct natures, the Godhead and the manhood, were inseparably joined together in one person, without conversion, composition, or confusion. Which person is very God, and very man, yet one Christ, the only Mediator between God and man.";

const WCF_14_2 =
  "By this faith, a Christian believeth to be true whatsoever is revealed in the Word, for the authority of God himself speaking therein; and acteth differently upon that which each particular passage thereof containeth; yielding obedience to the commands, trembling at the threatenings, and embracing the promises of God for this life, and that which is to come. But the principal acts of saving faith are accepting, receiving, and resting upon Christ alone for justification, sanctification, and eternal life, by virtue of the covenant of grace.";

const AUGUSTINE =
  "If the Word was not ashamed to be born of man, are men ashamed to be born of God? And because He did this, He cured us; and because He cured us, we see. For this, “that the Word was made flesh, and dwelt among us,” became a medicine unto us, so that as by earth we were made blind, by earth we might be healed; and having been healed, might behold what? “And we beheld,” he says, “His glory, the glory as of the Only-begotten of the Father, full of grace and truth.”";

const WLC_186 =
  "The whole Word of God is of use to direct us in the duty of prayer; but the special rule of direction is that form of prayer which our Savior Christ taught his disciples, commonly called the Lord's Prayer.";

const CYPRIAN =
  "Before all things, the Teacher of peace and the Master of unity would not have prayer to be made singly and individually, as for one who prays to pray for himself alone. For we say not “My Father, which art in heaven,” nor “Give me this day my daily bread;” nor does each one ask that only his own debt should be forgiven him; nor does he request for himself alone that he may not be led into temptation, and delivered from evil. Our prayer is public and common; and when we pray, we pray not for one, but for the whole people, because we the whole people are one.";

const KJV = {
  john11:
    "In the beginning was the Word, and the Word was with God, and the Word was God. The same was in the beginning with God. All things were made by him; and without him was not any thing made that was made.",
  john114:
    "And the Word was made flesh, and dwelt among us, (and we beheld his glory, the glory as of the only begotten of the Father,) full of grace and truth.",
  john2030:
    "And many other signs truly did Jesus in the presence of his disciples, which are not written in this book: But these are written, that ye might believe that Jesus is the Christ, the Son of God; and that believing ye might have life through his name.",
  matt69:
    "After this manner therefore pray ye: Our Father which art in heaven, Hallowed be thy name. Thy kingdom come. Thy will be done in earth, as it is in heaven. Give us this day our daily bread. And forgive us our debts, as we forgive our debtors. And lead us not into temptation, but deliver us from evil: For thine is the kingdom, and the power, and the glory, for ever. Amen.",
  luke112:
    "And he said unto them, When ye pray, say, Our Father which art in heaven, Hallowed be thy name. Thy kingdom come. Thy will be done, as in heaven, so in earth. Give us day by day our daily bread. And forgive us our sins; for we also forgive every one that is indebted to us. And lead us not into temptation; but deliver us from evil.",
  matt611: "Give us this day our daily bread.",
  luke113: "Give us day by day our daily bread.",
} as const;

type ScriptureSlot = { reference: string; note: string; bundledText: string };
type LibrarySlot = { lookup: string; note: string; bundled: LibraryCitation };

type LessonDraft = {
  id: string;
  order: number;
  title: string;
  objectives: string[];
  prerequisiteLessonIds: string[];
  estimatedMinutes: number;
  teaching: TeachBlock[];
  quiz: QuizItem[];
  kind?: "core" | "gap";
  sourceLessonId?: string;
  sourceConceptIds?: string[];
  scripture: ScriptureSlot[];
  library: LibrarySlot[];
};

type StarterDraft = {
  id: StarterPathId;
  projectId: string;
  planId: string;
  title: string;
  topic: string;
  objectives: string[];
  prerequisites: string[];
  lessons: LessonDraft[];
  finalAssessment: QuizItem[];
};

export type WorkspaceSeed = {
  listProjects(): Project[] | Promise<Project[]>;
  upsertProject(input: unknown): Project | Promise<Project>;
};

export type SeedResult =
  | { ok: true; project: Project; created: boolean }
  | { ok: false; status: 400 | 409; error: string };

function paragraph(text: string): TeachBlock {
  return { type: "paragraph", text };
}

function heading(text: string): TeachBlock {
  return { type: "heading2", text };
}

function bullet(text: string): TeachBlock {
  return { type: "bullet", text };
}

function mc(
  question: string,
  choices: string[],
  answer: string,
  rationale: string,
  conceptId: string,
  conceptLabel: string,
): QuizItem {
  return { kind: "mc", question, choices, answer, rationale, objectiveIndex: 0, conceptId, conceptLabel };
}

function short(question: string, answer: string, rationale: string, conceptId: string, conceptLabel: string): QuizItem {
  return { kind: "short", question, answer, rationale, objectiveIndex: 0, conceptId, conceptLabel };
}

function confession(
  id: string,
  label: string,
  detail: string,
  text: string,
): LibraryCitation {
  return { id, source: "confession", label, detail, text, note: "" };
}

function father(id: string, label: string, detail: string, text: string, url: string): LibraryCitation {
  return { id, source: "father", label, detail, text, note: "", url };
}

const JOHN: StarterDraft = {
  id: "john",
  projectId: "starter-john",
  planId: STARTER_PLAN_IDS.john,
  title: "The Gospel of John",
  topic: "The Gospel of John",
  prerequisites: ["Willingness to read a short Gospel prologue slowly."],
  objectives: [
    "Say that the Word was with God and was God",
    "Explain that the Word was made flesh without giving up that he is God",
    "State why John says these signs were written",
  ],
  lessons: [
    {
      id: "l1",
      order: 1,
      title: "The Word with God",
      objectives: ["Say where the Word was", "Name what the Word became"],
      prerequisiteLessonIds: [],
      estimatedMinutes: 18,
      kind: "core",
      teaching: [
        paragraph(
          "John opens before Bethlehem. The first sentence does not start with a birth. It starts with the Word, who already was.",
        ),
        heading("With God, and God"),
        paragraph(
          "Read the opening below. It says the Word was with God, and the Word was God. Those are two claims, not one. “With God” keeps a distinction. “Was God” refuses to make the Word a lesser being. The same verses hold both, and they say all things were made by him.",
        ),
        heading("Made flesh"),
        paragraph(
          "Later in the same chapter the Word was made flesh and dwelt among us. Made, here, means became: a real human life, not a costume. Hold the two claims together. The Word was God and became flesh.",
        ),
        paragraph(
          "The confession beside the passages is about Christ the Mediator, not a commentary written on John. It says the Son, very and eternal God, took man’s nature, so that two whole natures, the Godhead and the manhood, were joined in one person, without conversion, composition, or confusion. Set that claim next to “with God” and “was made flesh.”",
        ),
      ],
      scripture: [
        {
          reference: "John 1:1-3",
          note: "The opening claims: the Word was with God, and the Word was God, and all things were made by him.",
          bundledText: KJV.john11,
        },
        {
          reference: "John 1:14",
          note: "The Word was made flesh and dwelt among us.",
          bundledText: KJV.john114,
        },
      ],
      library: [
        {
          lookup: "Westminster Confession of Faith 8.2",
          note: "Of Christ the Mediator. Two natures in one person. It is not a commentary on John 1.",
          bundled: confession(
            "bundled-wcf-8-2",
            "Westminster Confession of Faith 8.2",
            "Of Christ the Mediator",
            WCF_8_2,
          ),
        },
      ],
      quiz: [
        mc(
          "In the opening of John, the Word was",
          ["With God, and God", "A creature made first", "Only a title for Moses", "Absent until Bethlehem"],
          "With God, and God",
          "The lesson says the Word was with God, and the Word was God.",
          "l1-word",
          "With God, and God",
        ),
        mc(
          "The same chapter says the Word was made",
          ["Flesh", "A parable only", "A temple building", "Invisible forever"],
          "Flesh",
          "The lesson says the Word was made flesh and dwelt among us.",
          "l1-flesh",
          "Made flesh",
        ),
        short(
          "What does this lesson claim about the Word?",
          JOHN_KEY,
          "The Word was God, and the Word became flesh. Both claims stay.",
          "l1-claim",
          "Word and flesh",
        ),
      ],
    },
    {
      id: "gap-l1-1",
      order: 2,
      title: "Practice: Made flesh",
      objectives: ["Restate the two claims without copying the lesson’s sentence", "Name what the Word was made"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 10,
      kind: "gap",
      sourceLessonId: "l1",
      sourceConceptIds: ["l1-claim"],
      teaching: [
        paragraph("This practice lesson stays with one claim from the opening of John."),
        paragraph(
          "The Word was God and became flesh. “Was God” is not withdrawn when “made flesh” is added. Made means became: the Word took a real human life. Nothing in the verses says he stopped being God.",
        ),
        paragraph(
          "The confession’s sentence, set beside the same readings, says two whole natures, the Godhead and the manhood, were joined in one person, without conversion, composition, or confusion. The passages below are the same readings. Use them to check the claim, not as a new story.",
        ),
      ],
      scripture: [
        {
          reference: "John 1:1-3",
          note: "The same opening, retrieved again for the practice lesson.",
          bundledText: KJV.john11,
        },
        {
          reference: "John 1:14",
          note: "The same flesh verse, retrieved again for the practice lesson.",
          bundledText: KJV.john114,
        },
      ],
      library: [
        {
          lookup: "Westminster Confession of Faith 8.2",
          note: "The same mediator sentence, set beside the prologue rather than beside the signs.",
          bundled: confession(
            "bundled-wcf-8-2",
            "Westminster Confession of Faith 8.2",
            "Of Christ the Mediator",
            WCF_8_2,
          ),
        },
      ],
      quiz: [
        mc(
          "The practice lesson says the Word",
          [
            "Was God and became flesh",
            "Was made after the world",
            "Stopped being God when he became flesh",
            "Was only a human teacher",
          ],
          "Was God and became flesh",
          "The practice lesson repeats both claims.",
          "l1-claim",
          "Word and flesh",
        ),
        short(
          "Which two natures does the confession keep in one person?",
          "The Godhead and the manhood.",
          "The confession says the Godhead and the manhood were joined in one person.",
          "l1-natures",
          "Two natures",
        ),
      ],
    },
    {
      id: "l2",
      order: 3,
      title: "Written that you may believe",
      objectives: ["Say what John calls the works in this book", "State the purpose of the writing"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 16,
      kind: "core",
      teaching: [
        paragraph(
          "John does not say he wrote down every work of Jesus. He says many other signs were done in the presence of the disciples, and that the ones in this book are written for a purpose.",
        ),
        heading("Christ, and life"),
        paragraph(
          "The purpose is in the reading below. These are written so that you may believe that Jesus is the Christ, the Son of God, and that believing you may have life through his name. The lesson keeps both halves: who Jesus is, and the life that believing brings.",
        ),
        paragraph(
          "A second confession line, on saving faith, sits beside that purpose. It is not a verse-by-verse note on John 20. It says the principal acts of saving faith are accepting, receiving, and resting upon Christ alone for justification, sanctification, and eternal life.",
        ),
        paragraph(
          "The church father quoted here is Augustine on this Gospel, not a second author of the verse. He says the Word was not ashamed to be born of man, and that the Word made flesh became a medicine, so that as by earth we were made blind, by earth we might be healed. The lesson sets that sermon next to John’s purpose. The verse says believing brings life. Augustine is preaching the incarnation as healing. He does not replace the verse.",
        ),
      ],
      scripture: [
        {
          reference: "John 20:30-31",
          note: "Why the signs were written: that you may believe, and that believing you may have life.",
          bundledText: KJV.john2030,
        },
      ],
      library: [
        {
          lookup: "Westminster Confession of Faith 14.2",
          note: "Of Saving Faith. The principal acts rest on Christ for eternal life. Not a commentary on John 20.",
          bundled: confession("bundled-wcf-14-2", "Westminster Confession of Faith 14.2", "Of Saving Faith", WCF_14_2),
        },
        {
          lookup: "Augustine, Tractates on the Gospel of John",
          note: "Augustine on this Gospel: the Word made flesh became a medicine. He is preaching John, not replacing the verse.",
          bundled: father(
            "bundled-augustine-john",
            "Augustine",
            "Tractates on the Gospel of John",
            AUGUSTINE,
            "https://ccel.org/ccel/schaff/npnf107/npnf107.iii.iv.html",
          ),
        },
      ],
      quiz: [
        mc(
          "John says many other signs",
          [
            "Are not written in this book",
            "Are listed only as a temple calendar",
            "Replace the prologue",
            "Were hidden from the disciples",
          ],
          "Are not written in this book",
          "The lesson says many other signs were done, and are not written in this book.",
          "l2-signs",
          "Signs not written",
        ),
        mc(
          "These are written so that the reader may",
          [
            "Believe that Jesus is the Christ, the Son of God",
            "Memorize the temple calendar",
            "Skip the prologue",
            "Add a longer prayer",
          ],
          "Believe that Jesus is the Christ, the Son of God",
          "The lesson says the signs are written so that you may believe that Jesus is the Christ, the Son of God.",
          "l2-believe",
          "That you may believe",
        ),
        short(
          "What does this lesson say believing brings?",
          LIFE_KEY,
          "Believing brings life through his name.",
          "l2-life",
          "Life through his name",
        ),
      ],
    },
  ],
  finalAssessment: [
    mc(
      "The opening of John says the Word was",
      ["With God, and God", "Created on the first day", "A proverb of Solomon", "Silent until the cross"],
      "With God, and God",
      "The Word was with God, and the Word was God.",
      "l1-word",
      "With God, and God",
    ),
    short(
      "What does this path claim about the Word?",
      JOHN_KEY,
      "The Word was God and became flesh.",
      "l1-claim",
      "Word and flesh",
    ),
    mc(
      "John says the signs are written so that readers may",
      ["Believe and have life", "Copy the temple rites", "Skip the prologue", "Add a longer prayer"],
      "Believe and have life",
      "The book’s purpose is belief, and life through his name.",
      "l2-life",
      "Life through his name",
    ),
  ],
};

const LORDS: StarterDraft = {
  id: "lords-prayer",
  projectId: "starter-lords-prayer",
  planId: STARTER_PLAN_IDS["lords-prayer"],
  title: "The Lord’s Prayer",
  topic: "The Lord’s Prayer",
  prerequisites: ["Willingness to compare two short passages."],
  objectives: [
    "Name one feature Matthew and Luke share and one Matthew keeps",
    "Notice the prayer’s plural pronouns",
    "Describe the petition for daily bread in both forms",
  ],
  lessons: [
    {
      id: "l1",
      order: 1,
      title: "Our Father",
      objectives: ["Place each form in its Gospel", "Name one shared line and one line Luke omits"],
      prerequisiteLessonIds: [],
      estimatedMinutes: 20,
      kind: "core",
      teaching: [
        paragraph(
          "Jesus teaches a prayer in two places. Matthew sets it in the Sermon on the Mount. Luke sets it when a disciple asks to be taught to pray.",
        ),
        heading("Shared and longer"),
        paragraph(
          "Both address God as Father and ask for daily bread. Matthew is longer, with extra petitions Luke omits. Matthew keeps a line about God’s will being done on earth as in heaven, and a closing doxology. Luke’s form is shorter. The two readings below are the texts. Compare them line by line rather than memorizing a blend.",
        ),
        heading("Our, not my"),
        paragraph(
          "The catechism calls this prayer the special rule of direction for prayer, while still saying the whole Word of God is of use. Cyprian, writing in the third century, notices the pronouns: the prayer says our and us, not my and me. He calls the prayer public and common, offered for the whole people.",
        ),
      ],
      scripture: [
        {
          reference: "Matthew 6:9-13",
          note: "Matthew’s longer form, in the Sermon on the Mount.",
          bundledText: KJV.matt69,
        },
        {
          reference: "Luke 11:2-4",
          note: "Luke’s shorter form. Compare it with Matthew rather than blending them.",
          bundledText: KJV.luke112,
        },
      ],
      library: [
        {
          lookup: "Westminster Larger Catechism, 186",
          note: "The catechism names this prayer as the special rule of direction.",
          bundled: confession("bundled-wlc-186", "Westminster Larger Catechism 186", "The rule for prayer", WLC_186),
        },
        {
          lookup: "Cyprian, On the Lord's Prayer",
          note: "Cyprian on the pronouns: our and us, not my and me.",
          bundled: father(
            "bundled-cyprian-lords-prayer",
            "Cyprian",
            "On the Lord’s Prayer 8",
            CYPRIAN,
            "https://ccel.org/ccel/schaff/anf05.iv.v.iv.html",
          ),
        },
      ],
      quiz: [
        mc(
          "Where does Matthew place this prayer?",
          ["In the Sermon on the Mount", "At the empty tomb", "In the temple market", "On the Emmaus road"],
          "In the Sermon on the Mount",
          "The lesson says Matthew sets it in the Sermon on the Mount.",
          "l1-matthew",
          "Matthew’s setting",
        ),
        mc(
          "Which form is longer?",
          ["Matthew", "Luke", "They are the same length", "Neither includes bread"],
          "Matthew",
          "The lesson says Matthew is longer, with extra petitions Luke omits.",
          "l1-longer",
          "Matthew is longer",
        ),
        short(
          "Name one shared and one varying feature of Matthew’s and Luke’s Lord’s Prayer.",
          LORDS_KEY,
          "Both open by calling God Father and ask for daily bread. Matthew keeps lines Luke leaves out.",
          "l1-compare",
          "Shared and varying lines",
        ),
      ],
    },
    {
      id: "gap-l1-1",
      order: 2,
      title: "Practice: Line-by-line comparison",
      objectives: ["Name a shared petition", "Name something Matthew keeps that Luke omits"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 10,
      kind: "gap",
      sourceLessonId: "l1",
      sourceConceptIds: ["l1-compare"],
      teaching: [
        paragraph("Set the two forms next to each other again."),
        bullet("Shared: both address God as Father, and both ask for daily bread."),
        bullet("Varying: Matthew is longer. It keeps extra petitions Luke omits, including the will done on earth and the doxology."),
        paragraph(
          "Cyprian’s sentence is still the one to check: the prayer says our Father and give us, not my Father and give me. He calls that prayer public and common, for the whole people.",
        ),
      ],
      scripture: [
        {
          reference: "Matthew 6:9-13",
          note: "Matthew again, for the line-by-line check.",
          bundledText: KJV.matt69,
        },
        {
          reference: "Luke 11:2-4",
          note: "Luke again. The shorter form is the one that omits lines.",
          bundledText: KJV.luke112,
        },
      ],
      library: [
        {
          lookup: "Cyprian, On the Lord's Prayer",
          note: "The practice lesson uses Cyprian’s our and us, not a new quotation.",
          bundled: father(
            "bundled-cyprian-lords-prayer",
            "Cyprian",
            "On the Lord’s Prayer 8",
            CYPRIAN,
            "https://ccel.org/ccel/schaff/anf05.iv.v.iv.html",
          ),
        },
      ],
      quiz: [
        mc(
          "Which petition do both forms share?",
          ["Daily bread", "A doxology only Matthew has", "A request to return to Moab", "A vow to a mother-in-law"],
          "Daily bread",
          "The practice lesson says both ask for daily bread.",
          "l1-compare",
          "Shared and varying lines",
        ),
        mc(
          "Cyprian says this prayer is offered for",
          ["The whole people", "The one who prays alone", "The dead only", "A single city"],
          "The whole people",
          "He calls the prayer public and common, for the whole people.",
          "l1-our",
          "Our, not my",
        ),
      ],
    },
    {
      id: "l2",
      order: 3,
      title: "Daily bread",
      objectives: ["Contrast this day with day by day", "Note the shift from debts to sins"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 15,
      kind: "core",
      teaching: [
        paragraph(
          "Both forms ask for bread. Matthew says this day. Luke says day by day. The request is for ordinary food, repeated, not a storehouse.",
        ),
        paragraph(
          "Forgiveness is the next shared petition, and the wording shifts. Matthew says debts. Luke says sins. In both, the one who prays also forgives.",
        ),
        paragraph(
          "The catechism still calls the whole prayer the church’s pattern. This lesson stays with the bread line and the forgiveness line, and leaves the address to the lesson before it.",
        ),
      ],
      scripture: [
        {
          reference: "Matthew 6:11",
          note: "Matthew’s bread line: this day.",
          bundledText: KJV.matt611,
        },
        {
          reference: "Luke 11:3",
          note: "Luke’s bread line: day by day.",
          bundledText: KJV.luke113,
        },
      ],
      library: [
        {
          lookup: "Westminster Larger Catechism, 186",
          note: "The catechism’s rule for the prayer as a whole, including this petition.",
          bundled: confession("bundled-wlc-186", "Westminster Larger Catechism 186", "The rule for prayer", WLC_186),
        },
      ],
      quiz: [
        mc(
          "Matthew’s bread line says",
          ["This day", "Day by day", "Once a year", "Never"],
          "This day",
          "The lesson says Matthew says this day and Luke says day by day.",
          "l2-bread",
          "Daily bread",
        ),
        mc(
          "Luke’s word for what is forgiven, in this lesson, is",
          ["Sins", "Debts", "Fields", "Wings"],
          "Sins",
          "The lesson says Matthew says debts and Luke says sins.",
          "l2-forgive",
          "Debts and sins",
        ),
        mc(
          "The bread request, as this lesson describes it, is for",
          ["Ordinary food, repeated", "A storehouse", "A throne", "A return to Moab"],
          "Ordinary food, repeated",
          "The lesson says the request is for ordinary food, repeated, not a storehouse.",
          "l2-ordinary",
          "Ordinary food",
        ),
      ],
    },
  ],
  finalAssessment: [
    mc(
      "Which Gospel’s form of the prayer is longer?",
      ["Matthew", "Luke", "They match line for line", "Neither has a form"],
      "Matthew",
      "Matthew is longer and keeps petitions Luke omits.",
      "l1-compare",
      "Shared and varying lines",
    ),
    mc(
      "Both forms ask for",
      ["Daily bread", "A field to glean", "A vow at the city gate", "A doxology only"],
      "Daily bread",
      "Both ask for daily bread.",
      "l2-bread",
      "Daily bread",
    ),
    mc(
      "Cyprian says the prayer is offered for",
      ["The whole people", "One worshiper only", "The dead", "No one"],
      "The whole people",
      "He calls it public and common, for the whole people.",
      "l1-our",
      "Our, not my",
    ),
  ],
};

const DRAFTS: Record<StarterPathId, StarterDraft> = {
  john: JOHN,
  "lords-prayer": LORDS,
};

export function starterProjectId(id: StarterPathId): string {
  return DRAFTS[id].projectId;
}

async function attachScripture(env: LibraryEnv, slots: ScriptureSlot[]): Promise<ScriptureReading[]> {
  const parsed = slots.map((slot) => ({ slot, ref: findBibleReferences(slot.reference)[0] ?? null }));
  const loaded: (PassageResult | null)[] = parsed.map(() => null);
  if (env.BIBLE) {
    const jobs = parsed.flatMap((item, index) =>
      item.ref
        ? [
            {
              index,
              query: {
                slug: item.ref.book.slug,
                chapter: item.ref.chapter,
                verseStart: item.ref.verseStart,
                verseEnd: item.ref.verseEnd,
              },
            },
          ]
        : [],
    );
    try {
      const rows = await fetchPassagesFromD1(
        env.BIBLE,
        jobs.map((job) => job.query),
      );
      rows.forEach((passage, index) => {
        const slotIndex = jobs[index]?.index;
        if (slotIndex === undefined) return;
        loaded[slotIndex] = passage;
      });
    } catch {
      /* A library miss keeps the bundled public-domain text. */
    }
  }
  return parsed.map((item, index) => {
    const passage = loaded[index];
    if (passage && passage.verses.some((verse) => verse.text.trim())) {
      return {
        reference: passage.reference,
        text: passage.verses.map((verse) => verse.text).join(" "),
        note: item.slot.note,
        textSource: "d1" as const,
      };
    }
    return {
      reference: item.ref?.label ?? item.slot.reference,
      text: item.slot.bundledText,
      note: item.slot.note,
      textSource: "bundled" as const,
    };
  });
}

async function attachLibrary(env: LibraryEnv, slots: LibrarySlot[]): Promise<LibraryCitation[]> {
  const citations: LibraryCitation[] = [];
  for (const slot of slots) {
    let cited: LibraryCitation | null = null;
    if (env.BIBLE) {
      try {
        const result = await resolveLibraryRefs(env, [{ reference: slot.lookup, note: slot.note }]);
        cited = result.citations[0] ?? null;
      } catch {
        cited = null;
      }
    }
    if (cited?.text.trim()) {
      citations.push({ ...cited, note: slot.note, textSource: "d1" });
    } else {
      citations.push({ ...slot.bundled, note: slot.note, textSource: "bundled" });
    }
  }
  return citations;
}

function toLesson(draft: LessonDraft, scripture: ScriptureReading[], library: LibraryCitation[], seed: string): LearnLesson {
  return {
    id: draft.id,
    order: draft.order,
    title: draft.title,
    objectives: draft.objectives,
    prerequisiteLessonIds: draft.prerequisiteLessonIds,
    estimatedMinutes: draft.estimatedMinutes,
    searchHints: [],
    status: "ok",
    teaching: draft.teaching,
    videos: [],
    articles: [],
    books: [],
    scripture,
    library,
    quiz: shuffleQuizChoices(draft.quiz, seed),
    warnings: [],
    ...(draft.kind === "gap"
      ? { kind: "gap" as const, sourceLessonId: draft.sourceLessonId, sourceConceptIds: draft.sourceConceptIds }
      : { kind: "core" as const }),
  };
}

/** Build one complete project. Does not write it. */
export async function materializeStarter(id: StarterPathId, env: LibraryEnv, now: number): Promise<Project> {
  const draft = DRAFTS[id];
  const lessons: LearnLesson[] = [];
  for (const lesson of draft.lessons) {
    const [scripture, library] = await Promise.all([
      attachScripture(env, lesson.scripture),
      attachLibrary(env, lesson.library),
    ]);
    lessons.push(toLesson(lesson, scripture, library, `starter:${draft.id}:${lesson.id}`));
  }
  const plan: LearnPlan = {
    id: draft.planId,
    topic: draft.topic,
    title: draft.title,
    complexity: "simple",
    perspective: "neutral",
    status: "complete",
    prerequisites: draft.prerequisites,
    objectives: draft.objectives,
    lessons,
    courseBooks: [],
    finalAssessment: shuffleQuizChoices(draft.finalAssessment, `starter:${draft.id}:final`),
    warnings: [],
    createdAt: now,
  };
  return {
    id: draft.projectId,
    kind: "learn",
    title: draft.title,
    blocks: [{ id: `${draft.projectId}-block`, type: "paragraph", html: "" }],
    updatedAt: now,
    importComplete: true,
    learnPlan: plan,
  };
}

/**
 * Copy one starter into the user’s workspace Durable Object.
 * A second call for the same starter returns the stored project.
 * Any other real path refuses the write, so an existing workspace is left alone.
 */
export async function seedStarterIntoWorkspace(
  workspace: WorkspaceSeed,
  env: LibraryEnv,
  starterId: string,
  now: number,
): Promise<SeedResult> {
  if (!isStarterPathId(starterId)) {
    return { ok: false, status: 400, error: "Unknown starter path." };
  }
  const projects = (await workspace.listProjects()).filter((project) => !isEmptyLearnPath(project));
  const projectId = starterProjectId(starterId);
  const existing = projects.find((project) => project.id === projectId && project.learnPlan);
  if (existing) return { ok: true, project: existing, created: false };
  if (projects.length > 0) {
    return { ok: false, status: 409, error: "Starter paths are for an empty workspace." };
  }
  const project = await materializeStarter(starterId, env, now);
  const saved = await workspace.upsertProject(project);
  return { ok: true, project: saved, created: true };
}
