import { useState } from 'react';

import type { CreateProfileRequest } from '@job-radar/shared';

import { ensureManualSource, newFactId } from './profile-draft.js';

type FactMetaValue = {
  sourceId: string;
  confirmationStatus: 'pending' | 'confirmed' | 'rejected';
  evidenceExcerpt?: string | undefined;
};

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function FactMeta({
  value,
  draft,
  onChange,
}: {
  value: FactMetaValue;
  draft: CreateProfileRequest;
  onChange: (value: FactMetaValue) => void;
}): React.JSX.Element {
  return (
    <div className="fact-meta">
      <label>
        Evidence source
        <select
          value={value.sourceId}
          onChange={(event) => onChange({ ...value, sourceId: event.target.value })}
        >
          {draft.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Confirmation
        <select
          aria-label="Confirmation status"
          value={value.confirmationStatus}
          onChange={(event) =>
            onChange({
              ...value,
              confirmationStatus: event.target
                .value as FactMetaValue['confirmationStatus'],
            })
          }
        >
          <option value="pending">Pending review</option>
          <option value="confirmed">Confirmed by me</option>
          <option value="rejected">Rejected</option>
        </select>
      </label>
      <label className="fact-meta__excerpt">
        Evidence note
        <input
          value={value.evidenceExcerpt ?? ''}
          maxLength={500}
          placeholder="Optional short provenance note"
          onChange={(event) =>
            onChange({ ...value, evidenceExcerpt: event.target.value || undefined })
          }
        />
      </label>
    </div>
  );
}

function ListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
}): React.JSX.Element {
  const canonicalValue = value.join('\n');
  const [text, setText] = useState(canonicalValue);

  return (
    <label>
      {label}
      <textarea
        rows={3}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onChange(splitList(text))}
      />
    </label>
  );
}

function EmptyHint({ children }: { children: string }): React.JSX.Element {
  return <p className="empty-hint">{children}</p>;
}

