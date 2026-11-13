/**
 * `text` cut after every path or name separator (`/ \ . _ -`), so a renderer
 * can put a `<wbr>` between the parts: a long path or file name then wraps at
 * its separators instead of mid-word, or not at all. Joining the parts gives
 * `text` back.
 */
export function breakOpportunities(text: string): string[] {
  return text.split(/(?<=[/\\._-])(?=.)/)
}
