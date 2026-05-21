// ACCESS RULE (single source of truth):
// A course/lesson is unlocked for a user iff the user holds at least one
// UserLevel with status ACTIVE among the course's assigned levels (CourseLevel).
// A course with ZERO assigned levels is open to any logged-in member.

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
