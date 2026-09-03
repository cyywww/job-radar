import { useState } from 'react';

import type { CreateProfileRequest } from '@job-radar/shared';

import { ensureManualSource, newFactId } from './profile-draft.js';

type EditorProps = {
  draft: CreateProfileRequest;
  onChange: (draft: CreateProfileRequest) => void;
};

function splitList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function replaceAt<T>(items: T[], index: number, update: (item: T) => T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? update(item) : item));
}

function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_item, itemIndex) => itemIndex !== index);
}

type ListFieldProps = {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  help?: string;
  priority?: 'Required' | 'Recommended' | 'Optional';
  rows?: number;
};

function ListFieldInput({
  label,
  initialText,
  onChange,
  placeholder,
  help,
  priority,
  rows = 3,
}: Omit<ListFieldProps, 'value'> & {
  initialText: string;
}): React.JSX.Element {
  const [text, setText] = useState(initialText);

  return (
    <label>
      <span className="field-label">
        {label}
        {priority && <small>{priority}</small>}
      </span>
      {help && <span className="field-help">{help}</span>}
      <textarea
        aria-label={label}
        rows={rows}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onChange(splitList(text))}
      />
    </label>
  );
}

function ListField(props: ListFieldProps): React.JSX.Element {
  const initialText = props.value.join('\n');
  return <ListFieldInput key={initialText} {...props} initialText={initialText} />;
}

function SectionHeading({
  id,
  step,
  title,
  description,
  state,
}: {
  id: string;
  step: string;
  title: string;
  description: string;
  state?: 'pending' | 'confirmed' | 'rejected';
}): React.JSX.Element {
  return (
    <div className="section-title section-title--profile">
      <div>
        <span>{step}</span>
        <div>
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {state && <span className={`fact-state fact-state--${state}`}>{state}</span>}
    </div>
  );
}

function EmptyHint({ children }: { children: string }): React.JSX.Element {
  return <p className="empty-hint">{children}</p>;
}

function updateSkillNames(
  draft: CreateProfileRequest,
  onChange: EditorProps['onChange'],
  names: string[],
): void {
  const unchanged =
    names.length === draft.skills.length &&
    names.every((name, index) => name === draft.skills[index]?.data.name);
  if (unchanged) return;

  const manual = ensureManualSource(draft);
  const existing = new Map(
    draft.skills.map((fact) => [fact.data.name.toLocaleLowerCase(), fact]),
  );
  onChange({
    ...manual.draft,
    skills: names.map((name) => {
      const fact = existing.get(name.toLocaleLowerCase());
      return fact
        ? { ...fact, data: { ...fact.data, name } }
        : {
            id: newFactId(),
            sourceId: manual.sourceId,
            confirmationStatus: 'confirmed' as const,
            evidenceExcerpt: 'Entered directly in Job Radar',
            data: { name, level: 'working' as const },
          };
    }),
  });
}

function SearchSection({ draft, onChange }: EditorProps): React.JSX.Element {
  const preferences = draft.preferences.data;

  return (
    <section
      className="editor-section editor-section--essential"
      aria-labelledby="search-profile-heading"
    >
      <SectionHeading
        id="search-profile-heading"
        step="Start here"
        title="What are you looking for?"
        description="A target role is enough to begin. Everything else can be added later."
        state={draft.preferences.confirmationStatus}
      />
      <div className="form-grid form-grid--two">
        <ListField
          label="Target roles"
          value={preferences.targetRoles}
          placeholder={'Backend Engineer\nData Engineer'}
          help="Use titles you would genuinely apply for, one per line."
          priority="Required"
          onChange={(targetRoles) =>
            onChange({
              ...draft,
              preferences: {
                ...draft.preferences,
                data: { ...preferences, targetRoles },
              },
            })
          }
        />
        <ListField
          label="Target locations"
          value={preferences.targetLocations}
          placeholder={'Stockholm\nRemote within Sweden'}
          help="Optional cities, regions, or remote boundary."
          priority="Optional"
          onChange={(targetLocations) =>
            onChange({
              ...draft,
              preferences: {
                ...draft.preferences,
                data: { ...preferences, targetLocations },
              },
            })
          }
        />
        <ListField
          label="Core skills"
          value={draft.skills.map((fact) => fact.data.name)}
          placeholder={'Python\nPostgreSQL\nDocker'}
          help="Add only skills you have actually used, one per line."
          priority="Recommended"
          onChange={(names) => updateSkillNames(draft, onChange, names)}
        />
      </div>
    </section>
  );
}

