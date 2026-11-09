---
name: humanize
description: >
  Rewrite text so it reads like a thoughtful software engineer rather than an AI.
  Eliminates AI writing tells: staged contrasts, one-line closers, forced triads,
  stock filler words, inflated claims, chat wrappers, excessive em-dashes, and bold
  label spam. Use for "humanize this", "edit this comment", "clean up this text",
  or /humanize.
---

# Humanize

Rewrite AI-sounding engineering text so it reads like a thoughtful senior developer
speaking directly to a teammate. Keep every technical detail, file path, line number,
code snippet, and command intact. Do not add or invent facts.

## Why AI text sounds synthetic

A language model by default picks words and structures that suit the widest range of
readers. Human engineers write for a specific teammate and a concrete problem.

When an AI drafts PRs, review comments, or commit messages, it falls into predictable
default habits:
- **Staging**: Signaling importance instead of adding facts ("not X, but Y", "this isn't just about speed, it's about stability").
- **Rhythm by rule**: Forcing triads (rule of three) and dashes everywhere to mimic cadence.
- **Inflation**: Dressing ordinary fixes as "crucial", "pivotal", or "robust".
- **Formatting by rule**: Bolding the first few words of every bullet item regardless of meaning.
- **Chat leftovers**: Conversational pleasantries ("Certainly!", "Hope this helps!", "Here is a breakdown:").
- **Wrong reader**: Re-explaining background context the reader already knows before getting to the decision.

## The AI Tells to Eliminate

### 1. Staged contrasts
**Watch for:** "not only X, but also Y", "it is not merely A, it is B", "rather than just fixing X, this ensures Y".
**Problem:** A rhetorical trick that burns attention without adding information.
**Fix:** State Y directly.
- *Before:* "This change not only fixes the tag filter, but also improves query efficiency."
- *After:* "This fixes the tag filter and indexes the query on `tag_id`."

### 2. One-line closers and summary wrap-ups
**Watch for:** Sentences starting with "Ultimately,", "In summary,", "At the end of the day,", "Overall,", or concluding with broad generalities like "Together, these changes ensure a more reliable platform."
**Problem:** Restating what was just said adds zero technical value.
**Fix:** Delete the sentence entirely.

### 3. Throat-clearing and staged openers
**Watch for:** "In order to ensure that...", "When it comes to handling...", "It is important to note that...", "Please be advised that...".
**Problem:** Delayed start.
**Fix:** Cut straight to the action or fact.
- *Before:* "In order to ensure that evidence files are not modified, we add a read-only flag."
- *After:* "We mount evidence files read-only to preserve evidence integrity."

### 4. Forced triads
**Watch for:** Grouping arguments, nouns, or adjectives into artificial sets of three ("clean, reliable, and scalable", "logs, metrics, and traces", "streamlines, optimizes, and accelerates").
**Problem:** Artificial rhythm chosen for symmetry rather than technical accuracy.
**Fix:** Keep only the items that actually exist or matter.

### 5. Stock AI vocabulary
**Watch for:** "delve", "crucial", "testament", "tapestry", "landscape", "robust", "foster", "pivotal", "seamless", "comprehensive", "leverage", "streamline", "beacon", "vital", "elevate", "holistic".
**Problem:** Overused words that signal synthetic generation.
**Fix:** Replace with plain, precise engineering words ("fast", "checks", "works", "safe", "parses", "stores"), or cut.

### 6. Inflated claims and melodrama
**Watch for:** Calling routine changes "critical enhancements", "vital improvements", "game-changing additions", or "comprehensive overhauls".
**Problem:** Exaggeration damages credibility with experienced reviewers.
**Fix:** State the concrete technical change plainly.

### 7. Excessive em-dashes
**Watch for:** Sentences stitched together with multiple em-dashes (`—`).
**Problem:** Used by models as an easy way out of structuring sentences properly.
**Fix:** Use standard punctuation: periods, commas, or parentheses.

### 8. Formatting by rule (bold label spam)
**Watch for:** Every single bullet item beginning with a bolded category or phrase (`- **Performance:** ...`, `- **Reliability:** ...`, `- **Scalability:** ...`).
**Problem:** Mechanical layout that tires the eye.
**Fix:** Write natural bullet points or short paragraphs. Use bold only when highlighting something genuinely critical (like a `Must fix` heading).

### 9. Chat leftovers and conversational filler
**Watch for:** "Sure thing!", "Here is a summary of the changes:", "I have addressed your feedback:", "Let me know what you think!", "Hope this helps!".
**Problem:** Noise in git history and issue trackers.
**Fix:** Delete completely. Let the technical summary stand on its own.

### 10. Re-explaining what the reader already knows
**Watch for:** A PR comment or review response that rehashes the entire history of the ticket before answering.
**Problem:** Buries the decision under redundant context.
**Fix:** Lead with the decision, answer, or code change. Keep only the reasoning necessary for the decision.

### 11. Writing about the document instead of the subject
**Watch for:** "This PR was created to...", "The table below illustrates...", "This function was added to replace the previous approach...".
**Problem:** Narrates the author's workflow or layout rather than the code.
**Fix:** Describe the code's behavior: "Indexes `tasks.created_at` to avoid full table scans."

---

## How to work

1. **Mark the tells:** Read the drafted text once and identify any of the 11 tells above.
2. **Draft the rewrite:** Preserve every technical fact, path, number, code block, and link.
3. **Read aloud:** Ask: *Would a busy staff engineer write this to a teammate on Slack or a PR?* If it sounds like marketing copy, documentation boilerplate, or an eager assistant, rewrite it.
4. **Final check:** Ensure no facts were dropped and no unsubstantiated claims were added.

---

## Modes

### Standalone Mode
When invoked with `/humanize <text or file>`:
- Read the text or file.
- Rewrite the prose according to the rules above.
- If given a file path, update the file directly with the cleaned prose, leaving code blocks, frontmatter, and paths unchanged.
- Report a brief, direct summary of what was cleaned.

### Embedded Mode
When another skill (`review`, `implement`, `idea`) prepares content to be committed or posted to GitHub:
- **PR description (`pr.md`)**: Run through humanizer before saving. Ensure it is direct and uncluttered.
- **Review comment (`review-comment.md`)**: Ensure findings are crisp, actionable, and free from AI fluff or wrap-up filler.
- **Issue bodies**: Ensure the problem description is factual and direct.
- **Commit messages**: Ensure the symptom, cause, and fix are stated in active, plain English without AI embellishment.
