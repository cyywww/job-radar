import {
  jobExtractionSchema,
  type ConfirmedProfileView,
  type JobExtraction,
  type ScoringJobInput,
} from '@job-radar/shared';

export type AuditErrorCode =
  | 'schema_invalid'
  | 'extractor_version_mismatch'
  | 'evidence_reference_invalid'
  | 'requirement_reference_invalid'
  | 'jd_snippet_invalid'
  | 'missing_match'
  | 'missing_gap'
  | 'required_requirement_unexplained';

export class ScoringAuditError extends Error {
  public constructor(
    public readonly code: AuditErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ScoringAuditError';
  }
}

function confirmedEvidenceIds(profile: ConfirmedProfileView): Set<string> {
  return new Set(
    [
      ...(profile.basics ? [profile.basics] : []),
      ...profile.workExperiences,
      ...profile.educationExperiences,
      ...profile.skills,
      ...profile.languages,
      ...profile.certifications,
      ...profile.projects,
    ].map(({ evidenceId }) => evidenceId),
  );
}

function allRequirementIds(extraction: JobExtraction): Set<string> {
  return new Set(
    [
      ...extraction.requiredSkills,
      ...extraction.preferredSkills,
      ...extraction.responsibilities,
      ...extraction.languages,
      ...extraction.domain,
    ].map(({ id }) => id),
  );
}

function assertedSnippets(extraction: JobExtraction): string[] {
  return [
    ...extraction.requiredSkills.map(({ jdSnippet }) => jdSnippet),
    ...extraction.preferredSkills.map(({ jdSnippet }) => jdSnippet),
    ...extraction.responsibilities.map(({ jdSnippet }) => jdSnippet),
    ...extraction.languages.map(({ jdSnippet }) => jdSnippet),
    ...extraction.domain.map(({ jdSnippet }) => jdSnippet),
    ...extraction.matchedEvidence.map(({ jdSnippet }) => jdSnippet),
    extraction.workAuthorization.jdSnippet,
    extraction.education.jdSnippet,
    extraction.locationPolicy.jdSnippet,
    extraction.salary.jdSnippet,
    extraction.securityClearance.jdSnippet,
  ].filter((value): value is string => value !== null);
}

export interface ExtractionAuditInput {
  readonly raw: unknown;
  readonly profile: ConfirmedProfileView;
  readonly job: ScoringJobInput;
  readonly extractorVersion: string;
}

export function auditExtraction(input: ExtractionAuditInput): JobExtraction {
  const parsed = jobExtractionSchema.safeParse(input.raw);
  if (!parsed.success) {
    throw new ScoringAuditError(
      'schema_invalid',
      'AI output did not match the extraction schema.',
    );
  }
  const extraction = parsed.data;
  if (extraction.extractorVersion !== input.extractorVersion) {
    throw new ScoringAuditError(
      'extractor_version_mismatch',
      'AI output used an unexpected extractor version.',
    );
  }
  if (extraction.matchedEvidence.length === 0) {
    throw new ScoringAuditError(
      'missing_match',
      'AI output contains no evidence-backed match.',
    );
  }
  if (extraction.gaps.length === 0) {
    throw new ScoringAuditError(
      'missing_gap',
      'AI output contains no explicit gap assessment.',
    );
  }
  const evidenceIds = confirmedEvidenceIds(input.profile);
  const requirementIds = allRequirementIds(extraction);
  for (const match of extraction.matchedEvidence) {
    if (!evidenceIds.has(match.profileEvidenceId)) {
      throw new ScoringAuditError(
        'evidence_reference_invalid',
        'AI output references evidence outside the current confirmed Profile version.',
      );
    }
    if (!requirementIds.has(match.requirementId)) {
      throw new ScoringAuditError(
        'requirement_reference_invalid',
        'AI output references an unknown extracted requirement.',
      );
    }
  }
  for (const gap of extraction.gaps) {
    if (gap.requirementId !== null && !requirementIds.has(gap.requirementId)) {
      throw new ScoringAuditError(
        'requirement_reference_invalid',
        'AI output gap references an unknown extracted requirement.',
      );
    }
  }
  for (const snippet of assertedSnippets(extraction)) {
    if (!input.job.descriptionText.includes(snippet)) {
      throw new ScoringAuditError(
        'jd_snippet_invalid',
        'AI output contains a JD snippet that is not present in the current snapshot.',
      );
    }
  }
  const explained = new Set([
    ...extraction.matchedEvidence.map(({ requirementId }) => requirementId),
    ...extraction.gaps.flatMap(({ requirementId }) =>
      requirementId === null ? [] : [requirementId],
    ),
  ]);
  if (extraction.requiredSkills.some(({ id }) => !explained.has(id))) {
    throw new ScoringAuditError(
      'required_requirement_unexplained',
      'Every required skill must have either matched evidence or an explicit gap.',
    );
  }
  return extraction;
}