export function ProfileEditor({
  draft,
  onChange,
}: {
  draft: CreateProfileRequest;
  onChange: (draft: CreateProfileRequest) => void;
}): React.JSX.Element {
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
          data: {
            organization: '',
            title: '',
            startDate: '2024-01',
            current: false,
          },
        },
      ],
    });
  };

  const addEducation = () => {
    const manual = ensureManualSource(draft);
    onChange({
      ...manual.draft,
      educationExperiences: [
        ...manual.draft.educationExperiences,
        {
          id: newFactId(),
          sourceId: manual.sourceId,
          confirmationStatus: 'confirmed',
          data: { institution: '', degree: '' },
        },
      ],
    });
  };

  const addSkill = () => {
    const manual = ensureManualSource(draft);
    onChange({
      ...manual.draft,
      skills: [
        ...manual.draft.skills,
        {
          id: newFactId(),
          sourceId: manual.sourceId,
          confirmationStatus: 'confirmed',
          data: { name: '', level: 'working' },
        },
      ],
    });
  };

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
          data: { name: '', proficiency: 'professional' },
        },
      ],
    });
  };

  const addCertification = () => {
    const manual = ensureManualSource(draft);
    onChange({
      ...manual.draft,
      certifications: [
        ...manual.draft.certifications,
        {
          id: newFactId(),
          sourceId: manual.sourceId,
          confirmationStatus: 'confirmed',
          data: { name: '', issuer: '' },
        },
      ],
    });
  };

  const addProject = () => {
    const manual = ensureManualSource(draft);
    onChange({
      ...manual.draft,
      projects: [
        ...manual.draft.projects,
        {
          id: newFactId(),
          sourceId: manual.sourceId,
          confirmationStatus: 'confirmed',
          data: { name: '', description: '', technologies: [] },
        },
      ],
    });
  };

  return (
    <div className="editor-stack">
      <section className="editor-section" aria-labelledby="basics-heading">
        <div className="section-title">
          <div>
            <span>01</span>
            <h2 id="basics-heading">Identity & direction</h2>
          </div>
          <span className={`fact-state fact-state--${draft.basics.confirmationStatus}`}>
            {draft.basics.confirmationStatus}
          </span>
        </div>
        <div className="form-grid form-grid--two">
          <label>
            Display name
            <input
              aria-label="Display name"
              value={draft.basics.data.displayName}
              maxLength={100}
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
            Current location
            <input
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
            Headline
            <input
              value={draft.basics.data.headline ?? ''}
              maxLength={200}
              placeholder="What you do, in your own words"
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
            Professional summary
            <textarea
              rows={5}
              value={draft.basics.data.summary ?? ''}
              maxLength={2_000}
              placeholder="A factual summary—nothing will be inferred for you."
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
        </div>
        <FactMeta
          value={draft.basics}
          draft={draft}
          onChange={(value) =>
            onChange({ ...draft, basics: { ...draft.basics, ...value } })
          }
        />
      </section>

      <section className="editor-section" aria-labelledby="preferences-heading">
        <div className="section-title">
          <div>
            <span>02</span>
            <h2 id="preferences-heading">Search preferences</h2>
          </div>
          <span
            className={`fact-state fact-state--${draft.preferences.confirmationStatus}`}
          >
            {draft.preferences.confirmationStatus}
          </span>
        </div>
        <p className="section-copy">
          These are future search gates, not a job score. One item per line keeps hard
          constraints explicit.
        </p>
        <div className="form-grid form-grid--two">
          <ListField
            label="Target roles"
            value={draft.preferences.data.targetRoles}
            placeholder={'Product Engineer\nFrontend Engineer'}
            onChange={(targetRoles) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: { ...draft.preferences.data, targetRoles },
                },
              })
            }
          />
          <ListField
            label="Target locations"
            value={draft.preferences.data.targetLocations}
            placeholder={'Stockholm\nRemote within Sweden'}
            onChange={(targetLocations) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: { ...draft.preferences.data, targetLocations },
                },
              })
            }
          />
          <fieldset className="choice-group form-grid__wide">
            <legend>Work mode</legend>
            {(['onsite', 'hybrid', 'remote'] as const).map((mode) => (
              <label key={mode}>
                <input
                  type="checkbox"
                  checked={draft.preferences.data.workModes.includes(mode)}
                  onChange={(event) => {
                    const workModes = event.target.checked
                      ? [...draft.preferences.data.workModes, mode]
                      : draft.preferences.data.workModes.filter((item) => item !== mode);
                    onChange({
                      ...draft,
                      preferences: {
                        ...draft.preferences,
                        data: { ...draft.preferences.data, workModes },
                      },
                    });
                  }}
                />
                {mode}
              </label>
            ))}
          </fieldset>
          <label>
            Maximum commute (minutes)
            <input
              type="number"
              min={0}
              max={300}
              value={draft.preferences.data.maxCommuteMinutes ?? ''}
              onChange={(event) =>
                onChange({
                  ...draft,
                  preferences: {
                    ...draft.preferences,
                    data: {
                      ...draft.preferences.data,
                      maxCommuteMinutes: event.target.value
                        ? Number(event.target.value)
                        : null,
                    },
                  },
                })
              }
            />
          </label>
          <label>
            Work authorization status
            <select
              value={draft.preferences.data.workAuthorization.status}
              onChange={(event) =>
                onChange({
                  ...draft,
                  preferences: {
                    ...draft.preferences,
                    data: {
                      ...draft.preferences.data,
                      workAuthorization: {
                        ...draft.preferences.data.workAuthorization,
                        status: event.target
                          .value as typeof draft.preferences.data.workAuthorization.status,
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
            value={draft.preferences.data.workAuthorization.countries}
            placeholder="Sweden"
            onChange={(countries) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: {
                    ...draft.preferences.data,
                    workAuthorization: {
                      ...draft.preferences.data.workAuthorization,
                      countries,
                    },
                  },
                },
              })
            }
          />
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.preferences.data.workAuthorization.needsSponsorship}
              onChange={(event) =>
                onChange({
                  ...draft,
                  preferences: {
                    ...draft.preferences,
                    data: {
                      ...draft.preferences.data,
                      workAuthorization: {
                        ...draft.preferences.data.workAuthorization,
                        needsSponsorship: event.target.checked,
                      },
                    },
                  },
                })
              }
            />
            I require employer sponsorship
          </label>
          <div className="salary-fields form-grid__wide">
            <label>
              Minimum salary
              <input
                type="number"
                min={1}
                value={draft.preferences.data.minimumSalary ?? ''}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    preferences: {
                      ...draft.preferences,
                      data: {
                        ...draft.preferences.data,
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
                value={draft.preferences.data.salaryCurrency ?? ''}
                maxLength={3}
                placeholder="SEK"
                onChange={(event) =>
                  onChange({
                    ...draft,
                    preferences: {
                      ...draft.preferences,
                      data: {
                        ...draft.preferences.data,
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
                value={draft.preferences.data.salaryPeriod ?? ''}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    preferences: {
                      ...draft.preferences,
                      data: {
                        ...draft.preferences.data,
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
          <ListField
            label="Preferred industries"
            value={draft.preferences.data.preferredIndustries}
            placeholder="Developer tools"
            onChange={(preferredIndustries) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: { ...draft.preferences.data, preferredIndustries },
                },
              })
            }
          />
          <fieldset className="choice-group">
            <legend>Preferred company sizes</legend>
            {(['startup', 'small', 'mid_size', 'large', 'enterprise'] as const).map(
              (size) => (
                <label key={size}>
                  <input
                    type="checkbox"
                    checked={draft.preferences.data.preferredCompanySizes.includes(size)}
                    onChange={(event) => {
                      const preferredCompanySizes = event.target.checked
                        ? [...draft.preferences.data.preferredCompanySizes, size]
                        : draft.preferences.data.preferredCompanySizes.filter(
                            (item) => item !== size,
                          );
                      onChange({
                        ...draft,
                        preferences: {
                          ...draft.preferences,
                          data: {
                            ...draft.preferences.data,
                            preferredCompanySizes,
                          },
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
            value={draft.preferences.data.mustHaves}
            placeholder="Accessible product culture"
            onChange={(mustHaves) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: { ...draft.preferences.data, mustHaves },
                },
              })
            }
          />
          <ListField
            label="Hard exclusions"
            value={draft.preferences.data.exclusions}
            placeholder={'Unpaid roles\nFull-time office attendance'}
            onChange={(exclusions) =>
              onChange({
                ...draft,
                preferences: {
                  ...draft.preferences,
                  data: { ...draft.preferences.data, exclusions },
                },
              })
            }
          />
        </div>
        <FactMeta
          value={draft.preferences}
          draft={draft}
          onChange={(value) =>
            onChange({ ...draft, preferences: { ...draft.preferences, ...value } })
          }
        />
      </section>

      <section className="editor-section" aria-labelledby="evidence-heading">
        <div className="section-title">
          <div>
            <span>03</span>
            <h2 id="evidence-heading">Evidence-backed experience</h2>
          </div>
        </div>
        <p className="section-copy">
          Add only facts you can stand behind. Each entry retains its source and review
          status across versions.
        </p>

        <details open>
          <summary>
            Work experience <span>{draft.workExperiences.length}</span>
          </summary>
          {draft.workExperiences.length === 0 && (
            <EmptyHint>No work experience recorded yet.</EmptyHint>
          )}
          {draft.workExperiences.map((fact, index) => (
            <div className="repeat-card" key={fact.id ?? index}>
              <div className="form-grid form-grid--two">
                <label>
                  Organization
                  <input
                    value={fact.data.organization}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        workExperiences: draft.workExperiences.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, organization: event.target.value },
                              }
                            : item,
                        ),
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
                        workExperiences: draft.workExperiences.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, title: event.target.value },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="form-grid__wide">
                  Work location
                  <input
                    value={fact.data.location ?? ''}
                    placeholder="City, country or remote"
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        workExperiences: draft.workExperiences.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  location: event.target.value || undefined,
                                },
                              }
                            : item,
                        ),
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
                        workExperiences: draft.workExperiences.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, startDate: event.target.value },
                              }
                            : item,
                        ),
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
                        workExperiences: draft.workExperiences.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  endDate: event.target.value || null,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={fact.data.current}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        workExperiences: draft.workExperiences.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  current: event.target.checked,
                                  ...(event.target.checked ? { endDate: null } : {}),
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  Current role
                </label>
                <label className="form-grid__wide">
                  Summary
                  <textarea
                    rows={3}
                    value={fact.data.summary ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        workExperiences: draft.workExperiences.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  summary: event.target.value || undefined,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <FactMeta
                value={fact}
                draft={draft}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    workExperiences: draft.workExperiences.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, ...value } : item,
                    ),
                  })
                }
              />
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    workExperiences: draft.workExperiences.filter(
                      (_item, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                Remove experience
              </button>
            </div>
          ))}
          <button className="button button--add" type="button" onClick={addWork}>
            + Add work experience
          </button>
        </details>

        <details>
          <summary>
            Education <span>{draft.educationExperiences.length}</span>
          </summary>
          {draft.educationExperiences.length === 0 && (
            <EmptyHint>No education recorded yet.</EmptyHint>
          )}
          {draft.educationExperiences.map((fact, index) => (
            <div className="repeat-card" key={fact.id ?? index}>
              <div className="form-grid form-grid--two">
                <label>
                  Institution
                  <input
                    value={fact.data.institution}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        educationExperiences: draft.educationExperiences.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  data: { ...item.data, institution: event.target.value },
                                }
                              : item,
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
                        educationExperiences: draft.educationExperiences.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  data: { ...item.data, degree: event.target.value },
                                }
                              : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Field of study
                  <input
                    value={fact.data.fieldOfStudy ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        educationExperiences: draft.educationExperiences.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  data: {
                                    ...item.data,
                                    fieldOfStudy: event.target.value || undefined,
                                  },
                                }
                              : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Start month
                  <input
                    type="month"
                    value={fact.data.startDate ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        educationExperiences: draft.educationExperiences.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  data: {
                                    ...item.data,
                                    startDate: event.target.value || undefined,
                                  },
                                }
                              : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  End month
                  <input
                    type="month"
                    value={fact.data.endDate ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        educationExperiences: draft.educationExperiences.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  data: {
                                    ...item.data,
                                    endDate: event.target.value || undefined,
                                  },
                                }
                              : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="form-grid__wide">
                  Education note
                  <textarea
                    rows={3}
                    value={fact.data.summary ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        educationExperiences: draft.educationExperiences.map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  data: {
                                    ...item.data,
                                    summary: event.target.value || undefined,
                                  },
                                }
                              : item,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <FactMeta
                value={fact}
                draft={draft}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    educationExperiences: draft.educationExperiences.map(
                      (item, itemIndex) =>
                        itemIndex === index ? { ...item, ...value } : item,
                    ),
                  })
                }
              />
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    educationExperiences: draft.educationExperiences.filter(
                      (_item, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                Remove education
              </button>
            </div>
          ))}
          <button className="button button--add" type="button" onClick={addEducation}>
            + Add education
          </button>
        </details>

        <details>
          <summary>
            Skills <span>{draft.skills.length}</span>
          </summary>
          {draft.skills.length === 0 && <EmptyHint>No skills recorded yet.</EmptyHint>}
          {draft.skills.map((fact, index) => (
            <div className="repeat-card repeat-card--compact" key={fact.id ?? index}>
              <div className="form-grid form-grid--three">
                <label>
                  Skill
                  <input
                    value={fact.data.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        skills: draft.skills.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, name: event.target.value },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Level
                  <select
                    value={fact.data.level}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        skills: draft.skills.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  level: event.target.value as typeof fact.data.level,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="foundational">Foundational</option>
                    <option value="working">Working</option>
                    <option value="advanced">Advanced</option>
                    <option value="expert">Expert</option>
                  </select>
                </label>
                <label>
                  Years
                  <input
                    type="number"
                    min={0}
                    max={80}
                    value={fact.data.yearsExperience ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        skills: draft.skills.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  yearsExperience: event.target.value
                                    ? Number(event.target.value)
                                    : undefined,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <FactMeta
                value={fact}
                draft={draft}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    skills: draft.skills.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, ...value } : item,
                    ),
                  })
                }
              />
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    skills: draft.skills.filter(
                      (_item, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                Remove skill
              </button>
            </div>
          ))}
          <button className="button button--add" type="button" onClick={addSkill}>
            + Add skill
          </button>
        </details>

        <details>
          <summary>
            Languages <span>{draft.languages.length}</span>
          </summary>
          {draft.languages.length === 0 && (
            <EmptyHint>No languages recorded yet.</EmptyHint>
          )}
          {draft.languages.map((fact, index) => (
            <div className="repeat-card repeat-card--compact" key={fact.id ?? index}>
              <div className="form-grid form-grid--two">
                <label>
                  Language
                  <input
                    value={fact.data.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        languages: draft.languages.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, name: event.target.value },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Proficiency
                  <select
                    value={fact.data.proficiency}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        languages: draft.languages.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  proficiency: event.target
                                    .value as typeof fact.data.proficiency,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="basic">Basic</option>
                    <option value="conversational">Conversational</option>
                    <option value="professional">Professional</option>
                    <option value="fluent">Fluent</option>
                    <option value="native">Native</option>
                  </select>
                </label>
              </div>
              <FactMeta
                value={fact}
                draft={draft}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    languages: draft.languages.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, ...value } : item,
                    ),
                  })
                }
              />
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    languages: draft.languages.filter(
                      (_item, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                Remove language
              </button>
            </div>
          ))}
          <button className="button button--add" type="button" onClick={addLanguage}>
            + Add language
          </button>
        </details>

        <details>
          <summary>
            Certifications <span>{draft.certifications.length}</span>
          </summary>
          {draft.certifications.length === 0 && (
            <EmptyHint>No certifications recorded yet.</EmptyHint>
          )}
          {draft.certifications.map((fact, index) => (
            <div className="repeat-card repeat-card--compact" key={fact.id ?? index}>
              <div className="form-grid form-grid--two">
                <label>
                  Certification
                  <input
                    value={fact.data.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        certifications: draft.certifications.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, name: event.target.value },
                              }
                            : item,
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
                        certifications: draft.certifications.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, issuer: event.target.value },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Issue month
                  <input
                    type="month"
                    value={fact.data.issueDate ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        certifications: draft.certifications.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  issueDate: event.target.value || undefined,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Expiry month
                  <input
                    type="month"
                    value={fact.data.expiresAt ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        certifications: draft.certifications.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  expiresAt: event.target.value || undefined,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label className="form-grid__wide">
                  Credential ID
                  <input
                    value={fact.data.credentialId ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        certifications: draft.certifications.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  credentialId: event.target.value || undefined,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <FactMeta
                value={fact}
                draft={draft}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    certifications: draft.certifications.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, ...value } : item,
                    ),
                  })
                }
              />
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    certifications: draft.certifications.filter(
                      (_item, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                Remove certification
              </button>
            </div>
          ))}
          <button className="button button--add" type="button" onClick={addCertification}>
            + Add certification
          </button>
        </details>

        <details>
          <summary>
            Projects <span>{draft.projects.length}</span>
          </summary>
          {draft.projects.length === 0 && (
            <EmptyHint>No projects recorded yet.</EmptyHint>
          )}
          {draft.projects.map((fact, index) => (
            <div className="repeat-card" key={fact.id ?? index}>
              <div className="form-grid form-grid--two">
                <label>
                  Project name
                  <input
                    value={fact.data.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        projects: draft.projects.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, name: event.target.value },
                              }
                            : item,
                        ),
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
                        projects: draft.projects.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  role: event.target.value || undefined,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Start month
                  <input
                    type="month"
                    value={fact.data.startDate ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        projects: draft.projects.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  startDate: event.target.value || undefined,
                                },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  End month
                  <input
                    type="month"
                    value={fact.data.endDate ?? ''}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        projects: draft.projects.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: {
                                  ...item.data,
                                  endDate: event.target.value || undefined,
                                },
                              }
                            : item,
                        ),
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
                        projects: draft.projects.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                data: { ...item.data, description: event.target.value },
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <ListField
                  label="Technologies"
                  value={fact.data.technologies}
                  placeholder={'React\nSQLite'}
                  onChange={(technologies) =>
                    onChange({
                      ...draft,
                      projects: draft.projects.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, data: { ...item.data, technologies } }
                          : item,
                      ),
                    })
                  }
                />
              </div>
              <FactMeta
                value={fact}
                draft={draft}
                onChange={(value) =>
                  onChange({
                    ...draft,
                    projects: draft.projects.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, ...value } : item,
                    ),
                  })
                }
              />
              <button
                className="text-button text-button--danger"
                type="button"
                onClick={() =>
                  onChange({
                    ...draft,
                    projects: draft.projects.filter(
                      (_item, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                Remove project
              </button>
            </div>
          ))}
          <button className="button button--add" type="button" onClick={addProject}>
            + Add project
          </button>
        </details>
      </section>
    </div>
  );
}
