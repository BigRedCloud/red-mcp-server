const BEHAVIOURAL_INSTRUCTION_PATTERN =
  /\b(?:you must|ask the user|wait for confirmation|prefer|ignore|only call|call this tool|call\s+brc_[a-z0-9_]+|also use it|recommended entry point|when the user|user(?:'s|’s) message|show a plain(?:-english)? preview|retry with|retain the returned|tell the user|the assistant must|user should|should be shown|follow (?:the )?instructions?|mandatory(?: first tool| for)?|treat it as|provide customer-help|pass the user's|follow normal model-driven routing|return a concise synthesized answer|use only publicurl|place each relevant screenshot|manual guidance must|support must be last)\b/i;

const IMPERATIVE_SENTENCE_PATTERN =
  /^(?:always|never|do not|use|call|ask|show|tell|find|return|provide|pass|place|include|omit|keep|retain|retry|follow|ignore|prefer|choose|select|ensure|under\s+sources)\b/i;

const DIRECTIVE_CLAUSE_PATTERN = /(?:—|;)\s*(?:always|never|do not)\b/i;

const CROSS_TOOL_INSTRUCTION_PATTERN = /\bbrc_[a-z0-9_]+\b/i;

function descriptionSentences(description: string): string[] {
  return description
    .trim()
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * Validates public top-level tool metadata without modifying it. Registration
 * fails closed so prohibited wording cannot be hidden by a sanitizer.
 */
export function toAnthropicCompliantToolDescription(
  toolName: string,
  description: string,
): string {
  if (!description.trim()) {
    throw new Error(`Tool ${toolName} has an empty public description.`);
  }

  const otherToolPattern = new RegExp(
    `\\bbrc_(?!${toolName.replace(/^brc_/, "")}\\b)[a-z0-9_]+\\b`,
    "i",
  );
  for (const sentence of descriptionSentences(description)) {
    if (
      BEHAVIOURAL_INSTRUCTION_PATTERN.test(sentence) ||
      IMPERATIVE_SENTENCE_PATTERN.test(sentence) ||
      DIRECTIVE_CLAUSE_PATTERN.test(sentence) ||
      otherToolPattern.test(sentence)
    ) {
      throw new Error(
        `Tool ${toolName} has a prohibited public-description sentence: ${sentence}`,
      );
    }
  }

  return description;
}

export const TOOL_DESCRIPTION_POLICY_PATTERNS = {
  behaviouralInstruction: BEHAVIOURAL_INSTRUCTION_PATTERN,
  imperativeSentence: IMPERATIVE_SENTENCE_PATTERN,
  directiveClause: DIRECTIVE_CLAUSE_PATTERN,
  crossToolInstruction: CROSS_TOOL_INSTRUCTION_PATTERN,
} as const;
