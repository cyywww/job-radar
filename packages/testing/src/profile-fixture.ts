export function createFictionalProfileInput() {
  const sourceId = '10000000-0000-4000-8000-000000000001';

  return {
    changeSummary: 'Created complete fictional profile fixture',
    sources: [{ id: sourceId, type: 'user_input', label: 'Fictional test fixture' }],
    basics: {
      id: '20000000-0000-4000-8000-000000000001',
      sourceId,
      confirmationStatus: 'confirmed',
      data: {
        displayName: 'Robin North',
        headline: 'Product engineer for imaginary services',
        currentLocation: 'Stockholm, Sweden',
        summary: 'Fictional engineer building accessible local-first products.',
      },
    },
    workExperiences: [
      {
        id: '20000000-0000-4000-8000-000000000002',
        sourceId,
        confirmationStatus: 'confirmed',
        data: {
          organization: 'Northstar Fiction Labs AB',
          title: 'Product Engineer',
          location: 'Stockholm, Sweden',
          startDate: '2022-03',
          current: true,
          summary: 'Built fictional internal tools for made-up customers.',
        },
      },
    ],
    educationExperiences: [
      {
        id: '20000000-0000-4000-8000-000000000003',
        sourceId,
        confirmationStatus: 'confirmed',
        data: {
          institution: 'Example Institute of Technology',
          degree: 'Bachelor of Science',
          fieldOfStudy: 'Software Systems',
          startDate: '2017-08',
          endDate: '2020-06',
        },
      },
    ],
    skills: [
      {
        id: '20000000-0000-4000-8000-000000000004',
        sourceId,
        confirmationStatus: 'confirmed',
        data: { name: 'TypeScript', level: 'advanced', yearsExperience: 5 },
      },
    ],
    languages: [
      {
        id: '20000000-0000-4000-8000-000000000005',
        sourceId,
        confirmationStatus: 'confirmed',
        data: { name: 'English', proficiency: 'fluent' },
      },
    ],
    certifications: [
      {
        id: '20000000-0000-4000-8000-000000000006',
        sourceId,
        confirmationStatus: 'confirmed',
        data: {
          name: 'Fictional Cloud Foundations',
          issuer: 'Example Certification Board',
          issueDate: '2024-05',
          credentialId: 'FICTION-ONLY-001',
        },
      },
    ],
    projects: [
      {
        id: '20000000-0000-4000-8000-000000000007',
        sourceId,
        confirmationStatus: 'confirmed',
        data: {
          name: 'Atlas Sandbox',
          role: 'Maintainer',
          startDate: '2023-01',
          endDate: '2024-04',
          description: 'A fictional offline catalogue used only in tests.',
          technologies: ['React', 'SQLite'],
        },
      },
    ],
    preferences: {
      id: '20000000-0000-4000-8000-000000000008',
      sourceId,
      confirmationStatus: 'confirmed',
      data: {
        targetRoles: ['Product Engineer', 'Frontend Engineer'],
        targetLocations: ['Stockholm', 'Remote within Sweden'],
        workModes: ['hybrid', 'remote'],
        maxCommuteMinutes: 45,
        minimumSalary: 720_000,
        salaryCurrency: 'SEK',
        salaryPeriod: 'year',
        workAuthorization: {
          countries: ['Sweden'],
          status: 'work_permit',
          needsSponsorship: false,
        },
        preferredIndustries: ['Developer tools'],
        preferredCompanySizes: ['small', 'mid_size'],
        mustHaves: ['Accessible product culture'],
        exclusions: ['Unpaid roles', 'Full-time office attendance'],
      },
    },
  };
}
