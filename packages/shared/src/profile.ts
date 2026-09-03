import { z } from 'zod';

export const confirmationStatusSchema = z.enum(['pending', 'confirmed', 'rejected']);
export const profileVersionStatusSchema = z.enum(['draft', 'confirmed']);
export const evidenceSourceTypeSchema = z.enum([
  'user_input',
  'pasted_text',
  'file_upload',
  'deterministic_stub',
]);

const shortText = z.string().trim().max(200);
const optionalShortText = shortText.optional();
const yearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const evidenceSourceInputSchema = z
  .object({
    id: z.string().uuid(),
    type: evidenceSourceTypeSchema,
    label: z.string().trim().min(1).max(120),
    originalFilename: z.string().trim().min(1).max(120).optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

export const evidenceSourceSchema = evidenceSourceInputSchema.extend({
  createdAt: z.string().datetime({ offset: true }),
});

const factInputBaseShape = {
  id: z.string().uuid().optional(),
  sourceId: z.string().uuid(),
  confirmationStatus: confirmationStatusSchema,
  evidenceExcerpt: z.string().trim().max(500).optional(),
};

const factOutputBaseShape = {
  id: z.string().uuid(),
  evidenceId: z.string().uuid(),
  sourceId: z.string().uuid(),
  confirmationStatus: confirmationStatusSchema,
  evidenceExcerpt: z.string().trim().max(500).optional(),
  updatedAt: z.string().datetime({ offset: true }),
};

export const profileBasicsDataSchema = z
  .object({
    displayName: z.string().trim().max(100).default(''),
    headline: optionalShortText,
    currentLocation: optionalShortText,
    summary: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const workExperienceDataSchema = z
  .object({
    organization: z.string().trim().min(1).max(160),
    title: z.string().trim().min(1).max(160),
    location: optionalShortText,
    startDate: yearMonthSchema,
    endDate: yearMonthSchema.nullable().optional(),
    current: z.boolean().default(false),
    summary: z.string().trim().max(1_500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.current && value.endDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Current roles cannot have an end date',
      });
    }
    if (value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must not precede start date',
      });
    }
  });

export const educationExperienceDataSchema = z
  .object({
    institution: z.string().trim().min(1).max(160),
    degree: z.string().trim().min(1).max(160),
    fieldOfStudy: optionalShortText,
    startDate: yearMonthSchema.optional(),
    endDate: yearMonthSchema.optional(),
    summary: z.string().trim().max(1_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must not precede start date',
      });
    }
  });

export const skillDataSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    level: z.enum(['foundational', 'working', 'advanced', 'expert']),
    yearsExperience: z.number().min(0).max(80).optional(),
  })
  .strict();

export const languageDataSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    proficiency: z.enum(['basic', 'conversational', 'professional', 'fluent', 'native']),
  })
  .strict();

export const certificationDataSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    issuer: z.string().trim().min(1).max(160),
    issueDate: yearMonthSchema.optional(),
    expiresAt: yearMonthSchema.optional(),
    credentialId: optionalShortText,
  })
  .strict();

export const projectExperienceDataSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    role: optionalShortText,
    startDate: yearMonthSchema.optional(),
    endDate: yearMonthSchema.optional(),
    description: z.string().trim().min(1).max(1_500),
    technologies: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must not precede start date',
      });
    }
  });

export const workAuthorizationSchema = z
  .object({
    countries: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    securityClearances: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
    status: z.enum([
      'citizen',
      'permanent_resident',
      'work_permit',
      'needs_sponsorship',
      'unknown',
    ]),
    needsSponsorship: z.boolean(),
  })
  .strict();