function EligibilitySection({ draft, onChange }: EditorProps): React.JSX.Element {
  const preferences = draft.preferences.data;

  return (
    <section className="editor-section" aria-labelledby="eligibility-profile-heading">
      <SectionHeading
        id="eligibility-profile-heading"
        step="03"
        title="Eligibility and work mode"
        description="Optional. Add these only when you want Job Radar to decide location, remote, or work-permit Gates."
      />
      <div className="form-grid form-grid--two">
        <fieldset className="choice-group form-grid__wide">
          <legend>Work mode</legend>
          {(['onsite', 'hybrid', 'remote'] as const).map((mode) => (
            <label key={mode}>
              <input
                type="checkbox"
                checked={preferences.workModes.includes(mode)}
                onChange={(event) => {
                  const workModes = event.target.checked
                    ? [...preferences.workModes, mode]
                    : preferences.workModes.filter((item) => item !== mode);
                  onChange({
                    ...draft,
                    preferences: {
                      ...draft.preferences,
                      data: { ...preferences, workModes },
                    },
                  });
                }}
              />
              {mode}
            </label>
          ))}
        </fieldset>
        <label>
          <span className="field-label">Work authorization</span>
          <span className="field-help">Used only for eligibility checks.</span>
          <select
            aria-label="Work authorization status"
            value={preferences.workAuthorization.status}
            onChange={(event) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: {
                    ...preferences,
                    workAuthorization: {
                      ...preferences.workAuthorization,
                      status: event.target
                        .value as typeof preferences.workAuthorization.status,
                    },
                  },
                },
              })
            }
          >
            <option value="unknown">Not specified</option>
            <option value="citizen">Citizen</option>
            <option value="permanent_resident">Permanent resident</option>
            <option value="work_permit">Work permit</option>
            <option value="needs_sponsorship">Needs sponsorship</option>
          </select>
        </label>
        <ListField
          label="Authorized countries"
          value={preferences.workAuthorization.countries}
          placeholder="Sweden"
          help="Countries where you can currently work."
          rows={2}
          onChange={(countries) =>
            onChange({
              ...draft,
              preferences: {
                ...draft.preferences,
                data: {
                  ...preferences,
                  workAuthorization: { ...preferences.workAuthorization, countries },
                },
              },
            })
          }
        />
        <label className="checkbox-field form-grid__wide">
          <input
            type="checkbox"
            checked={preferences.workAuthorization.needsSponsorship}
            onChange={(event) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: {
                    ...preferences,
                    workAuthorization: {
                      ...preferences.workAuthorization,
                      needsSponsorship: event.target.checked,
                    },
                  },
                },
              })
            }
          />
          I need employer sponsorship for my target jobs
        </label>
      </div>
    </section>
  );
}

