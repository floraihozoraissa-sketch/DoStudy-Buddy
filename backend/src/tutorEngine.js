// DoStudy Buddy v0.5
// Complete guided-learning engine.
//
// Learning loop:
// Practice → Attempt → Check → Hint → Retry → Progress → Difficulty
//
// Important:
// - Maximum ONE AI request per student turn.
// - Curriculum retrieval is local.
// - Learning state is managed locally.
// - AI acts as a tutor, not an answer generator.

import fs from "fs";
import path from "path";
import OpenAI from "openai";

import {
  getSession,
  updateSession,
  recordAttempt,
  recordHint,
  startExercise,
  finishExercise,
  getProgress
} from "./learningState.js";

import {
  adjustDifficulty,
  getProgressMessage
} from "./progressEngine.js";

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    })
  : null;

// ---------------------------------------------------------
// 1. LOAD KNOWLEDGE BASE
// ---------------------------------------------------------

const knowledgePath = path.join(
  process.cwd(),
  "data",
  "dimensional_analysis.json"
);

let knowledgeBase = {};

try {
  knowledgeBase = JSON.parse(
    fs.readFileSync(knowledgePath, "utf8")
  );
} catch (error) {
  console.error(
    "DoStudy Buddy: Could not load knowledge base.",
    error.message
  );
}

// ---------------------------------------------------------
// 2. KNOWLEDGE RETRIEVAL
// ---------------------------------------------------------

function flattenKnowledge(value, pathParts = []) {
  const chunks = [];

  if (typeof value === "string") {
    chunks.push({
      text: value,
      path: pathParts.join(" > ")
    });

    return chunks;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      chunks.push(
        ...flattenKnowledge(
          item,
          [...pathParts, String(index)]
        )
      );
    });

    return chunks;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      chunks.push(
        ...flattenKnowledge(
          child,
          [...pathParts, key]
        )
      );
    }
  }

  return chunks;
}

const knowledgeChunks =
  flattenKnowledge(knowledgeBase);

