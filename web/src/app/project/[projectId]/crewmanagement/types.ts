/**
 * Crew Management page types. Aligned with expected engine/API shapes.
 * Legacy uses Supabase (skills, user_skills, producer_roles, user_producer_roles);
 * engine may expose equivalent under /api/crew/...
 */

export interface Project {
  id: string;
  name: string;
  status: string;
}

export interface Skill {
  id: string;
  name: string;
  skill_type?: string;
  category: "actor" | "crew";
}

export interface ProducerRole {
  id: string;
  name: string;
  category: "producer" | "director";
}

export type UserRoles = string[];

/** Group skills by skill_type for accordion. */
export function groupSkillsByType(skills: Skill[]): Record<string, Skill[]> {
  const grouped: Record<string, Skill[]> = {};
  skills.forEach((skill) => {
    const type = skill.skill_type ?? "Other";
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(skill);
  });
  return grouped;
}
