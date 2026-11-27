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
import type { LibraryEnv } from "./library-search";

const HESED_KEY = "faithful, covenant-based loyalty in action that often goes beyond strict obligation";
const LORDS_KEY =
  "Both address God as Father and ask for daily bread; Matthew is longer, with extra petitions Luke omits.";

const WCF_5_1 =
  "God, the great Creator of all things, doth uphold, direct, dispose, and govern all creatures, actions, and things, from the greatest even to the least, by his most wise and holy providence, according to his infallible foreknowledge, and the free and immutable counsel of his own will, to the praise of the glory of his wisdom, power, justice, goodness, and mercy.";

const WCF_5_7 =
  "As the providence of God doth, in general, reach to all creatures, so, after a most special manner, it taketh care of his Church, and disposeth all things to the good thereof.";

const CHRYSOSTOM =
  "For you do not achieve it by toilings and labors, but you receive it as a gift from above, contributing one thing only from your own store, believing.";

const WLC_186 =
  "The whole Word of God is of use to direct us in the duty of prayer; but the special rule of direction is that form of prayer which our Savior Christ taught his disciples, commonly called the Lord's Prayer.";

const CYPRIAN =
  "Before all things, the Teacher of peace and the Master of unity would not have prayer to be made singly and individually, as for one who prays to pray for himself alone. For we say not “My Father, which art in heaven,” nor “Give me this day my daily bread;” nor does each one ask that only his own debt should be forgiven him; nor does he request for himself alone that he may not be led into temptation, and delivered from evil. Our prayer is public and common; and when we pray, we pray not for one, but for the whole people, because we the whole people are one.";