function retrieveRelevantChunks(query, limit = 6) {
  if (!query || !knowledgeChunks.length) {
    return [];
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(term => term.length > 2);

  const scored = knowledgeChunks.map(chunk => {
    const text = chunk.text.toLowerCase();

    let score = 0;

    for (const term of terms) {
      if (text.includes(term)) {
        score += 1;
      }
    }

    return {
      ...chunk,
      score
    };
  });

  return scored
    .filter(chunk => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------
// 3. HISTORY
// ---------------------------------------------------------

function cleanHistory(history = []) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(
      item =>
        item &&
        typeof item.role === "string" &&
        typeof item.content === "string"
    )
    .slice(-12);
}

function formatHistory(history) {
  return cleanHistory(history)
    .map(
      item =>
        `${item.role.toUpperCase()}: ${item.content}`
    )
    .join("\n");
}

// ---------------------------------------------------------
// 4. VALID AI OUTPUT
// ---------------------------------------------------------

const VALID_INTENTS = [
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
  "PROGRESS",
  "OUT_OF_SCOPE"
];

const VALID_ACTIONS = [
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
  "SHOW_PROGRESS",
  "REDIRECT"
];

const VALID_DIFFICULTIES = [
  "easy",
  "medium",
  "hard",
  "unknown"
];

const VALID_RESULTS = [
  "CORRECT",
  "PARTIAL",
  "INCORRECT",
  "UNCLEAR",
  "NONE"
];

// ---------------------------------------------------------
// 5. NORMALIZE AI RESULT
// ---------------------------------------------------------

function normalizeTutorResult(result) {
  const normalized = {
    intent: VALID_INTENTS.includes(result?.intent)
      ? result.intent
      : "CONTINUE",

    topic:
      typeof result?.topic === "string"
        ? result.topic
        : "",

    learning_action:
      VALID_ACTIONS.includes(result?.learning_action)
        ? result.learning_action
        : "CONTINUE",

    difficulty:
      VALID_DIFFICULTIES.includes(result?.difficulty)
        ? result.difficulty
        : "unknown",

    confidence:
      typeof result?.confidence === "number"
        ? Math.max(
            0,
            Math.min(1, result.confidence)
          )
        : 0.5,

    reply:
      typeof result?.reply === "string"
        ? result.reply.trim()
        : "",

    exercise: null,

    check: {
      status: "NONE",
      feedback: "",
      needs_hint: false
    }
  };

  // Exercise
  if (
    result?.exercise &&
    typeof result.exercise === "object"
  ) {
    normalized.exercise = {
      id:
        typeof result.exercise.id === "string"
          ? result.exercise.id
          : `exercise-${Date.now()}`,

      question:
        typeof result.exercise.question === "string"
          ? result.exercise.question
          : "",

      concept:
        typeof result.exercise.concept === "string"
          ? result.exercise.concept
          : normalized.topic,

      expected_answer_type:
        typeof result.exercise.expected_answer_type ===
        "string"
          ? result.exercise.expected_answer_type
          : "reasoning"
    };
  }

  // Check
  if (
    result?.check &&
    typeof result.check === "object"
  ) {
    const status =
      typeof result.check.status === "string"
        ? result.check.status.toUpperCase()
        : "NONE";

    normalized.check.status =
      VALID_RESULTS.includes(status)
        ? status
        : "NONE";

    normalized.check.feedback =
      typeof result.check.feedback === "string"
        ? result.check.feedback
        : "";

    normalized.check.needs_hint =
      Boolean(result.check.needs_hint);
  }

  return normalized;
}

// ---------------------------------------------------------
// 6. FALLBACK
// ---------------------------------------------------------

function localFallback(message, state) {
  const text = message.toLowerCase();

  if (
    text.includes("hi") ||
    text.includes("hello") ||
    text.includes("hey") ||
    text.includes("yo")
  ) {
    return {
      intent: "GREETING",
      topic: state.topic,
      learning_action: "CONVERSATION",
      difficulty: state.difficulty,
      confidence: 1,
      reply:
        "Hey! 👋 Ready to learn? We can explain a concept, work through an example, or practice."
    };
  }

  if (
    text.includes("practice") ||
    text.includes("exercise") ||
    text.includes("problem")
  ) {
    return {
      intent: "PRACTICE",
      topic: state.topic,
      learning_action: "GENERATE_EXERCISE",
      difficulty: state.difficulty,
      confidence: 0.8,
      reply:
        "Let's practice. I'll give you a problem first—try it yourself before asking for a hint.",
      exercise: {
        id: `fallback-${Date.now()}`,
        question:
          "Use dimensional analysis to check whether s = vt is dimensionally consistent.",
        concept: "dimensional consistency",
        expected_answer_type: "reasoning"
      },
      check: {
        status: "NONE",
        feedback: "",
        needs_hint: false
      }
    };
  }

  if (
    text.includes("hint") ||
    text.includes("help") ||
    text.includes("don't know") ||
    text.includes("dont know")
  ) {
    return {
      intent: "HINT",
      topic: state.topic,
      learning_action: "GIVE_HINT",
      difficulty: state.difficulty,
      confidence: 0.9,
      reply:
        "Start by writing the dimensions of each quantity in the equation. Then compare the two sides."
    };
  }

  if (
    text.includes("easier") ||
    text.includes("simpler") ||
    text.includes("confusing") ||
    text.includes("lost")
  ) {
    return {
      intent: "SIMPLIFY",
      topic: state.topic,
      learning_action: "SIMPLIFY",
      difficulty: state.difficulty,
      confidence: 0.9,
      reply:
        "No worries. Think of dimensional analysis as a unit check: compare what the left side represents with what the right side represents."
    };
  }

  if (
    text.includes("example") ||
    text.includes("real life")
  ) {
    return {
      intent: "EXAMPLE",
      topic: state.topic,
      learning_action: "GIVE_EXAMPLE",
      difficulty: state.difficulty,
      confidence: 0.9,
      reply:
        "Imagine you're building a robot and calculate a movement equation. Dimensional analysis helps you catch equations whose units don't make physical sense before using them."
    };
  }

  if (
    text.includes("how am i doing") ||
    text.includes("my progress") ||
    text.includes("progress")
  ) {
    const progress = getProgress();

    return {
      intent: "PROGRESS",
      topic: state.topic,
      learning_action: "SHOW_PROGRESS",
      difficulty: state.difficulty,
      confidence: 1,
      reply: getProgressMessage(progress)
    };
  }

  return {
    intent: "CONTINUE",
    topic: state.topic,
    learning_action: "CONTINUE",
    difficulty: state.difficulty,
    confidence: 0.5,
    reply:
      "Let's keep going with dimensional analysis. What part would you like to work on?"
  };
}

// ---------------------------------------------------------
// 7. TUTOR SYSTEM PROMPT
// ---------------------------------------------------------

const TUTOR_SYSTEM_PROMPT = `
You are DoStudy Buddy, a friendly AI learning tutor for students.

Your job is NOT to simply give answers.

Your job is to help students:
- understand concepts
- think through problems
- practice
- learn from mistakes
- use real-life examples
- become more independent

CURRENT CURRICULUM SCOPE:
The current knowledge base is Applied Physics, especially dimensional analysis.

IMPORTANT:
You may have conversational knowledge outside the curriculum, but DoStudy is a learning tutor.
For questions clearly outside the educational scope, redirect briefly and naturally.

NATURAL CONVERSATION:
Students may use slang, short messages, typos, emojis, informal English, or developer-style language.
Understand their meaning from context.

A greeting such as:
"yo bro"
"hi"
"hey"
should receive a natural greeting.

Do NOT classify normal conversational follow-ups as OUT_OF_SCOPE.

CONVERSATION CONTEXT:
Use previous messages to understand what the student means.

For example:
Student: "Give me a problem."
Tutor: [exercise]
Student: "I don't know."
This means the student is struggling with the current exercise.

Student: "Give me another one."
This means generate a new exercise on the same topic.

Student: "Make it easier."
This means decrease difficulty or simplify the current learning task.

Student: "That was too easy."
This means increase difficulty.

PRACTICE:
When generating an exercise:
- Give ONE exercise.
- Do NOT reveal the solution.
- Match the current difficulty.
- Ground the exercise in the curriculum.
- Prefer realistic Physics/engineering/programming-related contexts when useful.

CHECKING:
When checking a student's attempt:
- Evaluate the reasoning, not only the final answer.
- Distinguish CORRECT, PARTIAL, INCORRECT, and UNCLEAR.
- If partially correct, explicitly recognize what they understood.
- Do not blindly mark an answer correct or incorrect.
- Do not reveal the complete solution unnecessarily.

HINT LADDER:
Use progressive help.

Level 1:
Ask a guiding question.

Level 2:
Remind the student of the relevant concept.

Level 3:
Point toward the relevant formula or dimensional relationship.

Level 4:
Give a partial solution.

Level 5:
Give the complete explanation only when appropriate.

If a student says "I don't know", normally give a useful hint rather than the full answer.

SIMPLIFICATION:
If the student says something is confusing or asks for an easier explanation:
- use simpler language
- reduce abstraction
- use a concrete analogy
- preserve correctness
- do not merely repeat the previous explanation with different words

REAL-LIFE EXAMPLES:
When the student asks where a concept is useful, connect it to practical contexts such as:
- electronics
- robotics
- programming
- engineering
- measurements
- experiments

Do not invent specific school activities that are not supported by the curriculum.

DIFFICULTY:
Use easy, medium, or hard.

Increase difficulty when the student demonstrates strong understanding.

Decrease difficulty when the student repeatedly struggles.

Do not change difficulty simply because of one mistake.

PROGRESS:
Use the provided learning state.
Do not invent statistics about the student.

RESPONSE STYLE:
Friendly.
Patient.
Encouraging.
Natural.
Concise but useful.
Slightly informal when appropriate.

Do not overuse emojis.

VARIATION:
Avoid repeating identical wording across turns.
Respond naturally to the exact current message.

OUTPUT:
Return ONLY valid JSON.

Required structure:

{
  "intent": "ONE_VALID_INTENT",
  "topic": "best inferred topic",
  "learning_action": "ONE_VALID_ACTION",
  "difficulty": "easy | medium | hard | unknown",
  "confidence": 0.0,
  "reply": "complete student-facing response",
  "exercise": {
    "id": "string",
    "question": "string",
    "concept": "string",
    "expected_answer_type": "string"
  },
  "check": {
    "status": "CORRECT | PARTIAL | INCORRECT | UNCLEAR | NONE",
    "feedback": "string",
    "needs_hint": true
  }
}

If no exercise is involved:
"exercise" must be null.

If no checking is involved:
"check.status" must be "NONE".
`;

// ---------------------------------------------------------
// 8. MAIN TUTOR FUNCTION
// ---------------------------------------------------------

export async function askTutor({
  message,
  history = [],
  sessionId = "default"
}) {
  const state = getSession(sessionId);

  const safeMessage =
    typeof message === "string"
      ? message.trim()
      : "";

  if (!safeMessage) {
    return {
      reply:
        "Tell me what you'd like to learn or practice.",
      session: state,
      progress: getProgress(sessionId)
    };
  }

  const safeHistory = cleanHistory(history);

  // -------------------------------------------------------
  // Detect obvious state-dependent actions locally.
  // This saves unnecessary complexity and protects the
  // exercise lifecycle.
  // -------------------------------------------------------

  const lowerMessage =
    safeMessage.toLowerCase();

  const asksForHint =
    lowerMessage.includes("hint") ||
    lowerMessage.includes("help me") ||
    lowerMessage.includes("i don't know") ||
    lowerMessage.includes("i dont know") ||
    lowerMessage.includes("stuck");

  const asksForProgress =
    lowerMessage.includes("how am i doing") ||
    lowerMessage.includes("my progress") ||
    lowerMessage.includes("show my progress");

  // -------------------------------------------------------
  // Retrieve curriculum context BEFORE the AI request.
  // Retrieval itself costs ZERO API requests.
  // -------------------------------------------------------

  const recentText = safeHistory
    .slice(-5)
    .map(item => item.content)
    .join(" ");

  const retrievalQuery = [
    state.topic,
    state.subject,
    recentText,
    safeMessage
  ].join(" ");

  const relevantChunks =
    retrieveRelevantChunks(
      retrievalQuery,
      6
    );

  const curriculumContext =
    relevantChunks.length
      ? relevantChunks
          .map(
            chunk =>
              `[${chunk.path}]\n${chunk.text}`
          )
          .join("\n\n")
      : "No directly matching curriculum chunk was retrieved.";

  // -------------------------------------------------------
  // Learning state context
  // -------------------------------------------------------

  const currentExercise =
    state.currentExercise
      ? JSON.stringify(state.currentExercise)
      : "None";

  const progress =
    getProgress(sessionId);

  const learningStateContext = `
SUBJECT:
${state.subject}

TOPIC:
${state.topic}

CURRENT DIFFICULTY:
${state.difficulty}

CURRENT EXERCISE:
${currentExercise}

ATTEMPTS ON CURRENT EXERCISE:
${state.attempts}

HINTS USED ON CURRENT EXERCISE:
${state.hintsUsed}

SESSION PROGRESS:
${JSON.stringify(progress)}
`;

  // -------------------------------------------------------
  // Fallback when API unavailable
  // -------------------------------------------------------

  if (!client) {
    console.log(
      "DoStudy Buddy: AI unavailable — using fallback."
    );

    const fallback =
      localFallback(
        safeMessage,
        state
      );

    return applyLearningState(
      fallback,
      safeMessage,
      sessionId
    );
  }

  // -------------------------------------------------------
  // ONE AI REQUEST
  // -------------------------------------------------------

  try {
    console.log(
      "DoStudy Buddy: AI ACTIVE — 1 request"
    );

    const response =
      await client.responses.create({
        model:
          process.env.OPENAI_MODEL ||
          "gpt-5.6-luna",

        instructions:
          TUTOR_SYSTEM_PROMPT,

        input: `
CURRICULUM CONTEXT:
${curriculumContext}

LEARNING STATE:
${learningStateContext}

CONVERSATION HISTORY:
${formatHistory(safeHistory)}

CURRENT STUDENT MESSAGE:
${safeMessage}
`
      });

    const rawOutput =
      response.output_text?.trim() || "";

    let parsed;

    try {
      parsed = JSON.parse(rawOutput);
    } catch {
      console.warn(
        "DoStudy Buddy: AI returned non-JSON output."
      );

      parsed = {
        intent: "CONTINUE",
        topic: state.topic,
        learning_action: "CONTINUE",
        difficulty: state.difficulty,
        confidence: 0.5,
        reply: rawOutput,
        exercise: null,
        check: {
          status: "NONE",
          feedback: "",
          needs_hint: false
        }
      };
    }

    const result =
      normalizeTutorResult(parsed);

    // -----------------------------------------------------
    // Force progress requests through current state.
    // -----------------------------------------------------

    if (asksForProgress) {
      result.intent = "PROGRESS";
      result.learning_action = "SHOW_PROGRESS";

      result.reply =
        `${getProgressMessage(progress)} ` +
        `You've attempted ${progress.exercisesAttempted} ` +
        `exercise(s), with ${progress.accuracy}% accuracy.`;
    }

    // -----------------------------------------------------
    // Prevent an AI response from accidentally giving a
    // second exercise while one is active unless the
    // student clearly asks for another one.
    // -----------------------------------------------------

    const asksForAnother =
      lowerMessage.includes("another") ||
      lowerMessage.includes("new one") ||
      lowerMessage.includes("different one");

    if (
      state.currentExercise &&
      !asksForAnother &&
      result.learning_action ===
        "GENERATE_EXERCISE"
    ) {
      result.learning_action = "CONTINUE";
    }

    // -----------------------------------------------------
    // Hint accounting
    // -----------------------------------------------------

    if (
      result.learning_action ===
      "GIVE_HINT"
    ) {
      recordHint(sessionId);
    }

    // -----------------------------------------------------
    // Attempt accounting
    //
    // If there is an active exercise and the student is
    // clearly responding to it, count the turn as an attempt.
    // -----------------------------------------------------

    const checking =
      result.intent === "CHECK_ANSWER" ||
      result.learning_action ===
        "CHECK_WORK";

    if (checking && state.currentExercise) {
      recordAttempt(sessionId);
    }

    // -----------------------------------------------------
    // Apply result to learning state
    // -----------------------------------------------------

    return applyLearningState(
      result,
      safeMessage,
      sessionId
    );
  } catch (error) {
    if (
      error?.code === "rate_limit_exceeded" ||
      error?.status === 429
    ) {
      console.log(
        "DoStudy Buddy: AI RATE LIMITED — using fallback."
      );
    } else {
      console.error(
        "DoStudy Buddy AI error:",
        error.message
      );
    }

    const fallback =
      localFallback(
        safeMessage,
        state
      );

    return applyLearningState(
      fallback,
      safeMessage,
      sessionId
    );
  }
}

// ---------------------------------------------------------
// 9. APPLY LEARNING STATE
// ---------------------------------------------------------

function applyLearningState(
  result,
  message,
  sessionId
) {
  const state =
    getSession(sessionId);

  // Topic
  if (
    result.topic &&
    result.topic.trim()
  ) {
    updateSession(
      sessionId,
      {
        topic: result.topic.trim()
      }
    );
  }

  // Difficulty
  if (
    result.difficulty &&
    result.difficulty !== "unknown"
  ) {
    updateSession(
      sessionId,
      {
        difficulty: result.difficulty
      }
    );
  }

  // -------------------------------------------------------
  // New exercise
  // -------------------------------------------------------

  if (
    result.learning_action ===
      "GENERATE_EXERCISE" &&
    result.exercise?.question
  ) {
    startExercise(
      sessionId,
      result.exercise
    );
  }

  // -------------------------------------------------------
  // Checking result
  // -------------------------------------------------------

  if (
    result.check &&
    result.check.status !== "NONE" &&
    state.currentExercise
  ) {
    const concept =
      result.exercise?.concept ||
      state.currentExercise.concept ||
      state.topic;

    const updatedState =
      finishExercise(
        sessionId,
        result.check.status,
        concept
      );

    // Difficulty adaptation
    const newDifficulty =
      adjustDifficulty(
        updatedState.difficulty,
        result.check.status,
        updatedState.attempts,
        updatedState.hintsUsed
      );

    updateSession(
      sessionId,
      {
        difficulty: newDifficulty
      }
    );

    console.log(
      "DoStudy Buddy learning result:",
      {
        status:
          result.check.status,
        attempts:
          updatedState.attempts,
        hintsUsed:
          updatedState.hintsUsed,
        difficulty:
          newDifficulty
      }
    );
  }

  // -------------------------------------------------------
  // Confidence
  // -------------------------------------------------------

  const confidenceMatch =
    message.match(
      /(?:confidence|confident)\s*(?:is|:)?\s*([1-5])/i
    );

  if (confidenceMatch) {
    updateSession(
      sessionId,
      {
        confidence:
          Number(confidenceMatch[1])
      }
    );
  }

  // -------------------------------------------------------
  // Final state
  // -------------------------------------------------------

  const finalState =
    getSession(sessionId);

  const finalProgress =
    getProgress(sessionId);

  console.log(
    "DoStudy Buddy understanding:",
    {
      intent: result.intent,
      topic: result.topic || finalState.topic,
      action: result.learning_action,
      difficulty:
        finalState.difficulty,
      confidence:
        result.confidence
    }
  );

  return {
    reply:
      result.reply ||
      "Let's keep going.",

    intent:
      result.intent,

    topic:
      finalState.topic,

    learning_action:
      result.learning_action,

    difficulty:
      finalState.difficulty,

    confidence:
      result.confidence,

    exercise:
      finalState.currentExercise,

    check:
      result.check,

    session: finalState,

    progress: finalProgress
  };
}