export const jobPreferencesDataSchema = z
  .object({
    targetRoles: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    targetLocations: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    workModes: z
      .array(z.enum(['onsite', 'hybrid', 'remote']))
      .max(3)
      .default([]),
    maxCommuteMinutes: z.number().int().min(0).max(300).nullable().default(null),
    minimumSalary: z.number().int().positive().nullable().default(null),
    salaryCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .default(null),
    salaryPeriod: z.enum(['hour', 'month', 'year']).nullable().default(null),
    workAuthorization: workAuthorizationSchema,
    preferredIndustries: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    targetCompanies: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
    excludedCompanies: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
    excludedRoleTypes: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
    preferredCompanySizes: z
      .array(z.enum(['startup', 'small', 'mid_size', 'large', 'enterprise']))
      .max(5)
      .default([]),
    mustHaves: z.array(z.string().trim().min(1).max(240)).max(50).default([]),
    exclusions: z.array(z.string().trim().min(1).max(240)).max(50).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const salaryFields = [value.minimumSalary, value.salaryCurrency, value.salaryPeriod];
    const configuredSalaryFields = salaryFields.filter((field) => field !== null);
    if (configuredSalaryFields.length > 0 && configuredSalaryFields.length < 3) {
      context.addIssue({
        code: 'custom',
        path: ['minimumSalary'],
        message: 'Salary amount, currency, and period must be set together',
      });
    }
  });

export const basicFactInputSchema = z
  .object({ ...factInputBaseShape, data: profileBasicsDataSchema })
  .strict();
export const workExperienceFactInputSchema = z
  .object({ ...factInputBaseShape, data: workExperienceDataSchema })
  .strict();
export const educationExperienceFactInputSchema = z
  .object({ ...factInputBaseShape, data: educationExperienceDataSchema })
  .strict();
export const skillFactInputSchema = z
  .object({ ...factInputBaseShape, data: skillDataSchema })
  .strict();
export const languageFactInputSchema = z
  .object({ ...factInputBaseShape, data: languageDataSchema })
  .strict();
export const certificationFactInputSchema = z
  .object({ ...factInputBaseShape, data: certificationDataSchema })
  .strict();
export const projectExperienceFactInputSchema = z
  .object({ ...factInputBaseShape, data: projectExperienceDataSchema })
  .strict();
export const jobPreferencesFactInputSchema = z
  .object({ ...factInputBaseShape, data: jobPreferencesDataSchema })
  .strict();

export const basicFactSchema = z
  .object({ ...factOutputBaseShape, data: profileBasicsDataSchema })
  .strict();
export const workExperienceFactSchema = z
  .object({ ...factOutputBaseShape, data: workExperienceDataSchema })
  .strict();
export const educationExperienceFactSchema = z
  .object({ ...factOutputBaseShape, data: educationExperienceDataSchema })
  .strict();
export const skillFactSchema = z
  .object({ ...factOutputBaseShape, data: skillDataSchema })
  .strict();
export const languageFactSchema = z
  .object({ ...factOutputBaseShape, data: languageDataSchema })
  .strict();
export const certificationFactSchema = z
  .object({ ...factOutputBaseShape, data: certificationDataSchema })
  .strict();
export const projectExperienceFactSchema = z
  .object({ ...factOutputBaseShape, data: projectExperienceDataSchema })
  .strict();
export const jobPreferencesFactSchema = z
  .object({ ...factOutputBaseShape, data: jobPreferencesDataSchema })
  .strict();

const profileContentShape = {
  sources: z.array(evidenceSourceInputSchema).min(1).max(200),
  basics: basicFactInputSchema,
  workExperiences: z.array(workExperienceFactInputSchema).max(100).default([]),
  educationExperiences: z.array(educationExperienceFactInputSchema).max(100).default([]),
  skills: z.array(skillFactInputSchema).max(200).default([]),
  languages: z.array(languageFactInputSchema).max(100).default([]),
  certifications: z.array(certificationFactInputSchema).max(100).default([]),
  projects: z.array(projectExperienceFactInputSchema).max(100).default([]),
  preferences: jobPreferencesFactInputSchema,
};