const KJV = {
  ruth116:
    "And Ruth said, Intreat me not to leave thee, or to return from following after thee: for whither thou goest, I will go; and where thou lodgest, I will lodge: thy people shall be my people, and thy God my God: Where thou diest, will I die, and there will I be buried: the LORD do so to me, and more also, if ought but death part thee and me.",
  ruth212:
    "The LORD recompense thy work, and a full reward be given thee of the LORD God of Israel, under whose wings thou art come to trust.",
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

const RUTH: StarterDraft = {
  id: "ruth",
  projectId: "starter-ruth",
  planId: STARTER_PLAN_IDS.ruth,
  title: "The Book of Ruth",
  topic: "The Book of Ruth",
  prerequisites: ["Willingness to read a short narrative slowly."],
  objectives: [
    "Describe Ruth’s choice to stay with Naomi",
    "Explain hesed as loyal action beyond strict obligation",
    "Connect Boaz’s blessing with being received rather than earning a place",
  ],
  lessons: [
    {
      id: "l1",
      order: 1,
      title: "Ruth’s loyalty",
      objectives: ["Say who stays with Naomi and who turns back", "Define hesed from this chapter"],
      prerequisiteLessonIds: [],
      estimatedMinutes: 18,
      kind: "core",
      teaching: [
        paragraph(
          "In a famine, Naomi’s family leaves Bethlehem for Moab. Her husband and both sons die there. She starts home, and both daughters-in-law set out with her. Orpah turns back. Ruth does not.",
        ),
        heading("Hesed"),
        paragraph(
          "The loyalty in this chapter has a name in Hebrew: hesed. Hesed here is faithful, covenant-based loyalty in action that often goes beyond strict obligation. Ruth was not bound by a law that forced her to leave her own people. She chooses Naomi’s road anyway.",
        ),
        heading("Three pledges"),
        paragraph(
          "Read her reply in the passage below. The lesson does not replace that wording. Notice three pledges: she will go where Naomi goes, she will lodge where Naomi lodges, and she will take Naomi’s people and Naomi’s God as her own. Only death, she says, will part them.",
        ),
        paragraph(
          "The confession beside the passage is about providence, not a commentary written on Ruth. It says God governs creatures and actions, from the greatest to the least. Hold that claim next to a famine, a funeral, and a choice on the road.",
        ),
      ],
      scripture: [
        {
          reference: "Ruth 1:16-17",
          note: "Ruth’s reply to Naomi. The lesson’s three pledges are in this wording.",
          bundledText: KJV.ruth116,
        },
      ],
      library: [
        {
          lookup: "Westminster Confession of Faith 5.1",
          note: "The confession’s chapter on providence. It is not a commentary on Ruth.",
          bundled: confession("bundled-wcf-5-1", "Westminster Confession of Faith 5.1", "Of Providence", WCF_5_1),
        },
      ],
      quiz: [
        mc(
          "Who continues with Naomi toward Bethlehem?",
          ["Ruth", "Orpah", "Elimelech", "Boaz"],
          "Ruth",
          "The lesson says Orpah turns back and Ruth does not.",
          "l1-stay",
          "Who stays",
        ),
        mc(
          "What does Orpah do?",
          ["Turns back", "Stays with Naomi", "Marries Boaz", "Rules Bethlehem"],
          "Turns back",
          "The lesson says Orpah turns back.",
          "l1-orpah",
          "Orpah turns back",
        ),
        short(
          "What is hesed in this lesson?",
          HESED_KEY,
          "The lesson defines hesed as faithful, covenant-based loyalty in action that often goes beyond strict obligation.",
          "l1-hesed",
          "Hesed",
        ),
      ],
    },
    {
      id: "gap-l1-1",
      order: 2,
      title: "Practice: Ruth’s vow",
      objectives: ["Restate hesed without copying the lesson’s sentence", "Name one pledge in Ruth’s reply"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 10,
      kind: "gap",
      sourceLessonId: "l1",
      sourceConceptIds: ["l1-hesed"],
      teaching: [
        paragraph("This practice lesson stays with one claim from Ruth’s reply."),
        paragraph(
          "Hesed, in the lesson you just read, is faithful, covenant-based loyalty in action that often goes beyond strict obligation. Ruth’s reply is that kind of act. She pledges to go where Naomi goes and to take Naomi’s people and God as her own. Nothing in the chapter says a statute compelled her.",
        ),
        paragraph("The passage below is the same reply. Use it to check the claim, not as a new story."),
      ],
      scripture: [
        {
          reference: "Ruth 1:16-17",
          note: "The same reply, retrieved again for the practice lesson.",
          bundledText: KJV.ruth116,
        },
      ],
      library: [
        {
          lookup: "Westminster Confession of Faith 5.1",
          note: "The same providence sentence, set beside the vow rather than beside the famine.",
          bundled: confession("bundled-wcf-5-1", "Westminster Confession of Faith 5.1", "Of Providence", WCF_5_1),
        },
      ],
      quiz: [
        mc(
          "Hesed in this path is best described as",
          [
            "Loyal action beyond strict obligation",
            "A wage Ruth earned",
            "Orpah’s return to Moab",
            "A law that forced Ruth to leave home",
          ],
          "Loyal action beyond strict obligation",
          "The practice lesson repeats the definition of hesed.",
          "l1-hesed",
          "Hesed",
        ),
        mc(
          "Ruth’s pledge includes which commitment?",
          [
            "Naomi’s people and God become hers",
            "She will rule Bethlehem",
            "She will return to Moab",
            "She will ignore Naomi’s God",
          ],
          "Naomi’s people and God become hers",
          "The practice lesson names that pledge.",
          "l1-vow",
          "Ruth’s pledge",
        ),
      ],
    },
    {
      id: "l2",
      order: 3,
      title: "Under his wings",
      objectives: ["Say whose field Ruth gleans in", "Describe the picture in Boaz’s blessing"],
      prerequisiteLessonIds: ["l1"],
      estimatedMinutes: 16,
      kind: "core",
      teaching: [
        paragraph(
          "Ruth gleans in the fields of Boaz, a relative of Naomi’s late husband. Boaz has heard what she did for Naomi: she left her father, her mother, and her native land for a people she did not know.",
        ),
        heading("Received, not purchased"),
        paragraph(
          "He does not treat that loyalty as a debt she is collecting. He speaks of refuge. The reading below is his blessing. It asks the God of Israel to repay her, and it says she has come to trust under that God’s wings.",
        ),
        paragraph(
          "A second confession line, on the special care of providence for the church, sits beside the blessing. It is not a verse-by-verse note on Ruth. Read it as the church’s later claim that God’s care is not only general.",
        ),
        paragraph(
          "The church father quoted here is John Chrysostom on Romans, not a sermon on Ruth. He says a person receives a gift from above rather than achieving it by labor, and contributes believing. The lesson sets that sentence next to Boaz’s welcome: Ruth is received. She does not buy her place.",
        ),
      ],
      scripture: [
        {
          reference: "Ruth 2:12",
          note: "Boaz’s blessing. The wings belong to the God of Israel.",
          bundledText: KJV.ruth212,
        },
      ],
      library: [
        {
          lookup: "Westminster Confession of Faith 5.7",
          note: "Providence’s special care for the church. Not a commentary on Ruth 2.",
          bundled: confession("bundled-wcf-5-7", "Westminster Confession of Faith 5.7", "Of Providence", WCF_5_7),
        },
        {
          lookup: "John Chrysostom, Homilies on Romans",
          note: "Chrysostom on Romans: a gift received, with believing contributed. He is not commenting on Ruth.",
          bundled: father(
            "bundled-chrysostom-romans",
            "John Chrysostom",
            "Homilies on Romans",
            CHRYSOSTOM,
            "https://ccel.org/ccel/schaff/npnf111",
          ),
        },
      ],
      quiz: [
        mc(
          "Whose field does Ruth glean in?",
          ["Boaz", "Orpah", "Elimelech", "A stranger with no tie to the family"],
          "Boaz",
          "The lesson says Ruth gleans in the fields of Boaz.",
          "l2-boaz",
          "Boaz’s field",
        ),
        mc(
          "Boaz’s blessing pictures Ruth’s trust as being under what?",
          ["The wings of the God of Israel", "The walls of Moab", "A wage she earned", "Orpah’s house"],
          "The wings of the God of Israel",
          "The lesson says she has come to trust under that God’s wings.",
          "l2-wings",
          "Under his wings",
        ),
        mc(
          "Chrysostom’s sentence, as this lesson uses it, says a person",
          [
            "Receives a gift and contributes believing",
            "Earns a place by labor alone",
            "Must return to Moab",
            "Writes the confession",
          ],
          "Receives a gift and contributes believing",
          "The lesson quotes him on receiving a gift rather than achieving it by labor.",
          "l2-gift",
          "Received as a gift",
        ),
      ],
    },
  ],
  finalAssessment: [
    mc(
      "Who stays with Naomi?",
      ["Ruth", "Orpah", "Elimelech", "Neither daughter-in-law"],
      "Ruth",
      "Ruth stays. Orpah turns back.",
      "l1-stay",
      "Who stays",
    ),
    mc(
      "Hesed in this path goes beyond what?",
      ["Strict obligation", "Boaz’s field", "The wings in the blessing", "The confession’s title"],
      "Strict obligation",
      "Hesed is loyal action that often goes beyond strict obligation.",
      "l1-hesed",
      "Hesed",
    ),
    mc(
      "Boaz pictures Ruth’s trust as under",
      ["The wings of the God of Israel", "The laws of Moab", "A contract she purchased", "Orpah’s choice"],
      "The wings of the God of Israel",
      "The blessing uses that picture.",
      "l2-wings",
      "Under his wings",
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
  ruth: RUTH,
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

function toLesson(draft: LessonDraft, scripture: ScriptureReading[], library: LibraryCitation[]): LearnLesson {
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
    quiz: draft.quiz,
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
    lessons.push(toLesson(lesson, scripture, library));
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
    finalAssessment: draft.finalAssessment,
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
