import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const kbPath = path.resolve(
  process.cwd(),
  "data",
  "dimensional_analysis.json"
);

const knowledgeBase = JSON.parse(
  fs.readFileSync(kbPath, "utf8")
);

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;


// ============================================================
// KNOWLEDGE BASE
// ============================================================

function flattenKnowledge(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => flattenKnowledge(v, out));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) =>
      flattenKnowledge(v, out)
    );
  }

  return out;
}

const chunks = flattenKnowledge(knowledgeBase.knowledge);
const exerciseChunks = flattenKnowledge(
  knowledgeBase.exercise_bank
);

const allChunks = [...chunks, ...exerciseChunks];


// ============================================================
// SCOPE
// ============================================================

const SCOPE_KEYWORDS = [
  "dimension",
  "dimensional",
  "dimensional analysis",

  "si unit",
  "si units",
  "unit",
  "units",

  "significant figure",
  "significant figures",
  "measurement",
  "measurements",

  "uncertainty",
  "error",
  "errors",
  "accuracy",
  "precision",

  "velocity",
  "displacement",
  "acceleration",

  "force",
  "work",
  "energy",
  "power",
  "pressure",

  "mass",
  "length",
  "time",
  "current",
  "temperature",

  "luminous",
  "mole",
  "amount of substance",

  "vector",
  "vectors",
  "scalar",
  "dot product",
  "cross product",

  "moment",
  "torque",

  "coordinate",
  "coordinates",

  "derivative",
  "derivatives",

  "slope",
  "graph",
  "graphs",

  "pendulum",

  "gravitational constant",
  "gravity"
];


// ============================================================
// FOLLOW-UP / LEARNING LANGUAGE
// ============================================================

const FOLLOW_UP_PATTERNS = [
  "i don't know",
  "i dont know",
  "don't know",
  "dont know",

  "i don't understand",
  "i dont understand",
  "don't understand",
  "dont understand",

  "i'm confused",
  "im confused",
  "confused",

  "i'm stuck",
  "im stuck",
  "stuck",

  "too hard",
  "this is hard",
  "hard to understand",

  "make it simpler",
  "simpler one",
  "simpler",
  "make it easy",
  "easier",

  "explain again",
  "explain differently",
  "explain it differently",

  "another example",
  "give me an example",
  "give me another example",

  "another one",
  "give me another",

  "what do you mean",
  "what does that mean",

  "why",
  "how",

  "help me",
  "can you help",

  "what next",
  "what should i do",

  "i got it",
  "i understand",

  "is this correct",
  "am i correct",

  "my answer is",
  "i think the answer",

  "can you repeat",
  "repeat that",

  "one more time"
];


// ============================================================
// DETECT INTENT
// ============================================================

function containsAny(text, patterns) {
  const q = text.toLowerCase();

  return patterns.some((pattern) =>
    q.includes(pattern)
  );
}


function isExplicitlyInScope(message) {
  const q = message.toLowerCase();

  return SCOPE_KEYWORDS.some((term) =>
    q.includes(term)
  );
}


function isLearningFollowUp(message) {
  return containsAny(
    message,
    FOLLOW_UP_PATTERNS
  );
}


// ============================================================
// CONVERSATION AWARE SCOPE CHECK
// ============================================================

function hasTutoringContext(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return false;
  }

  return history.some((message) => {
    if (!message || !message.content) {
      return false;
    }

    return (
      message.role === "user" &&
      isExplicitlyInScope(message.content)
    );
  });
}


function isLikelyInScope(message, history = []) {

  // 1. Direct Physics question
  if (isExplicitlyInScope(message)) {
    return true;
  }

  // 2. Follow-up to an existing Physics conversation
  if (
    isLearningFollowUp(message) &&
    hasTutoringContext(history)
  ) {
    return true;
  }

  return false;
}


// ============================================================
// FRIENDLY OUT-OF-SCOPE RESPONSE
// ============================================================

const SCOPE_REDIRECT =
  "Haha, I think we've gone a little outside our concentration area 😅. " +
  "I'm currently focused on RCA Year 1 Applied Physics, especially " +
  "Basic Measurements and Dimensional Analysis. " +
  "Bring me a Physics question and let's work through it together! 🧠⚡";


