import { describe, expect, it } from "vitest";
import {
  CANONE_HEADING,
  CONTINUE_REQUEST,
  cleanNarration,
  isContext,
  isSilent,
  mark,
  RETRY_REQUEST,
  SILENT_PREFIX,
} from "../src/opencode/markers.js";

/**
 * Here something the user sees immediately is checked: what's not the player's
 * must not appear in chat, and the narrator must not write asterisks. The two
 * defects that really showed up.
 */

describe("messages that aren't the player's", () => {
  it("injected context is recognized as such", () => {
    expect(isContext(`${CANONE_HEADING}\nLe voci sono autoritative`)).toBe(true);
    expect(isContext("Vera dice: non aspettavo nessuno")).toBe(false);
  });

  it("a narrator request carries the mark and is recognized", () => {
    const text = mark(CONTINUE_REQUEST, true);

    expect(text.startsWith(SILENT_PREFIX)).toBe(true);
    expect(isSilent(text)).toBe(true);
  });

  it("a real player line carries no mark", () => {
    const text = mark("Apro la porta e guardo fuori.", false);

    expect(isSilent(text)).toBe(false);
    expect(isContext(text)).toBe(false);
  });

  it("the mark stands in front, not inside: otherwise it's not found", () => {
    expect(mark("test", true).indexOf(SILENT_PREFIX)).toBe(0);
  });

  it("continue and retry are different requests", () => {
    // If both words were the same, the Retry button would continue the scene,
    // the opposite of what it says.
    expect(CONTINUE_REQUEST).not.toBe(RETRY_REQUEST);
  });
});

describe("cleaned narration", () => {
  it("strips single asterisks around an action", () => {
    expect(cleanNarration("*Michael apre la porta.*")).toBe("Michael apre la porta.");
  });

  it("strips double asterisks", () => {
    expect(cleanNarration("**La porta si apre.**")).toBe("La porta si apre.");
  });

  it("strips a stray asterisk at a paragraph start", () => {
    expect(cleanNarration("*Le aule sono state pulite.")).toBe("Le aule sono state pulite.");
  });

  it("strips a closing asterisk left at line end", () => {
    expect(cleanNarration("Le aule sono state pulite*\nLa luce entra.")).toBe(
      "Le aule sono state pulite\nLa luce entra.",
    );
  });

  it("doesn't touch quotes: they're lines, and they stay", () => {
    const text = 'Vera dice: "Non ti aspettavo qui."';
    expect(cleanNarration(text)).toBe(text);
  });

  it("doesn't ruin empty paragraphs in the middle", () => {
    expect(cleanNarration("Uno.\n\n\n\nDue.")).toBe("Uno.\n\nDue.");
  });

  it("text without marks stays identical", () => {
    const text = "La torretta Est è chiusa. Dalla finestra si vede solo il buio.";
    expect(cleanNarration(text)).toBe(text);
  });

  it("doesn't eat a multiplication", () => {
    // Won't happen in a story, but the cleaner must not be blind: if it
    // deleted double asterisks everywhere, `2 ** 3` text would lose meaning
    // with nobody noticing.
    expect(cleanNarration("calcola 2 ** 3 per favore")).toContain("2 ** 3");
  });
});