function FitSection({ draft, onChange }: EditorProps): React.JSX.Element {
  const addLanguage = () => {
    const manual = ensureManualSource(draft);
    onChange({
      ...manual.draft,
      languages: [
        ...manual.draft.languages,
        {
          id: newFactId(),
          sourceId: manual.sourceId,
          confirmationStatus: 'confirmed',
          evidenceExcerpt: 'Entered directly in Job Radar',
          data: { name: '', proficiency: 'professional' },
        },
      ],
    });
  };

  return (
    <section className="editor-section" aria-labelledby="candidate-profile-heading">
      <SectionHeading
        id="candidate-profile-heading"
        step="02"
        title="Personal and language details"
        description="Optional context and language facts for more precise explanations."
        state={draft.basics.confirmationStatus}
      />
      <div className="form-grid form-grid--two">
        <label>
          <span className="field-label">
            Display name <small>Optional</small>
          </span>
          <input
            aria-label="Display name"
            value={draft.basics.data.displayName}
            maxLength={100}
            placeholder="Your name"
            onChange={(event) =>
              onChange({
                ...draft,
                basics: {
                  ...draft.basics,
                  data: { ...draft.basics.data, displayName: event.target.value },
                },
              })
            }
          />
        </label>
        <label>
          <span className="field-label">Current location</span>
          <input
            aria-label="Current location"
            value={draft.basics.data.currentLocation ?? ''}
            maxLength={200}
            placeholder="City, country"
            onChange={(event) =>
              onChange({
                ...draft,
                basics: {
                  ...draft.basics,
                  data: {
                    ...draft.basics.data,
                    currentLocation: event.target.value || undefined,
                  },
                },
              })
            }
          />
        </label>
        <label className="form-grid__wide">
          <span className="field-label">
            Professional headline <small>Optional</small>
          </span>
          <input
            aria-label="Professional headline"
            value={draft.basics.data.headline ?? ''}
            maxLength={200}
            placeholder="Backend engineer building reliable data products"
            onChange={(event) =>
              onChange({
                ...draft,
                basics: {
                  ...draft.basics,
                  data: {
                    ...draft.basics.data,
                    headline: event.target.value || undefined,
                  },
                },
              })
            }
          />
        </label>
        <label className="form-grid__wide">
          <span className="field-label">
            Professional summary <small>Recommended</small>
          </span>
          <span className="field-help">
            3–5 lines: experience level, strongest work, and the problems you solve.
          </span>
          <textarea
            aria-label="Professional summary"
            rows={4}
            value={draft.basics.data.summary ?? ''}
            maxLength={2_000}
            placeholder="I build… My strongest evidence is… I am looking for…"
            onChange={(event) =>
              onChange({
                ...draft,
                basics: {
                  ...draft.basics,
                  data: {
                    ...draft.basics.data,
                    summary: event.target.value || undefined,
                  },
                },
              })
            }
          />
        </label>
        <div className="compact-editor form-grid__wide">
          <div className="compact-editor__heading">
            <div>
              <span className="field-label">Languages</span>
              <span className="field-help">Language gates use these levels.</span>
            </div>
            <button className="text-button" type="button" onClick={addLanguage}>
              + Add language
            </button>
          </div>
          {draft.languages.length === 0 && (
            <EmptyHint>Add at least one language.</EmptyHint>
          )}
          {draft.languages.map((fact, index) => (
            <div className="inline-row" key={fact.id ?? index}>
              <input
                aria-label={`Language ${index + 1}`}
                value={fact.data.name}
                placeholder="English"
                onChange={(event) =>
                  onChange({
                    ...draft,
                    languages: replaceAt(draft.languages, index, (item) => ({
                      ...item,
                      data: { ...item.data, name: event.target.value },
                    })),
                  })
                }
              />
              <select
                aria-label={`Language ${index + 1} proficiency`}
                value={fact.data.proficiency}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    languages: replaceAt(draft.languages, index, (item) => ({
                      ...item,
                      data: {
                        ...item.data,
                        proficiency: event.target.value as typeof fact.data.proficiency,
                      },
                    })),
                  })
                }
              >
                <option value="basic">Basic</option>
                <option value="conversational">Conversational</option>
                <option value="professional">Professional</option>
                <option value="fluent">Fluent</option>
                <option value="native">Native</option>
              </select>
              <button
                className="icon-button icon-button--danger"
                type="button"
                aria-label={`Remove language ${index + 1}`}
                onClick={() =>
                  onChange({ ...draft, languages: removeAt(draft.languages, index) })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {draft.skills.length > 0 && (
        <details className="profile-disclosure profile-disclosure--nested">
          <summary>
            <span>Skill levels</span>
            <small>Optional years and proficiency</small>
          </summary>
          <div className="detail-body compact-list">
            {draft.skills.map((fact, index) => (
              <div className="inline-row inline-row--skill" key={fact.id ?? index}>
                <strong>{fact.data.name}</strong>
                <select
                  aria-label={`${fact.data.name} level`}
                  value={fact.data.level}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      skills: replaceAt(draft.skills, index, (item) => ({
                        ...item,
                        data: {
                          ...item.data,
                          level: event.target.value as typeof fact.data.level,
                        },
                      })),
                    })
                  }
                >
                  <option value="foundational">Foundational</option>
                  <option value="working">Working</option>
                  <option value="advanced">Advanced</option>
                  <option value="expert">Expert</option>
                </select>
                <input
                  aria-label={`${fact.data.name} years`}
                  type="number"
                  min={0}
                  max={80}
                  placeholder="Years"
                  value={fact.data.yearsExperience ?? ''}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      skills: replaceAt(draft.skills, index, (item) => ({
                        ...item,
                        data: {
                          ...item.data,
                          yearsExperience: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        },
                      })),
                    })
                  }
                />
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function EvidenceSection({ draft, onChange }: EditorProps): React.JSX.Element {
  const addWork = () => {
    const manual = ensureManualSource(draft);
    onChange({
      ...manual.draft,
      workExperiences: [
        ...manual.draft.workExperiences,
        {
          id: newFactId(),
          sourceId: manual.sourceId,
          confirmationStatus: 'confirmed',
          evidenceExcerpt: 'Entered directly in Job Radar',
          data: {
            organization: '',
            title: '',
            startDate: new Date().toISOString().slice(0, 7),
            current: true,
          },
        },
      ],
    });
  };

  return (
    <section className="editor-section" aria-labelledby="experience-profile-heading">
      <SectionHeading
        id="experience-profile-heading"
        step="04"
        title="Work evidence"
        description="Optional. Concrete outcomes improve evidence depth and scoring explanations."
      />
      {draft.workExperiences.length === 0 && (
        <EmptyHint>
          Add one recent role, or add a project under Optional evidence.
        </EmptyHint>
      )}
      {draft.workExperiences.map((fact, index) => (
        <article className="repeat-card" key={fact.id ?? index}>
          <div className="repeat-card__heading">
            <strong>{fact.data.title || `Work experience ${index + 1}`}</strong>
            <span className={`fact-state fact-state--${fact.confirmationStatus}`}>
              {fact.confirmationStatus}
            </span>
          </div>
          <div className="form-grid form-grid--two">
            <label>
              Organization
              <input
                value={fact.data.organization}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    workExperiences: replaceAt(draft.workExperiences, index, (item) => ({
                      ...item,
                      data: { ...item.data, organization: event.target.value },
                    })),
                  })
                }
              />
            </label>
            <label>
              Role title
              <input
                value={fact.data.title}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    workExperiences: replaceAt(draft.workExperiences, index, (item) => ({
                      ...item,
                      data: { ...item.data, title: event.target.value },
                    })),
                  })
                }
              />
            </label>
            <label>
              Start month
              <input
                type="month"
                value={fact.data.startDate}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    workExperiences: replaceAt(draft.workExperiences, index, (item) => ({
                      ...item,
                      data: { ...item.data, startDate: event.target.value },
                    })),
                  })
                }
              />
            </label>
            <label>
              End month
              <input
                type="month"
                disabled={fact.data.current}
                value={fact.data.endDate ?? ''}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    workExperiences: replaceAt(draft.workExperiences, index, (item) => ({
                      ...item,
                      data: { ...item.data, endDate: event.target.value || null },
                    })),
                  })
                }
              />
            </label>
            <label className="checkbox-field form-grid__wide">
              <input
                type="checkbox"
                checked={fact.data.current}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    workExperiences: replaceAt(draft.workExperiences, index, (item) => ({
                      ...item,
                      data: {
                        ...item.data,
                        current: event.target.checked,
                        ...(event.target.checked ? { endDate: null } : {}),
                      },
                    })),
                  })
                }
              />
              Current role
            </label>
            <label className="form-grid__wide">
              Outcomes and responsibilities
              <span className="field-help">
                Mention scale, ownership, tools, and outcomes.
              </span>
              <textarea
                rows={4}
                value={fact.data.summary ?? ''}
                placeholder="Built… Improved… Led…"
                onChange={(event) =>
                  onChange({
                    ...draft,
                    workExperiences: replaceAt(draft.workExperiences, index, (item) => ({
                      ...item,
                      data: { ...item.data, summary: event.target.value || undefined },
                    })),
                  })
                }
              />
            </label>
          </div>
          <button
            className="text-button text-button--danger"
            type="button"
            onClick={() =>
              onChange({
                ...draft,
                workExperiences: removeAt(draft.workExperiences, index),
              })
            }
          >
            Remove experience
          </button>
        </article>
      ))}
      <button className="button button--add" type="button" onClick={addWork}>
        + Add work experience
      </button>
    </section>
  );
}

