import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

// ============================================================
// CONFIG
// ============================================================

const kbPath = path.resolve(
  process.cwd(),
  "data",
  "dimensional_analysis.json"
);

const knowledgeBase = JSON.parse(
  fs.readFileSync(kbPath, "utf8")
);

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

const MODEL =
  process.env.OPENAI_MODEL ||
  "gpt-5.6-luna";


// ============================================================
// KNOWLEDGE BASE
// ============================================================

function flattenKnowledge(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => {
      flattenKnowledge(item, output);
    });
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => {
      flattenKnowledge(item, output);
    });
  }

  return output;
}

const knowledgeChunks =
  flattenKnowledge(knowledgeBase.knowledge);

const exerciseChunks =
  flattenKnowledge(knowledgeBase.exercise_bank);

const allChunks = [
  ...knowledgeChunks,
  ...exerciseChunks
];


// ============================================================
// CONVERSATION
// ============================================================

function cleanHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(
      (message) =>
        message &&
        typeof message.content === "string"
    )
    .slice(-12);
}


function formatHistory(history) {
  const clean = cleanHistory(history);

  if (clean.length === 0) {
    return "No previous conversation.";
  }

  return clean
    .map((message) => {
      const role =
        message.role === "assistant"
          ? "DoStudy Buddy"
          : "Student";

      return `${role}: ${message.content}`;
    })
    .join("\n");
}


// ============================================================
// LOCAL CURRICULUM RETRIEVAL
// ============================================================

function retrieveRelevantChunks(
  query,
  limit = 6
) {
  if (!query) {
    return [];
  }

  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (term) => term.length > 1
    );

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
    .filter(
      (item) => item.score > 0
    )
    .sort(
      (a, b) => b.score - a.score
    )
    .slice(0, limit)
    .map(
      (item) => item.chunk
    );
}


// ============================================================
// VALID INTENTS
// ============================================================

const VALID_INTENTS = new Set([
  "GREETING",
  "EXPLAIN",
  "SIMPLIFY",
  "EXAMPLE",
  "PRACTICE",
  "HINT",
  "CHECK_ANSWER",
  "CHALLENGE",
  "EASIER",
  "CONFUSION",
  "CONTINUE",
  "ENCOURAGEMENT",
  "CASUAL_CONVERSATION",
  "OUT_OF_SCOPE"
]);


// ============================================================
// VALID LEARNING ACTIONS
// ============================================================

const VALID_ACTIONS = new Set([
  "CONVERSATION",
  "EXPLAIN",
  "SIMPLIFY",
  "GENERATE_EXERCISE",
  "GIVE_HINT",
  "CHECK_WORK",
  "GIVE_EXAMPLE",
  "INCREASE_DIFFICULTY",
  "DECREASE_DIFFICULTY",
  "CONTINUE",
  "REDIRECT"
]);


// ============================================================
// NORMALIZE AI RESULT
// ============================================================

function normalizeTutorResult(parsed) {
  const intent =
    VALID_INTENTS.has(parsed?.intent)
      ? parsed.intent
      : "CONTINUE";

  const learningAction =
    VALID_ACTIONS.has(parsed?.learning_action)
      ? parsed.learning_action
      : "CONTINUE";

  const confidence =
    Number(parsed?.confidence);

  return {
    intent,
    topic:
      typeof parsed?.topic === "string"
        ? parsed.topic
        : "",
    learning_action: learningAction,
    difficulty:
      typeof parsed?.difficulty === "string"
        ? parsed.difficulty
        : "unknown",
    confidence:
      Number.isFinite(confidence)
        ? Math.max(
            0,
            Math.min(1, confidence)
          )
        : 0,
    reply:
      typeof parsed?.reply === "string"
        ? parsed.reply.trim()
        : ""
  };
}


// ============================================================
// LOCAL FALLBACK
// ============================================================

