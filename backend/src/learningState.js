// DoStudy Buddy v0.5
// Lightweight in-memory learning state.
// Later this can be replaced by a database.

const sessions = new Map();

function createDefaultState() {
  return {
    subject: "Applied Physics",
    topic: "dimensional analysis",
    difficulty: "easy",

    currentExercise: null,

    attempts: 0,
    hintsUsed: 0,

    exercisesAttempted: 0,
    exercisesCorrect: 0,
    exercisesPartial: 0,

    confidence: null,

    conceptsMastered: [],
    conceptsNeedingSupport: [],

    lastResult: null,
    lastAction: null
  };
}

export function getSession(sessionId = "default") {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createDefaultState());
  }

  return sessions.get(sessionId);
}

export function resetSession(sessionId = "default") {
  sessions.set(sessionId, createDefaultState());
  return sessions.get(sessionId);
}

export function updateSession(sessionId, updates) {
  const state = getSession(sessionId);

  Object.assign(state, updates);

  return state;
}

export function recordAttempt(sessionId) {
  const state = getSession(sessionId);

  state.attempts += 1;

  return state;
}

export function recordHint(sessionId) {
  const state = getSession(sessionId);

  state.hintsUsed += 1;

  return state;
}

export function startExercise(sessionId, exercise) {
  const state = getSession(sessionId);

  state.currentExercise = exercise;
  state.attempts = 0;
  state.hintsUsed = 0;
  state.lastResult = null;
  state.lastAction = "GENERATE_EXERCISE";

  return state;
}

export function finishExercise(sessionId, status, concept) {
  const state = getSession(sessionId);

  state.exercisesAttempted += 1;
  state.lastResult = status;

  if (status === "CORRECT") {
    state.exercisesCorrect += 1;

    if (
      concept &&
      !state.conceptsMastered.includes(concept)
    ) {
      state.conceptsMastered.push(concept);
    }

    if (concept) {
      state.conceptsNeedingSupport =
        state.conceptsNeedingSupport.filter(
          item => item !== concept
        );
    }
  }

  if (status === "PARTIAL") {
    state.exercisesPartial += 1;

    if (
      concept &&
      !state.conceptsNeedingSupport.includes(concept)
    ) {
      state.conceptsNeedingSupport.push(concept);
    }
  }

  if (status === "INCORRECT") {
    if (
      concept &&
      !state.conceptsNeedingSupport.includes(concept)
    ) {
      state.conceptsNeedingSupport.push(concept);
    }
  }

  state.lastAction = "CHECK_WORK";

  return state;
}

export function getProgress(sessionId = "default") {
  const state = getSession(sessionId);

  const total =
    state.exercisesAttempted;

  const accuracy =
    total === 0
      ? 0
      : Math.round(
          (state.exercisesCorrect / total) * 100
        );

  return {
    topic: state.topic,
    difficulty: state.difficulty,
    exercisesAttempted: total,
    exercisesCorrect: state.exercisesCorrect,
    exercisesPartial: state.exercisesPartial,
    accuracy,
    attempts: state.attempts,
    hintsUsed: state.hintsUsed,
    confidence: state.confidence,
    conceptsMastered: state.conceptsMastered,
    conceptsNeedingSupport:
      state.conceptsNeedingSupport,
    lastResult: state.lastResult
  };
}