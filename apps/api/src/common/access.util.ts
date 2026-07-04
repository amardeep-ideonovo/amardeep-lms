// ACCESS RULE (single source of truth):
// A course/lesson is unlocked for a user iff ANY of:
//   1. the course has ZERO assigned levels (open to any logged-in member), OR
//   2. the user holds an ACTIVE UserLevel among the course's assigned levels
//      (CourseLevel — subscription/class access), OR
//   3. the user has bought the course directly (an ACTIVE UserCourse — a one-off
//      course purchase or a manual admin grant).

export interface CourseLevelLike {
  levelId: string;
}

/**
 * @param assignedLevelIds the levelIds attached to the course via CourseLevel
 * @param activeLevelIds   the levelIds the user holds with status ACTIVE
 * @param ownsCourse       true if the user has an ACTIVE course-scoped grant
 *                         (one-off purchase / manual grant) for THIS course
 * @returns true if the course is LOCKED for this user
 */
export function isCourseLocked(
  assignedLevelIds: string[],
  activeLevelIds: Set<string>,
  ownsCourse = false,
): boolean {
  // A direct course purchase unlocks regardless of levels.
  if (ownsCourse) return false;
  // Open course — no level gating.
  if (assignedLevelIds.length === 0) return false;
  // Unlocked if any assigned level is among the user's active levels.
  return !assignedLevelIds.some((id) => activeLevelIds.has(id));
}