type ProfileContentForValidation = {
  sources: Array<{ id: string }>;
  basics: { id?: string | undefined; sourceId: string };
  workExperiences: Array<{ id?: string | undefined; sourceId: string }>;
  educationExperiences: Array<{ id?: string | undefined; sourceId: string }>;
  skills: Array<{ id?: string | undefined; sourceId: string }>;
  languages: Array<{ id?: string | undefined; sourceId: string }>;
  certifications: Array<{ id?: string | undefined; sourceId: string }>;
  projects: Array<{ id?: string | undefined; sourceId: string }>;
  preferences: { id?: string | undefined; sourceId: string };
};

function validateProfileContent(
  value: ProfileContentForValidation,
  context: z.RefinementCtx,
): void {
  const sourceIds = new Set(value.sources.map((source) => source.id));
  if (sourceIds.size !== value.sources.length) {
    context.addIssue({
      code: 'custom',
      path: ['sources'],
      message: 'Evidence source IDs must be unique',
    });
  }

  const facts = [
    value.basics,
    ...value.workExperiences,
    ...value.educationExperiences,
    ...value.skills,
    ...value.languages,
    ...value.certifications,
    ...value.projects,
    value.preferences,
  ];
  const factIds = facts.flatMap((fact) => (fact.id ? [fact.id] : []));
  if (new Set(factIds).size !== factIds.length) {
    context.addIssue({
      code: 'custom',
      path: [],
      message: 'Fact IDs must be unique within a profile version',
    });
  }

  for (const fact of facts) {
    if (!sourceIds.has(fact.sourceId)) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: `Fact references unknown evidence source ${fact.sourceId}`,
      });
    }
  }
}

export const createProfileRequestSchema = z
  .object({
    ...profileContentShape,
    changeSummary: z.string().trim().min(1).max(240).default('Created profile'),
  })
  .strict()
  .superRefine(validateProfileContent);

export const updateProfileRequestSchema = z
  .object({
    ...profileContentShape,
    baseVersion: z.number().int().positive(),
    changeSummary: z.string().trim().min(1).max(240).default('Updated profile'),
  })
  .strict()
  .superRefine(validateProfileContent);

export const confirmProfileRequestSchema = z
  .object({
    baseVersion: z.number().int().positive(),
    factIds: z.array(z.string().uuid()).max(500).default([]),
    confirmAllPending: z.boolean().default(false),
    changeSummary: z.string().trim().min(1).max(240).default('Confirmed profile facts'),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.confirmAllPending && value.factIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['factIds'],
        message: 'Select facts or request confirmation of all pending facts',
      });
    }
  });

export const profileCompletenessItemSchema = z
  .object({
    code: z.string().min(1),
    label: z.string().min(1),
  })
  .strict();

export const profileCompletenessSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    completed: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    missing: z.array(profileCompletenessItemSchema),
  })
  .strict();

