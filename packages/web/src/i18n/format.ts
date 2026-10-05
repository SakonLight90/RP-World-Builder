import type { MessageValues } from "./types";

/**
 * Substitutes `{{name}}` with the given values.
 *
 * Double braces rather than `{name}`, because the single-brace form collides
 * with CSS in class names and with the braces a translator may legitimately
 * write in a string. The pattern is global and a missing value is left as it is:
 * a translator who forgot a placeholder should see `{{who}}` on screen, not an
 * empty hole that hides the mistake.
 */
export function interpolate(template: string, values?: MessageValues): string {
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}
