// DoStudy Buddy v0.5
// Simple deterministic difficulty adaptation.

const LEVELS = ["easy", "medium", "hard"];

function levelIndex(level) {
  return LEVELS.indexOf(level);
}

export function adjustDifficulty(
  currentDifficulty,
  result,
  attempts = 1,
  hintsUsed = 0
) {
  let index = levelIndex(currentDifficulty);

  if (index === -1) {
    index = 0;
  }

  // Strong success:
  // correct with little support → level up.
  if (
    result === "CORRECT" &&
    attempts <= 2 &&
    hintsUsed <= 1
  ) {
    index = Math.min(index + 1, LEVELS.length - 1);
  }

  // Repeated struggle → level down.
  if (
    (result === "INCORRECT" || result === "PARTIAL") &&
    attempts >= 3
  ) {
    index = Math.max(index - 1, 0);
  }

  return LEVELS[index];
}

export function getProgressMessage(progress) {
  if (progress.exercisesAttempted === 0) {
    return "You haven't completed an exercise yet. Let's start!";
  }

  if (progress.accuracy >= 80) {
    return "You're showing strong understanding. Let's keep challenging you.";
  }

  if (progress.accuracy >= 50) {
    return "You're making progress. A little more practice will strengthen this topic.";
  }

  return "Let's slow down and strengthen the core idea before increasing the difficulty.";
}