// ============================================================
// RETRIEVAL
// ============================================================

function retrieveRelevantChunks(query, limit = 6) {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const scored = allChunks.map((chunk) => {
    const text = chunk.toLowerCase();

    let score = 0;

    for (const term of terms) {
      if (text.includes(term)) {
        score++;
      }
    }

    return {
      chunk,
      score
    };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.chunk);
}


// ============================================================
// SCENARIO INSTRUCTION
// ============================================================

function scenarioInstruction(message) {
  const q = message.toLowerCase();

  const wantsScenario =
    q.includes("example") ||
    q.includes("understand") ||
    q.includes("explain") ||
    q.includes("why") ||
    q.includes("how") ||
    q.includes("hard") ||
    q.includes("simpler") ||
    q.includes("don't get") ||
    q.includes("dont get");

  if (!wantsScenario) {
    return "";
  }

  return `
REAL-LIFE LEARNING INSTRUCTION:

When useful, connect the Physics concept to a short practical
scenario.

Prefer contexts such as:
- robotics
- electronics
- embedded systems
- school experiments
- transport
- engineering
- electricity
- everyday measurements

Use this structure when appropriate:

Scenario → Physics problem → Guiding question → Student attempt
→ Hint → Explanation → Reflection

Do not force a scenario when it would make the answer less clear.
`;
}


// ============================================================
// SYSTEM PROMPT
// ============================================================

const SYSTEM_PROMPT = `
You are DoStudy Buddy.

You are a friendly AI study partner, tutor, and study advisor
for Rwanda Coding Academy Year 1 students.

Your current specialization is:

RCA Year 1 Applied Physics
especially:
- Basic Measurements
- Dimensional Analysis
- SI units
- Significant figures
- Errors and uncertainty
- Vectors
- Coordinates
- Derived physical quantities
- Related introductory Physics concepts contained in the
  provided curriculum knowledge.

PERSONALITY:

Be:
- friendly
- patient
- encouraging
- natural
- intelligent
- school-appropriate
- slightly Gen-Z/developer-friendly

You can occasionally use emojis, but do not overdo them.

You should feel like:
"the smart friend who actually knows Physics and wants me
to understand it."

Do NOT sound:
- robotic
- cold
- like an error message
- like a textbook
- like an overly excited influencer.

------------------------------------------------------------

IMPORTANT: FOLLOW-UP MESSAGES

Students often send short messages that do not mention Physics.

Examples:

"I don't know."
"I'm confused."
"Make it simpler."
"Give me another example."
"That's too hard."
"What next?"
"Can you explain that again?"

If these occur during an existing Physics conversation,
DO NOT treat them as out-of-scope.

Continue tutoring from the previous context.

------------------------------------------------------------

GUIDED LEARNING

You are NOT an answer generator.

Your goal is to help the student understand and solve problems.

Prefer:
- guiding questions
- hints
- small steps
- explanations
- examples
- checking understanding

Avoid immediately giving the complete answer when the student
can reasonably work toward it.

------------------------------------------------------------

HINT LADDER

Use progressive assistance:

Level 1:
Ask a guiding question.

Level 2:
Remind the student of the relevant concept.

Level 3:
Give the relevant formula or relationship.

Level 4:
Show part of the reasoning.

Level 5:
Give the full explanation when appropriate.

If the student says "I don't know", normally give the next
useful hint rather than immediately revealing everything.

------------------------------------------------------------

WRONG ANSWERS

Never shame the student.

Use supportive language such as:

"Almost there! 👀 You've got the right idea, but let's check
one part."

Then identify the issue and guide them toward correcting it.

------------------------------------------------------------

REAL-LIFE EXAMPLES

When useful, connect Physics to real situations.

Prefer:
- robotics
- electronics
- embedded systems
- engineering
- experiments
- transport
- everyday technology

Make the scenario short and understandable.

------------------------------------------------------------

DIMENSIONAL ANALYSIS

For dimensional-analysis questions, guide the student through:

1. Identify the physical quantities.
2. Write their dimensions.
3. Substitute the dimensions into the equation.
4. Compare both sides.
5. Decide whether the equation is dimensionally consistent.

Remember:

An equation being dimensionally correct does not necessarily
prove that it is physically correct.

Use the terminology and examples from the provided curriculum
context.

------------------------------------------------------------

CURRICULUM BOUNDARIES

Stay grounded in the supplied curriculum knowledge.

If a student asks something clearly outside your current
Physics scope, politely redirect them.

Do not pretend to know curriculum material that is not available.

------------------------------------------------------------

IMPORTANT

A student's short follow-up should be interpreted using the
conversation history.

For example:

Student:
"Explain dimensional analysis."

Tutor:
[explanation]

Student:
"I don't understand."

Correct behavior:
Continue explaining dimensional analysis.

Incorrect behavior:
Give the out-of-scope message.

------------------------------------------------------------
`;


// ============================================================
// LOCAL FALLBACK
// ============================================================

function localFallback(message, history = []) {

  if (!isLikelyInScope(message, history)) {
    return SCOPE_REDIRECT;
  }

  const q = message.toLowerCase();

  if (
    q.includes("i don't know") ||
    q.includes("i dont know") ||
    q.includes("i'm stuck") ||
    q.includes("im stuck")
  ) {
    return (
      "No worries 😄 Let's take it one step at a time.\n\n" +
      "Start by asking yourself: **what are the dimensions of " +
      "each quantity in the equation?**\n\n" +
      "Write those down first, and send me what you get. " +
      "I'll help you with the next step."
    );
  }

  if (
    q.includes("simpler") ||
    q.includes("too hard") ||
    q.includes("hard to understand")
  ) {
    return (
      "Absolutely 😄 Let's make it easier.\n\n" +
      "Imagine you're building a small robot and you want to " +
      "check whether a Physics equation makes sense before " +
      "putting it into your program.\n\n" +
      "Dimensional analysis is basically a way of checking " +
      "whether the two sides of an equation speak the same " +
      "measurement language.\n\n" +
      "For example, if one side represents a distance, the " +
      "other side should also have the dimensions of distance.\n\n" +
      "Want to try a super-simple example together? 🤖"
    );
  }

  return (
    "Let's work through this together 🧠⚡\n\n" +
    "Tell me which part you're unsure about, and I'll guide " +
    "you step by step rather than just giving you the answer."
  );
}


// ============================================================
// MAIN TUTOR FUNCTION
// ============================================================

export async function askTutor({
  message,
  history = [],
  mode = "tutor"
}) {

  // ----------------------------------------------------------
  // SCOPE CHECK
  // ----------------------------------------------------------

  if (!isLikelyInScope(message, history)) {
    return {
      mode: "scope-redirect",
      reply: SCOPE_REDIRECT,
      retrieved: []
    };
  }


  // ----------------------------------------------------------
  // RETRIEVAL
  // ----------------------------------------------------------

  const retrieved = retrieveRelevantChunks(
    message,
    6
  );

  const context = retrieved.join("\n\n---\n\n");


  // ----------------------------------------------------------
  // NO API KEY → LOCAL FALLBACK
  // ----------------------------------------------------------

  if (!client) {
    return {
      mode: "local-fallback",
      reply: localFallback(message, history),
      retrieved
    };
  }


  // ----------------------------------------------------------
  // OPENAI
  // ----------------------------------------------------------

  try {

    const response = await client.responses.create({

      model:
        process.env.OPENAI_MODEL ||
        "gpt-5.6-luna",

      instructions:
        SYSTEM_PROMPT +
        "\n\n" +
        scenarioInstruction(message),

      input: [

        {
          role: "developer",
          content:
            "CURRICULUM CONTEXT:\n\n" +
            (
              context ||
              "No directly matching material was retrieved."
            )
        },

        ...history.map((m) => ({
          role:
            m.role === "assistant"
              ? "assistant"
              : "user",
          content: m.content
        })),

        {
          role: "user",
          content:
            `Mode: ${mode}\nStudent message: ${message}`
        }

      ]

    });


    return {
      mode: "ai",
      reply: response.output_text,
      retrieved
    };


  } catch (error) {

    console.error(
      "DoStudy Buddy AI error:",
      error
    );

    return {
      mode: "fallback-after-error",
      reply: localFallback(message, history),
      retrieved
    };
  }
}