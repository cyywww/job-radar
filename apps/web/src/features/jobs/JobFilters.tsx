import type { ReviewJobsQuery, SourceView } from '@job-radar/shared';

const selectFilters = [
  [
    'triage',
    'State',
    [
      ['', 'All'],
      ['new', 'New'],
      ['shortlisted', 'Shortlisted'],
      ['ignored', 'Ignored'],
      ['archived', 'Archived'],
    ],
  ],
  [
    'remoteMode',
    'Remote',
    [
      ['', 'All'],
      ['remote', 'Remote'],
      ['hybrid', 'Hybrid'],
      ['onsite', 'Onsite'],
      ['unknown', 'Unknown'],
    ],
  ],
  [
    'lifecycle',
    'Lifecycle',
    [
      ['', 'All open states'],
      ['open', 'Open'],
      ['possibly_closed', 'Possibly closed'],
      ['closed', 'Closed'],
    ],
  ],
  [
    'gate',
    'Gate',
    [
      ['', 'All'],
      ['passed', 'Passed'],
      ['failed', 'Failed'],
      ['unscored', 'Not evaluated'],
    ],
  ],
  [
    'scoreStatus',
    'Score status',
    [
      ['', 'All'],
      ['unscored', 'Unscored'],
      ['pending', 'Pending'],
      ['running', 'Running'],
      ['failed', 'Failed'],
      ['retry_wait', 'Retry wait'],
      ['gate_failed', 'Gate failed'],
      ['review', 'Review'],
      ['scored', 'Scored'],
    ],
  ],
  [
    'reviewState',
    'Review',
    [
      ['', 'All'],
      ['pending', 'Pending'],
      ['approved', 'Approved'],
      ['rejected', 'Rejected'],
      ['not_required', 'Not required'],
    ],
  ],
  [
    'sort',
    'Sort',
    [
      ['rankingScore', 'Ranking score'],
      ['matchScore', 'Match score'],
      ['publishedAt', 'Published'],
      ['deadline', 'Deadline'],
      ['lastChangedAt', 'Recently changed'],
    ],
  ],
  [
    'direction',
    'Direction',
    [
      ['desc', 'Descending'],
      ['asc', 'Ascending'],
    ],
  ],
] as const;

type QuickView = 'all' | 'new' | 'saved' | 'review';

interface JobFiltersProps {
  query: ReviewJobsQuery;
  sources: SourceView[];
  onChange: (patch: Partial<ReviewJobsQuery>) => void;
  onQuickView: (view: QuickView) => void;
  onSave: () => void;
  onClear: () => void;
}

export function JobFilters({
  query,
  sources,
  onChange,
  onQuickView,
  onSave,
  onClear,
}: JobFiltersProps): React.JSX.Element {
  const quickViews: [QuickView, string, boolean][] = [
    ['all', 'All', !query.triage && !query.reviewState],
    ['new', 'New', query.triage === 'new'],
    ['saved', 'Saved', query.triage === 'shortlisted'],
    ['review', 'Needs review', query.reviewState === 'pending'],
  ];

  return (
    <div className="opportunity-controls">
      <label className="filter-search">
        <span className="visually-hidden">Search title, company, or skill</span>
        <input
          type="search"
          placeholder="Search roles, companies, or skills"
          value={query.search}
          maxLength={200}
          onChange={(event) => onChange({ search: event.target.value })}
        />
      </label>
      <div className="quick-views" aria-label="Opportunity views">
        {quickViews.map(([view, label, active]) => (
          <button
            key={view}
            type="button"
            aria-pressed={active}
            onClick={() => onQuickView(view)}
          >
            {label}
          </button>
        ))}
      </div>
      <details className="filter-disclosure">
        <summary>Filters</summary>
        <form
          className="job-filters"
          role="search"
          onSubmit={(event) => event.preventDefault()}
        >
          {selectFilters.map(([field, label, options]) => (
            <label key={field}>
              {label}
              <select
                value={query[field] ?? ''}
                onChange={(event) =>
                  onChange({ [field]: event.target.value || undefined })
                }
              >
                {options.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Source
            <select
              value={query.sourceId ?? ''}
              onChange={(event) =>
                onChange({ sourceId: event.target.value || undefined })
              }
            >
              <option value="">All</option>
              {sources.map((source) => (
                <option value={source.id} key={source.id}>
                  {source.name}
                  {source.configurationState === 'deleted' ? ' (deleted)' : ''}
                </option>
              ))}
            </select>
          </label>
          {(['location', 'company'] as const).map((field) => (
            <label key={field}>
              {field === 'location' ? 'Location' : 'Company'}
              <input
                value={query[field] ?? ''}
                maxLength={160}
                onChange={(event) =>
                  onChange({ [field]: event.target.value || undefined })
                }
              />
            </label>
          ))}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={query.includeClosed}
              onChange={(event) => onChange({ includeClosed: event.target.checked })}
            />
            Show closed jobs
          </label>
          <div className="filter-actions">
            <button className="button button--quiet" type="button" onClick={onSave}>
              Save filters
            </button>
            <button className="text-button" type="button" onClick={onClear}>
              Clear
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