function localFallback(
  message,
  history = [],
  intent = "CONTINUE"
) {

  switch (intent) {

    case "GREETING":
      return "Yo! 😎 What's up? Ready to tackle some Physics?";

    case "PRACTICE":
      return (
        "Bet 😎 Here's one to try:\n\n" +
        "**Check whether this equation is dimensionally consistent:**\n\n" +
        "`s = vt`\n\n" +
        "Start by writing the dimensions of `v` and `t`. " +
        "Send me your reasoning — don't worry about the final answer yet."
      );

    case "HINT":
      return (
        "Here's a small clue 👀:\n\n" +
        "Start by writing the dimensions of each quantity. " +
        "Then compare the dimensions on both sides."
      );

    case "SIMPLIFY":
    case "CONFUSION":
      return (
        "No worries 😄 Let's make it simpler.\n\n" +
        "Think of dimensional analysis as a Physics consistency check. " +
        "The two sides of an equation need to represent the same type " +
        "of physical quantity.\n\n" +
        "Let's take it one small step at a time."
      );

    case "CHECK_ANSWER":
      return (
        "Let's check it together 👀. " +
        "Show me the steps you used to get that answer, " +
        "and we'll see where everything lines up."
      );

    case "CHALLENGE":
      return (
        "Alright, level up 🔥. " +
        "I'll give you a tougher problem. " +
        "Try it first without looking for the solution."
      );

    case "EASIER":
      return (
        "Absolutely 😄 Let's drop the difficulty a bit. " +
        "We'll start with a simpler problem and build up."
      );

    case "EXAMPLE":
      return (
        "Sure! Imagine you're checking a Physics equation " +
        "before using it in a small robot program 🤖. " +
        "Dimensional analysis helps you catch equations " +
        "whose two sides don't represent the same physical quantity."
      );

    case "ENCOURAGEMENT":
      return (
        "Nice 😎 You're getting it. Let's keep going."
      );

    case "CASUAL_CONVERSATION":
      return "Nice 😄 What's next?";

    default:
      return (
        "Let's work through it together 🧠⚡. " +
        "Tell me what part you're unsure about."
      );
  }
}


// ============================================================
// TUTOR SYSTEM
// ============================================================

