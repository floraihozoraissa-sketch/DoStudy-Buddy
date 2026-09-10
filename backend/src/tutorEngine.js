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
// CURRICULUM RETRIEVAL
// ============================================================

function retrieveRelevantChunks(query, limit = 6) {
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
// INTENT UNDERSTANDING
// ============================================================

async function detectIntent(
  message,
  history = []
) {
  // ----------------------------------------------------------
  // If AI is unavailable, use a safe default.
  // ----------------------------------------------------------

  if (!client) {
    return {
      intent: "CONTINUE",
      topic: "",
      confidence: 0,
      reason: "AI unavailable."
    };
  }

  const recentHistory = cleanHistory(history)
    .slice(-6)
    .map((item) => ({
      role: item.role,
      content: item.content
    }));


  // ----------------------------------------------------------
  // CURRENT MESSAGE HAS PRIORITY
  // ----------------------------------------------------------

  const classifierPrompt = `
You are the intent-understanding layer of DoStudy Buddy,
an AI tutor for Rwanda Coding Academy students.

Your job is to understand what the student wants from their
CURRENT message.

IMPORTANT PRIORITY RULE:

The CURRENT student message has priority over previous intent.

Conversation history provides context, but it must NOT force
the current message into the previous intent.

Students naturally switch activities.

For example:

EXPLAIN
→ SIMPLIFY
→ PRACTICE
→ CHECK_ANSWER
→ HINT
→ PRACTICE

This is completely normal.

If the student clearly asks for a NEW learning action,
classify the new action even if the previous message had
a different intent.

Do NOT rely on exact keywords.

Understand meaning.

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

------------------------------------------------------------
AVAILABLE INTENTS
------------------------------------------------------------

GREETING
EXPLAIN
SIMPLIFY
EXAMPLE
PRACTICE
HINT
CHECK_ANSWER
CHALLENGE
EASIER
CONFUSION
CONTINUE
ENCOURAGEMENT
CASUAL_CONVERSATION
OUT_OF_SCOPE

------------------------------------------------------------
IMPORTANT EXAMPLES
------------------------------------------------------------

"yo"
"hey"
"sup"
"morning"
→ GREETING

"bro I'm lost"
"nah I don't get this"
"this makes zero sense"
"my brain isn't braining"
→ CONFUSION or SIMPLIFY depending on context

"walk me through it"
"how does this work?"
"can you explain that?"
→ EXPLAIN

"can you break this down?"
"explain it in simpler words"
"make that easier to understand"
→ SIMPLIFY

"give me a real-life example"
"where would I use this?"
"show me a practical example"
→ EXAMPLE

"give me a problem"
"hit me with a problem"
"throw one at me"
"lemme try one"
"give me something to solve"
"test me"
→ PRACTICE

"give me another"
"another one"
"throw another at me"
→ PRACTICE

"make it harder"
"level me up"
"give me a tougher one"
"challenge me"
→ CHALLENGE

"make it easier"
"start me with something basic"
"give me a simpler one"
→ EASIER

"give me a clue"
"small hint?"
"what should I look at?"
"help me without giving the answer"
→ HINT

"I got 5 N"
"my answer is 5 N"
"did I get this right?"
"is this correct?"
→ CHECK_ANSWER

"okay what's next?"
"what do I do now?"
"continue"
→ CONTINUE

"okay, I get it"
"got it"
"that makes sense now"
→ ENCOURAGEMENT or CONTINUE

"thanks"
"nice"
"cool"
→ CASUAL_CONVERSATION or ENCOURAGEMENT

------------------------------------------------------------
CONTEXT RULE
------------------------------------------------------------

A short message may depend on previous conversation.

Example:

Previous:
Student: Explain dimensional analysis.

Buddy:
[explanation]

Current:
"bro I'm cooked 💀"

This should NOT automatically be OUT_OF_SCOPE.

It is probably CONFUSION because the student is struggling
with the current learning topic.

Another example:

Previous:
Student: Explain dimensional analysis.

Current:
"throw another one at me"

This is PRACTICE.

Another example:

Previous:
Student: Here is the practice problem.

Current:
"I think I got 5 N"

This is CHECK_ANSWER.

------------------------------------------------------------
NEW REQUESTS OVERRIDE OLD INTENTS
------------------------------------------------------------

If the previous intent was SIMPLIFY and the student says:

"hit me with a problem"

the answer is:

PRACTICE

NOT:

SIMPLIFY

If the previous intent was EXPLAIN and the student says:

"give me a hint"

the answer is:

HINT

If the previous intent was PRACTICE and the student says:

"make it harder"

the answer is:

CHALLENGE

Always identify what the student wants NOW.

------------------------------------------------------------
OUT OF SCOPE
------------------------------------------------------------

Only classify OUT_OF_SCOPE when the request is genuinely
unrelated to the current DoStudy learning domain.

Do not classify a message as OUT_OF_SCOPE simply because:
- it is short
- it contains slang
- it contains typos
- it lacks Physics terminology
- it is informal
- the student says they are confused
- the student asks for another problem
- the student asks for a hint
- the student changes learning activities

------------------------------------------------------------
OUTPUT
------------------------------------------------------------

Return ONLY valid JSON.

Use this exact structure:

{
  "intent": "ONE_VALID_INTENT",
  "topic": "best inferred topic or empty string",
  "confidence": 0.0,
  "reason": "brief explanation"
}

CURRENT STUDENT MESSAGE:

${message}

RECENT CONVERSATION:

${JSON.stringify(recentHistory)}
`;


  try {
    const response =
      await client.responses.create({
        model: MODEL,
        input: classifierPrompt
      });


    const text =
      response.output_text
        ?.trim()
        .replace(/^```json/i, "")
        .replace(/^```/, "")
        .replace(/```$/, "")
        .trim();


    if (!text) {
      return {
        intent: "CONTINUE",
        topic: "",
        confidence: 0,
        reason: "No classifier response."
      };
    }


    const parsed =
      JSON.parse(text);


    if (
      !VALID_INTENTS.has(
        parsed.intent
      )
    ) {
      return {
        intent: "CONTINUE",
        topic: "",
        confidence: 0,
        reason: "Invalid classifier intent."
      };
    }


    return {
      intent: parsed.intent,
      topic:
        typeof parsed.topic === "string"
          ? parsed.topic
          : "",
      confidence:
        Number(parsed.confidence) || 0,
      reason:
        parsed.reason || ""
    };

  } catch (error) {

    console.error(
      "Intent detection failed:",
      error
    );

    return {
      intent: "CONTINUE",
      topic: "",
      confidence: 0,
      reason: "Intent detection failed."
    };
  }
}


// ============================================================
// TUTOR PERSONALITY
// ============================================================

const TUTOR_SYSTEM_PROMPT = `
You are DoStudy Buddy.

You are an AI learning companion for Rwanda Coding Academy
students.

CURRENT LEARNING DOMAIN:

RCA Year 1 Applied Physics, especially the supplied material
for Basic Measurements and Dimensional Analysis.

You are NOT simply a chatbot.

Your purpose is to help students actually learn.

------------------------------------------------------------
PERSONALITY
------------------------------------------------------------

Feel like a really smart friend who understands Physics
and genuinely wants the student to understand it.

Be:

- intelligent
- friendly
- patient
- encouraging
- natural
- school-appropriate
- slightly Gen-Z/developer-friendly

You may use occasional emojis.

Do not overuse slang.

Match the student's communication style naturally.

Never force slang.

------------------------------------------------------------
NATURAL CONVERSATION
------------------------------------------------------------

Students are humans.

Do not treat every message as a Physics question.

If the student says:

"hi"
"hey"
"yo"
"sup"
"good morning"

respond naturally.

Do NOT say:

"This is out of scope."

Do NOT immediately dump a Physics explanation.

Vary the wording naturally.

Do not repeatedly use the same greeting.

------------------------------------------------------------
RESPONSE VARIATION
------------------------------------------------------------

Do not repeatedly use identical sentences.

Avoid repeating the same:

- greeting
- encouragement
- transition
- out-of-scope message
- emoji combination

across similar interactions.

Generate natural variations while preserving the meaning.

Do not randomly vary technical facts.

Variation applies to conversational wording,
NOT curriculum facts.

------------------------------------------------------------
CONVERSATION TRANSITIONS
------------------------------------------------------------

Students can change what they want at any moment.

For example:

EXPLAIN → SIMPLIFY → PRACTICE → CHECK_ANSWER → HINT → PRACTICE

Do not force the student to remain in the previous activity.

Always respond to the student's CURRENT request.

------------------------------------------------------------
GUIDED LEARNING
------------------------------------------------------------

Do not behave like an answer generator.

Help students think.

Prefer:

- guiding questions
- hints
- small steps
- explanations
- examples
- checking reasoning

Avoid immediately giving a complete solution when the student
can reasonably solve the problem themselves.

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

When a student says:

"I don't know"
"I'm stuck"
"I'm lost"

normally provide the next useful hint instead of immediately
revealing the complete answer.

------------------------------------------------------------
PRACTICE
------------------------------------------------------------

When the student asks for an exercise:

Give a suitable exercise based on the current topic.

Do not immediately reveal the answer.

Wait for the student's attempt.

If they ask for another exercise, generate another one.

If they ask for something harder, increase difficulty.

If they ask for something easier, reduce difficulty.

------------------------------------------------------------
CHECKING ANSWERS
------------------------------------------------------------

When a student gives an answer:

Check their reasoning.

Do not blindly say "correct" or "incorrect."

If correct:

Celebrate naturally and explain briefly why.

If incorrect:

Be supportive.

Examples:

"Almost there 👀"

"You're close — let's check one step."

"Good attempt. There's just one part we need to revisit."

Never shame the student.

------------------------------------------------------------
SIMPLIFY
------------------------------------------------------------

When the student says something is difficult:

Do NOT simply repeat the same explanation.

Actually simplify it.

Use:

- shorter sentences
- intuitive explanations
- simple analogies
- concrete examples
- practical situations

------------------------------------------------------------
REAL-LIFE LEARNING
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

Then connect the situation to the Physics concept.

Do not force a real-world example into every response.

------------------------------------------------------------
OUT-OF-SCOPE
------------------------------------------------------------

Only redirect if the request is genuinely unrelated
to the current learning domain.

Never redirect merely because the student:

- forgot a Physics term
- used slang
- made a typo
- used informal English
- asked a short follow-up
- asked for help
- asked for an exercise
- asked for an example
- said they are confused

When something genuinely is outside the domain,
respond naturally and briefly.

Do not sound like an error message.

Vary your wording naturally.

------------------------------------------------------------
CURRICULUM GROUNDING
------------------------------------------------------------

Use the supplied curriculum context as your primary source.

Do not invent RCA-specific content.

If the provided material does not support a claim,
be transparent.

Do not silently replace school terminology with unrelated
terminology.

------------------------------------------------------------
GOAL
------------------------------------------------------------

The student should leave the conversation understanding more
than they did before.

Optimize for:

"helping the student understand."

Not simply:

"giving the fastest answer."
`;


// ============================================================
// LOCAL FALLBACK
// ============================================================

function localFallback(
  message,
  history = [],
  intent = "UNKNOWN"
) {

  switch (intent) {

    case "GREETING":
      return (
        "Yo! 😎 What's up? " +
        "Ready to tackle some Physics?"
      );


    case "PRACTICE":
      return (
        "Bet 😎 Here's one to try:\n\n" +
        "**Check whether this equation is dimensionally " +
        "consistent:**\n\n" +
        "`s = vt`\n\n" +
        "Start by writing the dimensions of `v` and `t`. " +
        "Send me your reasoning — don't worry about the " +
        "final answer yet."
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
        "Think of dimensional analysis as a Physics " +
        "consistency check. The two sides of an equation " +
        "need to represent the same type of physical quantity.\n\n" +
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
        "Nice 😎 You're getting it. " +
        "Let's keep going."
      );


    case "CASUAL_CONVERSATION":
      return (
        "Nice 😄 What's next?"
      );


    default:
      return (
        "Let's work through it together 🧠⚡. " +
        "Tell me what part you're unsure about."
      );
  }
}


// ============================================================
// CONVERSATIONAL RESPONSE
// ============================================================

async function generateConversationResponse(
  message,
  history,
  intent
) {

  if (!client) {
    return localFallback(
      message,
      history,
      intent.intent
    );
  }


  try {

    const response =
      await client.responses.create({

        model: MODEL,

        instructions: TUTOR_SYSTEM_PROMPT,

        input: [
          ...history.map((m) => ({
            role:
              m.role === "assistant"
                ? "assistant"
                : "user",
            content: m.content
          })),

          {
            role: "user",
            content: message
          }
        ]

      });


    return response.output_text;

  } catch (error) {

    console.error(
      "Conversation response error:",
      error
    );

    return localFallback(
      message,
      history,
      intent.intent
    );
  }
}


// ============================================================
// OUT-OF-SCOPE RESPONSE
// ============================================================

async function generateScopeResponse(
  message,
  history,
  intent
) {

  if (!client) {
    return localFallback(
      message,
      history,
      intent.intent
    );
  }


  try {

    const response =
      await client.responses.create({

        model: MODEL,

        instructions: `
You are DoStudy Buddy.

The student's request has been classified as genuinely
outside your current learning domain.

Respond naturally and briefly.

Your current focus is RCA Year 1 Applied Physics.

Do NOT sound like an error message.

Do NOT say:

"query invalid"
"access denied"
"request rejected"

Acknowledge the student naturally.

Then gently redirect them toward Physics.

Vary the wording naturally between conversations.

Match the student's tone without forcing slang.

Do not overuse emojis.
`,

        input: [
          ...history.map((m) => ({
            role:
              m.role === "assistant"
                ? "assistant"
                : "user",
            content: m.content
          })),

          {
            role: "user",
            content: message
          }
        ]

      });


    return response.output_text;

  } catch (error) {

    console.error(
      "Scope response error:",
      error
    );

    return (
      "Ah 😅 that's outside my current study area. " +
      "I'm mainly focused on RCA Year 1 Applied Physics " +
      "right now. Bring me a Physics question and let's " +
      "tackle it together! 🧠⚡"
    );
  }
}


// ============================================================
// MAIN TUTOR ENGINE
// ============================================================

export async function askTutor({
  message,
  history = [],
  mode = "tutor"
}) {

  const clean =
    cleanHistory(history);


  // ==========================================================
  // 1. UNDERSTAND CURRENT INTENT
  // ==========================================================

  const intent =
    await detectIntent(
      message,
      clean
    );


  console.log(
    "DoStudy Buddy intent:",
    intent
  );


  // ==========================================================
  // 2. CONVERSATIONAL INTENTS
  // ==========================================================

  const conversationalIntents = [
    "GREETING",
    "CASUAL_CONVERSATION",
    "ENCOURAGEMENT"
  ];


  if (
    conversationalIntents.includes(
      intent.intent
    )
  ) {

    const reply =
      await generateConversationResponse(
        message,
        clean,
        intent
      );


    return {
      mode: "conversation",
      intent,
      reply,
      retrieved: []
    };
  }


  // ==========================================================
  // 3. OUT OF SCOPE
  // ==========================================================

  if (
    intent.intent === "OUT_OF_SCOPE"
  ) {

    const reply =
      await generateScopeResponse(
        message,
        clean,
        intent
      );


    return {
      mode: "scope-redirect",
      intent,
      reply,
      retrieved: []
    };
  }


  // ==========================================================
  // 4. RETRIEVE CURRICULUM
  // ==========================================================

  const retrievalQuery = [
    intent.topic,
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
    retrieved.join(
      "\n\n---\n\n"
    );


  // ==========================================================
  // 5. LOCAL FALLBACK
  // ==========================================================

  if (!client) {

    return {
      mode: "local-fallback",
      intent,
      reply:
        localFallback(
          message,
          clean,
          intent.intent
        ),
      retrieved
    };
  }


  // ==========================================================
  // 6. FULL TUTOR RESPONSE
  // ==========================================================

  try {

    const response =
      await client.responses.create({

        model: MODEL,

        instructions:
          TUTOR_SYSTEM_PROMPT,

        input: [

          {
            role: "developer",

            content: `
CURRENT INTENT:

${JSON.stringify(
  intent,
  null,
  2
)}

CURRICULUM CONTEXT:

${
  context ||
  "No directly matching curriculum material was retrieved."
}

IMPORTANT:

Use conversation history to understand context.

However, always respond to the student's CURRENT intent.

Intent transitions are normal.

If the intent is PRACTICE:
give an exercise without immediately giving the solution.

If the intent is HINT:
give an appropriate hint.

If the intent is CHECK_ANSWER:
evaluate the student's reasoning.

If the intent is SIMPLIFY or CONFUSION:
actually simplify the explanation.

If the intent is CHALLENGE:
increase difficulty.

If the intent is EASIER:
reduce difficulty.

If the student asks for an example:
use a practical example when useful.
`
          },


          ...clean.map((m) => ({
            role:
              m.role === "assistant"
                ? "assistant"
                : "user",
            content: m.content
          })),


          {
            role: "user",

            content: `
Mode: ${mode}

Student message:

${message}
`
          }

        ]

      });


    return {

      mode: "ai",

      intent,

      reply:
        response.output_text,

      retrieved

    };

  } catch (error) {

    console.error(
      "DoStudy Buddy AI error:",
      error
    );


    return {

      mode: "fallback-after-error",

      intent,

      reply:
        localFallback(
          message,
          clean,
          intent.intent
        ),

      retrieved

    };
  }
}