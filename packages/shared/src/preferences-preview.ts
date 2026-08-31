import {
  preferencesPreviewResponseSchema,
  type PreferencesPreviewRequest,
  type PreferencesPreviewResponse,
} from './profile.js';

export function previewPreferences(
  input: PreferencesPreviewRequest,
): PreferencesPreviewResponse {
  const preferences = input.preferences;
  const warnings: string[] = [];

  if (input.confirmationStatus !== 'confirmed') {
    warnings.push('Preferences must be confirmed before they can constrain a search.');
  }
  if (preferences.targetRoles.length === 0) warnings.push('Add a target role.');
  if (preferences.targetLocations.length === 0) warnings.push('Add a target location.');
  if (preferences.workModes.length === 0) warnings.push('Choose a work mode.');
  if (preferences.workAuthorization.status === 'unknown') {
    warnings.push('Confirm your work authorization status.');
  }

  const hardConstraints = [
    ...preferences.mustHaves.map((value) => `Must have: ${value}`),
    ...(preferences.maxCommuteMinutes === null
      ? []
      : [`Maximum commute: ${preferences.maxCommuteMinutes} minutes`]),
    ...(preferences.minimumSalary === null ||
    preferences.salaryCurrency === null ||
    preferences.salaryPeriod === null
      ? []
      : [
          `Minimum salary: ${preferences.minimumSalary} ${preferences.salaryCurrency}/${preferences.salaryPeriod}`,
        ]),
    ...(preferences.workAuthorization.status === 'unknown'
      ? []
      : [`Work authorization: ${preferences.workAuthorization.status}`]),
    ...(preferences.workAuthorization.needsSponsorship
      ? ['Requires visa sponsorship']
      : []),
  ];

  return preferencesPreviewResponseSchema.parse({
    ready: warnings.length === 0,
    searchTerms: [
      ...new Set([
        ...preferences.targetRoles,
        ...preferences.targetLocations,
        ...preferences.preferredIndustries,
      ]),
    ],
    hardConstraints,
    exclusions: preferences.exclusions,
    warnings,
  });
}
