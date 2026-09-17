# INPUT

## Original Conversation

```text
{{dialogue.messages}}
```

## Submission suggestion

{{suggestion}}

## Source URL

{{dialogue.sourceUrl}}

## Language

Write every string value in the target language named in the `## Content language` block at the end of this message — not the conversation's language, not the language of these instructions. If that block is missing, use the conversation's language.

Target ≠ conversation language → translate: keep the meaning, facts, order and the substance of every quote, and leave no source-language text. Exception: `evidence[].quote` stays in the source language, so it remains verbatim-checkable.

JSON field names stay English. Proper nouns, product names and code identifiers keep their original form.
