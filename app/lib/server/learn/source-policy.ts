/**
 * One rule for every learn prompt. Teach, gap lessons, resource review, quiz rewrites,
 * and the tutor all import this string. Do not paraphrase it in another prompt.
 * The string itself must not contain verse, confession, commentary, or church-father wording.
 */
export const SOURCE_TEXT_RULE =
  "Do not write Bible verse text, confession text, commentary text, or church father quotations. Propose references only. Quote a verse, confession, commentary, or church father only when that exact wording is already in the context from the library. Otherwise name the reference and do not supply wording; verified wording is inserted later from the library.";
