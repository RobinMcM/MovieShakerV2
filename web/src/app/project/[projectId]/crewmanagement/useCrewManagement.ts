"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import type { Project, Skill, ProducerRole } from "./types";

interface ProjectListItem {
  id: string;
  name: string;
  status: string;
}

const CREW_SKILLS = "/api/crew/skills";
const CREW_ME_SKILLS = "/api/crew/me/skills";
const CREW_PRODUCER_ROLES = "/api/crew/producer-roles";
const CREW_ME_PRODUCER_ROLES = "/api/crew/me/producer-roles";
const PROFILE_ROLES = "/profile/roles";

export function useCrewManagement(projectId: string | null) {
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [actorSkills, setActorSkills] = useState<Skill[]>([]);
  const [crewSkills, setCrewSkills] = useState<Skill[]>([]);
  const [userSkillIds, setUserSkillIds] = useState<string[]>([]);
  const [producerRoles, setProducerRoles] = useState<ProducerRole[]>([]);
  const [userProducerRoleIds, setUserProducerRoleIds] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    description?: string;
    variant?: "default" | "destructive";
  } | null>(null);

  const showToast = useCallback(
    (title: string, description?: string, variant?: "default" | "destructive") => {
      setToastMessage({ title, description, variant });
    },
    []
  );

  const loadProject = useCallback(async (pid: string) => {
    try {
      const list = await api.get<ProjectListItem[]>("/projects/");
      const arr = Array.isArray(list) ? list : [];
      const found = arr.find((p) => p.id === pid);
      if (found) {
        setProject({ id: found.id, name: found.name, status: found.status });
      } else {
        setProject(null);
      }
    } catch {
      setProject(null);
      showToast("Error", "Failed to load project", "destructive");
    }
  }, [showToast]);

  const loadUserData = useCallback(async () => {
    try {
      let roles: string[] = [];
      try {
        const rolesRes = await api.get<{ roles?: string[] }>(PROFILE_ROLES);
        roles = Array.isArray(rolesRes?.roles) ? rolesRes.roles : [];
      } catch {
        roles = [];
      }
      setUserRoles(roles);

      let allSkills: Skill[] = [];
      try {
        const skillsRes = await api.get<{ data?: Skill[]; actor?: Skill[]; crew?: Skill[] }>(CREW_SKILLS);
        if (Array.isArray((skillsRes as { data?: Skill[] }).data)) {
          allSkills = (skillsRes as { data: Skill[] }).data;
        } else if (Array.isArray((skillsRes as { actor?: Skill[] }).actor) || Array.isArray((skillsRes as { crew?: Skill[] }).crew)) {
          const r = skillsRes as { actor?: Skill[]; crew?: Skill[] };
          allSkills = [...(r.actor ?? []), ...(r.crew ?? [])];
        }
      } catch {
        allSkills = [];
      }
      setActorSkills(allSkills.filter((s) => s.category === "actor"));
      setCrewSkills(allSkills.filter((s) => s.category === "crew"));

      let skillIds: string[] = [];
      try {
        const meRes = await api.get<{ data?: string[]; skill_ids?: string[] }>(CREW_ME_SKILLS);
        skillIds = Array.isArray((meRes as { data?: string[] }).data)
          ? (meRes as { data: string[] }).data
          : Array.isArray((meRes as { skill_ids?: string[] }).skill_ids)
            ? (meRes as { skill_ids: string[] }).skill_ids
            : [];
      } catch {
        skillIds = [];
      }
      setUserSkillIds(skillIds);

      let rolesList: ProducerRole[] = [];
      try {
        const prRes = await api.get<{ data?: ProducerRole[] }>(CREW_PRODUCER_ROLES);
        rolesList = Array.isArray((prRes as { data?: ProducerRole[] }).data) ? (prRes as { data: ProducerRole[] }).data : [];
      } catch {
        rolesList = [];
      }
      setProducerRoles(rolesList);

      let roleIds: string[] = [];
      try {
        const mePrRes = await api.get<{ data?: string[]; producer_role_ids?: string[] }>(CREW_ME_PRODUCER_ROLES);
        roleIds = Array.isArray((mePrRes as { data?: string[] }).data)
          ? (mePrRes as { data: string[] }).data
          : Array.isArray((mePrRes as { producer_role_ids?: string[] }).producer_role_ids)
            ? (mePrRes as { producer_role_ids: string[] }).producer_role_ids
            : [];
      } catch {
        roleIds = [];
      }
      setUserProducerRoleIds(roleIds);
    } catch {
      showToast("Error", "Failed to load crew data", "destructive");
    }
  }, [showToast]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (projectId) await loadProject(projectId);
      await loadUserData();
    } finally {
      setLoading(false);
    }
  }, [projectId, loadProject, loadUserData]);

  const toggleSkill = useCallback(
    async (skillId: string, checked: boolean) => {
      try {
        if (checked) {
          await api.post(CREW_ME_SKILLS, { skill_id: skillId });
          setUserSkillIds((prev) => (prev.includes(skillId) ? prev : [...prev, skillId]));
          showToast("Skill added", "The skill has been added to your profile.");
        } else {
          await api.delete(`${CREW_ME_SKILLS}/${skillId}`);
          setUserSkillIds((prev) => prev.filter((id) => id !== skillId));
          showToast("Skill removed", "The skill has been removed from your profile.");
        }
      } catch {
        showToast("Error", "Failed to update skill. Please try again.", "destructive");
      }
    },
    [showToast]
  );

  const toggleProducerRole = useCallback(
    async (roleId: string, checked: boolean) => {
      try {
        if (checked) {
          await api.post(CREW_ME_PRODUCER_ROLES, { producer_role_id: roleId });
          setUserProducerRoleIds((prev) => (prev.includes(roleId) ? prev : [...prev, roleId]));
          showToast("Role added", "The role has been added to your profile.");
        } else {
          await api.delete(`${CREW_ME_PRODUCER_ROLES}/${roleId}`);
          setUserProducerRoleIds((prev) => prev.filter((id) => id !== roleId));
          showToast("Role removed", "The role has been removed from your profile.");
        }
      } catch {
        showToast("Error", "Failed to update role. Please try again.", "destructive");
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    setLoading(true);
    loadProject(projectId)
      .then(() => loadUserData())
      .finally(() => setLoading(false));
  }, [projectId, loadProject, loadUserData]);

  return {
    loading,
    project,
    userRoles,
    actorSkills,
    crewSkills,
    userSkillIds,
    producerRoles,
    userProducerRoleIds,
    toastMessage,
    clearToast: () => setToastMessage(null),
    refresh,
    toggleSkill,
    toggleProducerRole,
  };
}
