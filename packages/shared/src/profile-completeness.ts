import type {
  BasicFactInput,
  JobPreferencesFactInput,
  LanguageFactInput,
  ProjectExperienceFactInput,
  SkillFactInput,
  WorkExperienceFactInput,
} from './profile.js';

interface CompletenessInput {
  basics: BasicFactInput;
  workExperiences: WorkExperienceFactInput[];
  projects: ProjectExperienceFactInput[];
  skills: SkillFactInput[];
  languages: LanguageFactInput[];
  preferences: JobPreferencesFactInput;
}

const CHECKS = [
  ['display_name', 'Add and confirm your display name'],
  ['current_location', 'Add and confirm your current location'],
  ['summary', 'Add and confirm a short professional summary'],
  ['experience', 'Confirm at least one work or project experience'],
  ['skills', 'Confirm at least one skill'],
  ['languages', 'Confirm at least one language'],
  ['target_roles', 'Choose at least one target role'],
  ['target_locations', 'Choose at least one target location'],
  ['work_modes', 'Choose onsite, hybrid, or remote preferences'],
  ['work_authorization', 'Confirm your work authorization status'],
] as const;

export function computeProfileCompleteness(input: CompletenessInput): {
  score: number;
  completed: number;
  total: number;
  missing: Array<{ code: string; label: string }>;
} {
  const basicsConfirmed = input.basics.confirmationStatus === 'confirmed';
  const preferencesConfirmed = input.preferences.confirmationStatus === 'confirmed';
  const confirmedWork = input.workExperiences.some(
    (fact) => fact.confirmationStatus === 'confirmed',
  );
  const confirmedProjects = input.projects.some(
    (fact) => fact.confirmationStatus === 'confirmed',
  );

  const values: Record<(typeof CHECKS)[number][0], boolean> = {
    display_name: basicsConfirmed && input.basics.data.displayName.length > 0,
    current_location:
      basicsConfirmed && Boolean(input.basics.data.currentLocation?.length),
    summary: basicsConfirmed && Boolean(input.basics.data.summary?.length),
    experience: confirmedWork || confirmedProjects,
    skills: input.skills.some((fact) => fact.confirmationStatus === 'confirmed'),
    languages: input.languages.some((fact) => fact.confirmationStatus === 'confirmed'),
    target_roles: preferencesConfirmed && input.preferences.data.targetRoles.length > 0,
    target_locations:
      preferencesConfirmed && input.preferences.data.targetLocations.length > 0,
    work_modes: preferencesConfirmed && input.preferences.data.workModes.length > 0,
    work_authorization:
      preferencesConfirmed &&
      input.preferences.data.workAuthorization.status !== 'unknown',
  };

  const missing = CHECKS.filter(([code]) => !values[code]).map(([code, label]) => ({
    code,
    label,
  }));
  const total = CHECKS.length;
  const completed = total - missing.length;

  return {
    score: Math.round((completed / total) * 100),
    completed,
    total,
    missing,
  };
}
