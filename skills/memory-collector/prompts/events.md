# Events pipeline — once-per-session epic-event scan

Source: `src/prompts/human/event-scan.ts` in
[Flare576/ei](https://github.com/Flare576/ei) — © Jeremy Scherer, MIT.

Run once per session (over the whole session as the window, or its final
window). Flagged events become Event-category topics — write them with the
Event narrative discipline from [`topics.md`](topics.md). **An empty array is
the most common expected response**; one memorable moment per window is the
norm.

## System prompt

````
# Task

You are scanning a conversation window to identify EPIC EVENTS worth preserving as long-term memories.

An EPIC EVENT is a significant, bounded moment — something either participant would reference months later with recognition. Not a topic. Not a theme. A specific thing that happened.

## The Test

Ask yourself: "Would this moment get a section heading in a campaign recap document?"

- "The Night We Debugged Beta's CPU" → YES
- "First session with filesystem access" → YES
- "The time the health check cached the API response forever" → YES
- "We talked about AI" → NO (that's a Topic) return empty
- "Flare asked some questions" → NO (too vague) return empty
- Normal conversation without a notable arc → NO (not epic) return empty

## What Makes an EPIC EVENT

- A conflict encountered and (possibly) resolved
- A discovery or breakthrough moment
- A memorable failure or unexpected outcome
- A significant "first" in the relationship
- A pivotal decision or turning point
- A moment either party would say "oh THAT session" about

## What Is NOT an EPIC EVENT

- Ongoing themes or interests (those are Topics)
- Casual check-ins without a notable arc
- Technical facts without a story around them
- Anything that's already an ongoing trend rather than a bounded moment

## Output Format

```json
{
  "events": [
    {
      "name": "Short evocative label (5-50 characters)",
      "description": "1-2 sentences: what happened, why it mattered. Write it like a friend describing the moment to someone who wasn't there.",
      "reason": "Evidence from the conversation — what made this rise to Epic Event level"
    }
  ]
}
```

Return an empty array if nothing qualifies. An empty array is the most common expected response.

**Return JSON only. Be conservative. One memorable moment per window is the norm.**

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

{{PARTICIPANT_CONTEXT — optional}}
````

## User message

The window, then:

````
Scan this conversation window for EPIC EVENTS — specific, memorable moments worth preserving long-term.

**Return JSON:**
```json
{
  "events": [
    {
      "name": "Short evocative label",
      "description": "What happened and why it mattered",
      "reason": "Evidence from the conversation"
    }
  ]
}
```

Return empty array if nothing qualifies. Be conservative.
````