const TUTOR_SYSTEM_PROMPT = `
You are DoStudy Buddy.

You are an AI learning companion for Rwanda Coding Academy
students.

CURRENT LEARNING DOMAIN:

RCA Year 1 Applied Physics, especially the supplied material
for Basic Measurements and Dimensional Analysis.

Your job is NOT merely to answer questions.

Your job is to help the student understand.

------------------------------------------------------------
IMPORTANT: ONE RESPONSE DOES EVERYTHING
------------------------------------------------------------

You must understand the student's current message AND
produce the appropriate tutoring response in the SAME request.

Do not describe your internal reasoning.

Do not mention this classification system to the student.

------------------------------------------------------------
CURRENT MESSAGE HAS PRIORITY
------------------------------------------------------------

Conversation history gives context.

However, the CURRENT student message determines what they
want NOW.

Students naturally switch activities:

EXPLAIN → SIMPLIFY → PRACTICE → CHECK_ANSWER → HINT → PRACTICE

This is completely normal.

Never force the student to continue the previous activity.

------------------------------------------------------------
UNDERSTAND NATURAL LANGUAGE
------------------------------------------------------------

Students may use:

- normal English
- informal English
- slang
- contractions
- abbreviations
- developer language
- emojis
- typos
- incomplete sentences
- short messages
- casual expressions

Understand meaning rather than matching keywords.

Examples:

"yo"
"hey"
"sup"
→ GREETING

"bro I'm lost"
"nah I don't get this"
"my brain isn't braining"
→ CONFUSION or SIMPLIFY

"walk me through it"
"how does this work?"
→ EXPLAIN

"break it down"
"make it easier"
→ SIMPLIFY

"where would I use this?"
"give me a practical example"
→ EXAMPLE

"hit me with a problem"
"test me"
"lemme try one"
→ PRACTICE

"give me another"
→ PRACTICE

"make it harder"
"level me up"
→ CHALLENGE

"make it easier"
→ EASIER

"give me a clue"
"small hint?"
→ HINT

"my answer is 5 N"
"did I get this right?"
→ CHECK_ANSWER

"what's next?"
"continue"
→ CONTINUE

"thanks"
"nice"
"cool"
→ CASUAL_CONVERSATION or ENCOURAGEMENT

------------------------------------------------------------
CONTEXT
------------------------------------------------------------

Short messages can depend on previous conversation.

Example:

Student:
Explain dimensional analysis.

Buddy:
[explanation]

Student:
"bro I'm cooked 💀"

This is probably CONFUSION.

Example:

Student:
Explain dimensional analysis.

Student:
"throw another one at me"

This is PRACTICE.

Example:

Buddy:
[practice problem]

Student:
"I think I got 5 N"

This is CHECK_ANSWER.

------------------------------------------------------------
OUT OF SCOPE
------------------------------------------------------------

Only use OUT_OF_SCOPE when the request is genuinely unrelated
to the current learning domain.

Do NOT classify something as outside the domain simply because:

- it is short
- it contains slang
- it contains typos
- it is informal
- it lacks Physics terminology
- the student is confused
- the student asks for another problem
- the student asks for a hint
- the student changes activities
- the student says they don't know

If the request is genuinely unrelated, redirect naturally.

Do not sound like an error message.

------------------------------------------------------------
TUTORING BEHAVIOR
------------------------------------------------------------

You are a learning guide.

Do not dump answers when the student can reasonably work
through the problem.

Prefer:

- guiding questions
- hints
- small steps
- explanations
- examples
- checking reasoning

------------------------------------------------------------
HINT LADDER
------------------------------------------------------------

LEVEL 1:
Guiding question.

LEVEL 2:
Concept reminder.

LEVEL 3:
Formula or relationship.

LEVEL 4:
Partial reasoning.

LEVEL 5:
Full explanation.

If the student says:

"I don't know"
"I'm stuck"
"I'm lost"

give the next useful hint instead of immediately revealing
the complete solution.

------------------------------------------------------------
PRACTICE
------------------------------------------------------------

When the student asks for practice:

Generate a suitable exercise based on the current topic.

Do not immediately reveal the answer.

Wait for the student's attempt.

If they ask for another exercise, generate another.

If they ask for something harder, increase difficulty.

If they ask for something easier, decrease difficulty.

------------------------------------------------------------
CHECKING WORK
------------------------------------------------------------

When a student gives an answer:

Check their reasoning.

Do not blindly say "correct" or "incorrect."

If correct:
celebrate naturally and briefly explain why.

If incorrect:
identify the useful step to revisit.

Never shame the student.

------------------------------------------------------------
SIMPLIFY
------------------------------------------------------------

When something is difficult:

Do NOT simply repeat the previous explanation.

Actually simplify it.

Use:

- shorter sentences
- intuitive explanations
- simple analogies
- concrete examples
- practical situations

------------------------------------------------------------
REAL-LIFE EXAMPLES
------------------------------------------------------------

When useful, connect Physics to:

- robotics
- electronics
- embedded systems
- programming
- engineering
- experiments
- transport
- everyday technology

For example:

"Imagine you're programming a small robot..."

Then connect the situation to Physics.

Do not force an example into every response.

------------------------------------------------------------
CURRICULUM GROUNDING
------------------------------------------------------------

Use the supplied curriculum context as your primary source.

Do not invent RCA-specific content.

If the supplied material does not support a claim,
be transparent.

Do not silently replace school terminology with unrelated
terminology.

------------------------------------------------------------
PERSONALITY
------------------------------------------------------------

Be:

- intelligent
- friendly
- patient
- encouraging
- natural
- school-appropriate
- slightly Gen-Z/developer-friendly

Occasional emojis are fine.

Do not overuse slang.

Match the student's tone naturally.

Never force slang.

------------------------------------------------------------
RESPONSE VARIATION
------------------------------------------------------------

Do not repeatedly use identical wording.

Vary:

- greetings
- encouragement
- transitions
- examples
- explanations
- redirect wording

Do NOT randomly change technical facts.

------------------------------------------------------------
OUTPUT FORMAT
------------------------------------------------------------

Return ONLY valid JSON.

Do not use markdown code fences.

Use exactly:

{
  "intent": "ONE_VALID_INTENT",
  "topic": "best inferred topic or empty string",
  "learning_action": "ONE_VALID_ACTION",
  "difficulty": "easy | medium | hard | unknown",
  "confidence": 0.0,
  "reply": "the complete student-facing response"
}

The "reply" must contain ONLY what the student should see.

Do not put analysis inside reply.
`;


// ============================================================
// MAIN TUTOR ENGINE — V0.4
// ============================================================

