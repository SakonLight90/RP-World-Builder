/**
 * Markers: where they come from, and the one thing that belongs here.
 *
 * The markers themselves live in `@rpwb/shared`, because the interface sends the
 * Continue and Retry requests and the server is the one that has to recognise
 * them. Re-exported here so the server keeps a single import site and the test
 * suite keeps testing what the rest of the server actually uses.
 */
export {
  CANONE_HEADING,
  CONTINUE_REQUEST,
  isContext,
  isSilent,
  mark,
  RETRY_REQUEST,
  SILENT_PREFIX,
} from "@rpwb/shared";

/**
 * A narrator's answer cleaned of markers.
 *
 * The model was told not to use asterisks, but an instruction in the prompt is a
 * request, not a constraint: if it slips, the asterisk stays. It is removed
 * here, and removed because asterisks are a formatting signal: a reader does not
 * need to know the narrator had put asterisks around a sentence.
 */
export function cleanNarration(text: string): string {
  return (
    text
      // Do not touch double asterisks that are never used for actions: removing
      // all of them would leave things like `x ** 2` intact.
      .replace(/\*\*([^*\n]{1,200}?)\*\*/g, "$1")
      .replace(/^\s*\*([^*\n]{1,200}?)\*\s*$/gm, "$1")
      // A leftover single asterisk: it opens an action the model did not close,
      // or it closes one it never opened. Either way it is noise.
      // Single only and only at the line edge: doubles that wrap nothing
      // (`2 ** 3`) are not markup and are left alone.
      .replace(/^\s*\*(?=\S)/gm, "")
      .replace(/(?<=\S)\s*\*(?=\s*$)/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
