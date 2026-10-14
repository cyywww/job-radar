import { useEffect, useMemo, useState } from 'react';

import { publicFeedSchema, type PublicFeed, type PublicJob } from '@job-radar/shared';

type FeedState =
  { status: 'loading' } | { status: 'ready'; feed: PublicFeed } | { status: 'error' };

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Stockholm',
  }).format(new Date(value));
}

function JobCard({ job }: { job: PublicJob }) {
  return (
    <article className="job-card">
      <div className="job-card__heading">
        <h2>
          <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer">
            {job.title} <span aria-hidden="true">↗</span>
          </a>
        </h2>
        <p>{job.company}</p>
      </div>
      <div className="job-card__meta">
        <span>{job.location}</span>
        {job.publishedAt && <span>{formatDate(job.publishedAt)}</span>}
        {job.mustHaveLanguages.length > 0 && (
          <span>Language: {job.mustHaveLanguages.join(', ')}</span>
        )}
      </div>
    </article>
  );
}

export default function App() {
  const [state, setState] = useState<FeedState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState('all');
  const [viewedAt] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/latest.json', { signal: controller.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('Feed unavailable');
        return response.json();
      })
      .then((body: unknown) =>
        setState({ status: 'ready', feed: publicFeedSchema.parse(body) }),
      )
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [reload]);

  const feed = state.status === 'ready' ? state.feed : null;
  const regions = useMemo(
    () => [...new Set(feed?.jobs.map((job) => job.region) ?? [])].sort(),
    [feed],
  );
  const visibleJobs = useMemo(() => {
    if (!feed) return [];
    const term = search.trim().toLocaleLowerCase();
    return feed.jobs.filter(
      (job) =>
        (region === 'all' || job.region === region) &&
        `${job.title} ${job.company} ${job.location}`.toLocaleLowerCase().includes(term),
    );
  }, [feed, region, search]);
  const isStale = feed
    ? viewedAt - new Date(feed.generatedAt).getTime() > 48 * 60 * 60 * 1000
    : false;
  const hasFilters = search.trim().length > 0 || region !== 'all';

  return (
    <>
      <header className="site-header">
        <div className="shell site-header__inner">
          <a className="brand" href="#top">
            job radar
          </a>
          <a
            className="header-link"
            href="https://github.com/cyywww/job-radar"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub <span aria-hidden="true">↗</span>
          </a>
        </div>
      </header>
      <main className="shell main" id="top">
        <div className="page-heading">
          <h1>Software jobs</h1>
          <p>Stockholm area and northern Sweden</p>
        </div>

        {state.status === 'loading' && (
          <p className="state-card" role="status">
            Loading jobs…
          </p>
        )}
        {state.status === 'error' && (
          <div className="state-card" role="alert">
            <p>Jobs are unavailable.</p>
            <button
              onClick={() => {
                setState({ status: 'loading' });
                setReload((value) => value + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {feed && (
          <>
            <div className="snapshot-line">
              <strong>{feed.jobs.length} sampled jobs</strong>
              <span>Updated {formatDate(feed.generatedAt)}</span>
            </div>
            {isStale && (
              <p className="stale-notice" role="status">
                Last update was over 48 hours ago. Check the original listing.
              </p>
            )}
            <div className="filters">
              <label className="filter-search">
                <span className="sr-only">Search roles</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title, company or city"
                />
              </label>
              <label className="filter-region">
                <span className="sr-only">Region</span>
                <select
                  value={region}
                  onChange={(event) => setRegion(event.target.value)}
                >
                  <option value="all">All regions</option>
                  {regions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {hasFilters && (
              <p className="result-count" role="status">
                {visibleJobs.length} results
              </p>
            )}
            <div className="job-list">
              {visibleJobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
            {visibleJobs.length === 0 && (
              <p className="state-card">No jobs match your search.</p>
            )}
            <p className="data-note">
              Data: JobTech. Check original listings for full requirements.
            </p>
          </>
        )}
      </main>
    </>
  );
}