function OptionalFilters({ draft, onChange }: EditorProps): React.JSX.Element {
  const preferences = draft.preferences.data;

  return (
    <details className="profile-disclosure profile-disclosure--section">
      <summary>
        <span>Optional search filters</span>
        <small>Commute, salary, industries, company size and exclusions</small>
      </summary>
      <div className="detail-body form-grid form-grid--two">
        <label>
          Maximum commute (minutes)
          <input
            type="number"
            min={0}
            max={300}
            value={preferences.maxCommuteMinutes ?? ''}
            onChange={(event) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: {
                    ...preferences,
                    maxCommuteMinutes: event.target.value
                      ? Number(event.target.value)
                      : null,
                  },
                },
              })
            }
          />
        </label>
        <ListField
          label="Preferred industries"
          value={preferences.preferredIndustries}
          placeholder="Developer tools"
          rows={2}
          onChange={(preferredIndustries) =>
            onChange({
              ...draft,
              preferences: {
                ...draft.preferences,
                data: { ...preferences, preferredIndustries },
              },
            })
          }
        />
        <div className="salary-fields form-grid__wide">
          <label>
            Minimum salary
            <input
              type="number"
              min={1}
              value={preferences.minimumSalary ?? ''}
              onChange={(event) =>
                onChange({
                  ...draft,
                  preferences: {
                    ...draft.preferences,
                    data: {
                      ...preferences,
                      minimumSalary: event.target.value
                        ? Number(event.target.value)
                        : null,
                    },
                  },
                })
              }
            />
          </label>
          <label>
            Currency
            <input
              value={preferences.salaryCurrency ?? ''}
              maxLength={3}
              placeholder="SEK"
              onChange={(event) =>
                onChange({
                  ...draft,
                  preferences: {
                    ...draft.preferences,
                    data: {
                      ...preferences,
                      salaryCurrency: event.target.value
                        ? event.target.value.toUpperCase()
                        : null,
                    },
                  },
                })
              }
            />
          </label>
          <label>
            Period
            <select
              value={preferences.salaryPeriod ?? ''}
              onChange={(event) =>
                onChange({
                  ...draft,
                  preferences: {
                    ...draft.preferences,
                    data: {
                      ...preferences,
                      salaryPeriod: (event.target.value || null) as
                        'hour' | 'month' | 'year' | null,
                    },
                  },
                })
              }
            >
              <option value="">Not set</option>
              <option value="hour">Hour</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </label>
        </div>
        <fieldset className="choice-group form-grid__wide">
          <legend>Preferred company sizes</legend>
          {(['startup', 'small', 'mid_size', 'large', 'enterprise'] as const).map(
            (size) => (
              <label key={size}>
                <input
                  type="checkbox"
                  checked={preferences.preferredCompanySizes.includes(size)}
                  onChange={(event) => {
                    const preferredCompanySizes = event.target.checked
                      ? [...preferences.preferredCompanySizes, size]
                      : preferences.preferredCompanySizes.filter((item) => item !== size);
                    onChange({
                      ...draft,
                      preferences: {
                        ...draft.preferences,
                        data: { ...preferences, preferredCompanySizes },
                      },
                    });
                  }}
                />
                {size.replace('_', ' ')}
              </label>
            ),
          )}
        </fieldset>
        <ListField
          label="Must-have conditions"
          value={preferences.mustHaves}
          placeholder="Accessible product culture"
          onChange={(mustHaves) =>
            onChange({
              ...draft,
              preferences: {
                ...draft.preferences,
                data: { ...preferences, mustHaves },
              },
            })
          }
        />
        <ListField
          label="Hard exclusions"
          value={preferences.exclusions}
          placeholder={'Unpaid roles\nFull-time office attendance'}
          onChange={(exclusions) =>
            onChange({
              ...draft,
              preferences: {
                ...draft.preferences,
                data: { ...preferences, exclusions },
              },
            })
          }
        />
      </div>
    </details>
  );
}