export const profileSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    status: profileVersionStatusSchema,
    changeSummary: z.string().min(1),
    sources: z.array(evidenceSourceSchema),
    basics: basicFactSchema,
    workExperiences: z.array(workExperienceFactSchema),
    educationExperiences: z.array(educationExperienceFactSchema),
    skills: z.array(skillFactSchema),
    languages: z.array(languageFactSchema),
    certifications: z.array(certificationFactSchema),
    projects: z.array(projectExperienceFactSchema),
    preferences: jobPreferencesFactSchema,
    completeness: profileCompletenessSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const profileVersionSummarySchema = z
  .object({
    versionId: z.string().uuid(),
    version: z.number().int().positive(),
    status: profileVersionStatusSchema,
    changeSummary: z.string().min(1),
    confirmedFactCount: z.number().int().nonnegative(),
    pendingFactCount: z.number().int().nonnegative(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const profileVersionsResponseSchema = z
  .object({ versions: z.array(profileVersionSummarySchema) })
  .strict();

export const profileNameSchema = z.string().trim().min(1).max(80);

export const profileSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: profileNameSchema,
    isActive: z.boolean(),
    version: z.number().int().positive(),
    status: profileVersionStatusSchema,
    headline: z.string().nullable(),
    targetRoles: z.array(z.string()),
    completeness: profileCompletenessSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const profilesResponseSchema = z
  .object({ profiles: z.array(profileSummarySchema) })
  .strict();

export const profileResourceSchema = z
  .object({ summary: profileSummarySchema, profile: profileSnapshotSchema })
  .strict();

export const createProfileResourceRequestSchema = z
  .object({ name: profileNameSchema, profile: createProfileRequestSchema })
  .strict();

export const updateProfileResourceRequestSchema = z
  .object({ name: profileNameSchema, profile: updateProfileRequestSchema })
  .strict();

export const deleteProfileResponseSchema = z
  .object({
    deletedId: z.string().uuid(),
    activeProfileId: z.string().uuid().nullable(),
  })
  .strict();

export const preferencesPreviewRequestSchema = z
  .object({
    preferences: jobPreferencesDataSchema,
    confirmationStatus: confirmationStatusSchema.default('confirmed'),
  })
  .strict();

export const preferencesPreviewResponseSchema = z
  .object({
    ready: z.boolean(),
    searchTerms: z.array(z.string()),
    hardConstraints: z.array(z.string()),
    exclusions: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict();

export const profileImportRequestSchema = z
  .object({
    sourceType: z.literal('pasted_text'),
    label: z.string().trim().min(1).max(120).default('Pasted profile text'),
    text: z.string().trim().min(1).max(100_000),
  })
  .strict();

export const profileExtractorSchema = z
  .object({
    provider: z.literal('deterministic_labeled_text_stub'),
    version: z.literal('stub-v1'),
    aiUsed: z.literal(false),
    capability: z.literal('basic_labeled_fields_only'),
  })
  .strict();

export const profileImportResponseSchema = z
  .object({
    extractor: profileExtractorSchema,
    draft: createProfileRequestSchema,
    warnings: z.array(z.string()),
  })
  .strict();

export const confirmedProfileViewSchema = z
  .object({
    profileId: z.string().uuid(),
    version: z.number().int().positive(),
    basics: basicFactSchema.nullable(),
    workExperiences: z.array(workExperienceFactSchema),
    educationExperiences: z.array(educationExperienceFactSchema),
    skills: z.array(skillFactSchema),
    languages: z.array(languageFactSchema),
    certifications: z.array(certificationFactSchema),
    projects: z.array(projectExperienceFactSchema),
    preferences: jobPreferencesFactSchema.nullable(),
  })
  .strict();

export type EvidenceSourceInput = z.infer<typeof evidenceSourceInputSchema>;
export type BasicFactInput = z.infer<typeof basicFactInputSchema>;
export type WorkExperienceFactInput = z.infer<typeof workExperienceFactInputSchema>;
export type SkillFactInput = z.infer<typeof skillFactInputSchema>;
export type LanguageFactInput = z.infer<typeof languageFactInputSchema>;
export type ProjectExperienceFactInput = z.infer<typeof projectExperienceFactInputSchema>;
export type JobPreferencesData = z.infer<typeof jobPreferencesDataSchema>;
export type JobPreferencesFactInput = z.infer<typeof jobPreferencesFactInputSchema>;
export type CreateProfileRequest = z.infer<typeof createProfileRequestSchema>;
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ConfirmProfileRequest = z.infer<typeof confirmProfileRequestSchema>;
export type PreferencesPreviewRequest = z.infer<typeof preferencesPreviewRequestSchema>;
export type PreferencesPreviewResponse = z.infer<typeof preferencesPreviewResponseSchema>;
export type ProfileImportResponse = z.infer<typeof profileImportResponseSchema>;
export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>;
export type ProfileVersionSummary = z.infer<typeof profileVersionSummarySchema>;
export type ProfileSummary = z.infer<typeof profileSummarySchema>;
export type ProfileResource = z.infer<typeof profileResourceSchema>;
export type ConfirmedProfileView = z.infer<typeof confirmedProfileViewSchema>;