export async function askTutor({
  message,
  history = [],
  mode = "tutor"
}) {

  const clean =
    cleanHistory(history);


  // ==========================================================
  // 1. LOCAL RETRIEVAL
  // ==========================================================

  /*
   * Retrieval costs ZERO API requests.
   *
   * We include the current message plus a small amount
   * of recent conversation so short follow-ups like
   * "give me another" can still retrieve the current topic.
   */

  const recentText =
    clean
      .slice(-4)
      .map((item) => item.content)
      .join(" ");

  const retrievalQuery = [
    recentText,
    message
  ]
    .filter(Boolean)
    .join(" ");


  const retrieved =
    retrieveRelevantChunks(
      retrievalQuery,
      6
    );


  const context =
    retrieved.length > 0
      ? retrieved.join(
          "\n\n---\n\n"
        )
      : "No directly matching curriculum material was retrieved.";


  // ==========================================================
  // 2. NO API KEY
  // ==========================================================

  if (!client) {

    console.log(
      "DoStudy Buddy: LOCAL FALLBACK — no API key"
    );

    return {

      mode: "local-fallback",

      intent: {
        intent: "CONTINUE",
        topic: "",
        learning_action: "CONTINUE",
        difficulty: "unknown",
        confidence: 0
      },

      reply:
        localFallback(
          message,
          clean,
          "CONTINUE"
        ),

      retrieved

    };
  }


  // ==========================================================
  // 3. ONE AI REQUEST
  // ==========================================================

  try {

    console.log(
      "DoStudy Buddy: AI ACTIVE — 1 request"
    );


    const response =
      await client.responses.create({

        model: MODEL,

        instructions:
          TUTOR_SYSTEM_PROMPT,

        input: `

MODE:
${mode}

CURRENT STUDENT MESSAGE:
${message}

RECENT CONVERSATION:
${formatHistory(clean)}

CURRICULUM CONTEXT:
${context}

Remember:

1. Understand the student's CURRENT message.
2. Use conversation history only as context.
3. The current request overrides previous activities.
4. Use curriculum context when relevant.
5. Return ONLY the required JSON.
`
      });


    // ========================================================
    // 4. PARSE STRUCTURED RESPONSE
    // ========================================================

    const raw =
      response.output_text
        ?.trim();


    if (!raw) {
      throw new Error(
        "AI returned an empty response."
      );
    }


    const cleaned =
      raw
        .replace(/^```json/i, "")
        .replace(/^```/, "")
        .replace(/```$/, "")
        .trim();


    let parsed;

    try {

      parsed =
        JSON.parse(cleaned);

    } catch (parseError) {

      /*
       * Sometimes an AI response may fail to follow JSON
       * perfectly. Instead of crashing the tutor, preserve
       * the response as a normal reply.
       */

      console.warn(
        "DoStudy Buddy: JSON parsing failed. " +
        "Using raw AI response."
      );

      return {

        mode: "ai",

        intent: {
          intent: "CONTINUE",
          topic: "",
          learning_action: "CONTINUE",
          difficulty: "unknown",
          confidence: 0
        },

        reply: raw,

        retrieved

      };
    }


    // ========================================================
    // 5. NORMALIZE
    // ========================================================

    const tutorResult =
      normalizeTutorResult(
        parsed
      );


    // ========================================================
    // 6. SAFETY CHECK
    // ========================================================

    if (!tutorResult.reply) {

      throw new Error(
        "AI returned no student-facing reply."
      );
    }


    // ========================================================
    // 7. LOG UNDERSTANDING
    // ========================================================

    console.log(
      "DoStudy Buddy understanding:",
      {
        intent:
          tutorResult.intent,

        topic:
          tutorResult.topic,

        action:
          tutorResult.learning_action,

        difficulty:
          tutorResult.difficulty,

        confidence:
          tutorResult.confidence
      }
    );


    // ========================================================
    // 8. RETURN
    // ========================================================

    return {

      mode: "ai",

      intent: tutorResult,

      reply:
        tutorResult.reply,

      retrieved

    };


  } catch (error) {

    // ========================================================
    // 9. RATE LIMIT / API ERROR
    // ========================================================

    const errorMessage =
      error?.message ||
      String(error);


    if (
      error?.status === 429 ||
      error?.code ===
        "rate_limit_exceeded" ||
      errorMessage
        .toLowerCase()
        .includes("rate limit")
    ) {

      console.warn(
        "DoStudy Buddy: AI RATE LIMITED — using fallback."
      );

    } else {

      console.error(
        "DoStudy Buddy AI error:",
        error
      );
    }


    return {

      mode:
        "fallback-after-error",

      intent: {
        intent: "CONTINUE",
        topic: "",
        learning_action: "CONTINUE",
        difficulty: "unknown",
        confidence: 0
      },

      reply:
        localFallback(
          message,
          clean,
          "CONTINUE"
        ),

      retrieved

    };
  }
}