function SupportingEvidence({ draft, onChange }: EditorProps): React.JSX.Element {
  const manualFact = () => ensureManualSource(draft);

  return (
    <details className="profile-disclosure profile-disclosure--section">
      <summary>
        <span>Optional supporting evidence</span>
        <small>Projects, education and certifications</small>
      </summary>
      <div className="detail-body supporting-groups">
        <section>
          <div className="supporting-heading">
            <h3>Projects</h3>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                const manual = manualFact();
                onChange({
                  ...manual.draft,
                  projects: [
                    ...manual.draft.projects,
                    {
                      id: newFactId(),
                      sourceId: manual.sourceId,
                      confirmationStatus: 'confirmed',
                      evidenceExcerpt: 'Entered directly in Job Radar',
                      data: { name: '', description: '', technologies: [] },
                    },
                  ],
                });
              }}
            >
              + Add project
            </button>
          </div>
          {draft.projects.length === 0 && <EmptyHint>No projects added.</EmptyHint>}
          {draft.projects.map((fact, index) => (
            <article className="repeat-card" key={fact.id ?? index}>
              <div className="form-grid form-grid--two">
                <label>
                  Project name
                  <input
                    value={fact.data.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        projects: replaceAt(draft.projects, index, (item) => ({
                          ...item,
                          data: { ...item.data, name: event.target.value },
                        })),
                      })
                    }
                  />
                </label>
                <label>
                  Your role
                  <input
                    value={fact.data.role ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        projects: replaceAt(draft.projects, index, (item) => ({
                          ...item,
                          data: { ...item.data, role: event.target.value || undefined },
                        })),
                      })
                    }
                  />
                </label>
                <label className="form-grid__wide">
                  Description
                  <textarea
                    rows={3}
                    value={fact.data.description}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        projects: replaceAt(draft.projects, index, (item) => ({
                          ...item,
                          data: { ...item.data, description: event.target.value },
                        })),
                      })
                    }
                  />
                </label>
                <ListField
                  label="Technologies"
                  value={fact.data.technologies}
                  placeholder={'React\nSQLite'}
                  rows={2}
                  onChange={(technologies) =>
                    onChange({
                      ...draft,
                      projects: replaceAt(draft.projects, index, (item) => ({
                        ...item,
                        data: { ...item.data, technologies },
                      })),
                    })
                  }
                />
              </div>
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({ ...draft, projects: removeAt(draft.projects, index) })
                }
              >
                Remove project
              </button>
            </article>
          ))}
        </section>

        <section>
          <div className="supporting-heading">
            <h3>Education</h3>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                const manual = manualFact();
                onChange({
                  ...manual.draft,
                  educationExperiences: [
                    ...manual.draft.educationExperiences,
                    {
                      id: newFactId(),
                      sourceId: manual.sourceId,
                      confirmationStatus: 'confirmed',
                      evidenceExcerpt: 'Entered directly in Job Radar',
                      data: { institution: '', degree: '' },
                    },
                  ],
                });
              }}
            >
              + Add education
            </button>
          </div>
          {draft.educationExperiences.length === 0 && (
            <EmptyHint>No education added.</EmptyHint>
          )}
          {draft.educationExperiences.map((fact, index) => (
            <article className="repeat-card" key={fact.id ?? index}>
              <div className="form-grid form-grid--two">
                <label>
                  Institution
                  <input
                    value={fact.data.institution}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        educationExperiences: replaceAt(
                          draft.educationExperiences,
                          index,
                          (item) => ({
                            ...item,
                            data: { ...item.data, institution: event.target.value },
                          }),
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Degree or credential
                  <input
                    value={fact.data.degree}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        educationExperiences: replaceAt(
                          draft.educationExperiences,
                          index,
                          (item) => ({
                            ...item,
                            data: { ...item.data, degree: event.target.value },
                          }),
                        ),
                      })
                    }
                  />
                </label>
                <label className="form-grid__wide">
                  Field of study
                  <input
                    value={fact.data.fieldOfStudy ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        educationExperiences: replaceAt(
                          draft.educationExperiences,
                          index,
                          (item) => ({
                            ...item,
                            data: {
                              ...item.data,
                              fieldOfStudy: event.target.value || undefined,
                            },
                          }),
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    educationExperiences: removeAt(draft.educationExperiences, index),
                  })
                }
              >
                Remove education
              </button>
            </article>
          ))}
        </section>

        <section>
          <div className="supporting-heading">
            <h3>Certifications</h3>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                const manual = manualFact();
                onChange({
                  ...manual.draft,
                  certifications: [
                    ...manual.draft.certifications,
                    {
                      id: newFactId(),
                      sourceId: manual.sourceId,
                      confirmationStatus: 'confirmed',
                      evidenceExcerpt: 'Entered directly in Job Radar',
                      data: { name: '', issuer: '' },
                    },
                  ],
                });
              }}
            >
              + Add certification
            </button>
          </div>
          {draft.certifications.length === 0 && (
            <EmptyHint>No certifications added.</EmptyHint>
          )}
          {draft.certifications.map((fact, index) => (
            <article className="repeat-card" key={fact.id ?? index}>
              <div className="form-grid form-grid--two">
                <label>
                  Certification
                  <input
                    value={fact.data.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        certifications: replaceAt(
                          draft.certifications,
                          index,
                          (item) => ({
                            ...item,
                            data: { ...item.data, name: event.target.value },
                          }),
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Issuer
                  <input
                    value={fact.data.issuer}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        certifications: replaceAt(
                          draft.certifications,
                          index,
                          (item) => ({
                            ...item,
                            data: { ...item.data, issuer: event.target.value },
                          }),
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    certifications: removeAt(draft.certifications, index),
                  })
                }
              >
                Remove certification
              </button>
            </article>
          ))}
        </section>
      </div>
    </details>
  );
}

export function ProfileEditor({ draft, onChange }: EditorProps): React.JSX.Element {
  return (
    <div className="editor-stack">
      <SearchSection draft={draft} onChange={onChange} />
      <details className="profile-disclosure profile-disclosure--section profile-advanced">
        <summary>
          <span>Optional details</span>
          <small>Only add information that improves your matches</small>
        </summary>
        <div className="detail-body editor-stack editor-stack--advanced">
          <details className="profile-disclosure profile-disclosure--nested">
            <summary>
              <span>Language and eligibility</span>
              <small>Useful when a role has location or permit requirements</small>
            </summary>
            <div className="detail-body editor-stack">
              <FitSection draft={draft} onChange={onChange} />
              <EligibilitySection draft={draft} onChange={onChange} />
            </div>
          </details>
          <details className="profile-disclosure profile-disclosure--nested">
            <summary>
              <span>Work experience</span>
              <small>Add evidence when you want more precise matching</small>
            </summary>
            <div className="detail-body">
              <EvidenceSection draft={draft} onChange={onChange} />
            </div>
          </details>
          <OptionalFilters draft={draft} onChange={onChange} />
          <SupportingEvidence draft={draft} onChange={onChange} />
        </div>
      </details>
    </div>
  );
}
