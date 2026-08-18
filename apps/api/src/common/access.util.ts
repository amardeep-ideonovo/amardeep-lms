// ACCESS RULE (single source of truth):
// A course/lesson is unlocked for a user iff ANY of:
//   1. the course has ZERO assigned levels (open to any logged-in member), OR
//   2. the user holds an ACTIVE UserLevel among the course's assigned levels
//      (CourseLevel — subscription/class access).

export interface CourseLevelLike {
  levelId: string;
}

/**
 * @param assignedLevelIds the levelIds attached to the course via CourseLevel
 * @param activeLevelIds   the levelIds the user holds with status ACTIVE
 * @returns true if the course is LOCKED for this user
 */
export function isCourseLocked(
  assignedLevelIds: string[],
  activeLevelIds: Set<string>,
): boolean {
  // Open course — no level gating.
  if (assignedLevelIds.length === 0) return false;
  // Unlocked if any assigned level is among the user's active levels.
  return !assignedLevelIds.some((id) => activeLevelIds.has(id));
}
