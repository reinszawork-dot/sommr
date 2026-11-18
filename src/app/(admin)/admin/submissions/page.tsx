import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Copy, Pencil } from 'lucide-react';
import { ActionButton } from '@/components/admin/ActionButton';
import { RejectButton } from '@/components/admin/RejectButton';
import { getCity } from '@/lib/cities';
import { formatShortDate, formatTime, timeAgo } from '@/lib/time';
import {
  applyAllFixesAction, applyFixAction, approveAgentFindsAction, dismissFixAction, mergeAllDuplicatesAction, mergeDuplicatesAction,
  rejectWithReasonAction, setEventStatusAction, setPlaceStatusAction,
} from '@/server/actions/admin';
import { maybeOne, query, sql } from '@/server/db';
import { findDuplicateGroups, REJECT_REASONS } from '@/server/services/agent-finds';

export const metadata: Metadata = { title: 'Submissions' };

export default async function SubmissionsPage() {
  const [events, places] = await Promise.all([
    query<{ id: string; title: string; starts_at: Date; time_tbc: boolean; venue_name: string | null; city_slug: string | null; ticket_url: string | null; description: string | null; email: string | null; created_at: Date }>(sql`
      select e.id, e.title, e.starts_at, e.time_tbc, e.venue_name, e.city_slug, e.ticket_url, e.description, u.email, e.created_at
      from events e left join users u on u.id = e.submitted_by where e.status = 'pending' order by e.created_at`),
    query<{ id: string; name: string; category_slug: string; address: string | null; city: string | null; website: string | null; description: string | null; email: string | null; created_at: Date }>(sql`
      select p.id, p.name, p.category_slug, p.address, p.city, p.website, p.description, u.email, p.created_at
      from places p left join users u on u.id = p.submitted_by where p.status = 'pending' order by p.created_at`),
  ]);
  const [fixes, dupGroups] = await Promise.all([
    query<{ id: string; target: string; target_id: string; changes: Record<string, unknown>; reason: string; source_url: string | null; name: string | null }>(sql`
      select f.id, f.target, f.target_id, f.changes, f.reason, f.source_url, coalesce(e.title, p.name) as name
      from agent_fixes f left join events e on f.target = 'event' and e.id = f.target_id left join places p on f.target = 'place' and p.id = f.target_id
      where f.status = 'pending' order by f.created_at`),
    findDuplicateGroups(),
  ]);
  const agent = await maybeOne<{ n: number }>(sql`
    select ((select count(*) from events where status = 'pending' and review_note like 'Found by agent%')
          + (select count(*) from places where status = 'pending' and review_note like 'Found by agent%'))::int as n`);
  return (
    <div className="space-y-10">
      <div>
        <h1 className="display text-5xl">Submissions</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-3">
          Events and places suggested by members. Check each one against an official source before approving — nothing is shown publicly until you do.
        </p>
        {agent && agent.n > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ActionButton
              action={approveAgentFindsAction}
              className="btn btn-primary"
              confirm={`Publish all ${agent.n} finds from your research agents?`}
            >
              <Check size={16} aria-hidden="true" /> Approve all agent finds ({agent.n})
            </ActionButton>
            <span className="text-xs text-ink-3">Places are pinned from their address first; any that can’t be pinned stay here.</span>
          </div>
        ) : null}
      </div>
      {fixes.length ? (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="display text-3xl">Suggested fixes ({fixes.length})</h2>
            <ActionButton action={applyAllFixesAction} className="btn btn-primary btn-sm" confirm={`Apply all ${fixes.length} fixes from the freshness checker?`}>
              <Check size={14} aria-hidden="true" /> Apply all
            </ActionButton>
          </div>
          <ul className="space-y-3">
            {fixes.map((f) => (
              <li key={f.id} className="card flex flex-wrap items-start gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    <Link href={`/admin/${f.target === 'event' ? 'events' : 'places'}/${f.target_id}`} className="link">{f.name ?? 'Removed item'}</Link>
                  </p>
                  <p className="text-sm text-ink-2">{f.reason}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    Change: {Object.entries(f.changes).map(([k, v]) => `${k.replace('_', ' ')} → ${v === null ? 'remove' : String(v)}`).join(' · ')}
                    {f.source_url ? <> · <a href={f.source_url} target="_blank" rel="noreferrer nofollow" className="link">source</a></> : null}
                  </p>
                </div>
                <div className="flex gap-2">
                  <ActionButton action={dismissFixAction.bind(null, f.id)}>Dismiss</ActionButton>
                  <ActionButton action={applyFixAction.bind(null, f.id)} className="btn btn-primary btn-sm"><Check size={14} aria-hidden="true" /> Apply</ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {dupGroups.length ? (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="display text-3xl">Possible duplicates ({dupGroups.length})</h2>
            <ActionButton action={mergeAllDuplicatesAction} className="btn btn-primary btn-sm" confirm={`Merge all ${dupGroups.length} groups, keeping the best listing of each?`}>
              <Copy size={14} aria-hidden="true" /> Merge all
            </ActionButton>
          </div>
          <ul className="space-y-3">
            {dupGroups.map(([keep, ...drop]) => (
              <li key={keep.id} className="card flex flex-wrap items-start gap-4 p-5">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">Keep: <Link href={`/admin/events/${keep.id}`} className="link">{keep.title}</Link></p>
                  <p className="text-ink-3">{formatShortDate(keep.starts_at)} · {getCity(keep.city_slug)?.name}</p>
                  <ul className="mt-1 text-ink-3">
                    {drop.map((d) => <li key={d.id}>Set aside: <Link href={`/admin/events/${d.id}`} className="link">{d.title}</Link> ({d.status})</li>)}
                  </ul>
                </div>
                <ActionButton action={mergeDuplicatesAction.bind(null, keep.id, drop.map((d) => d.id))} className="btn btn-primary btn-sm"><Copy size={14} aria-hidden="true" /> Merge</ActionButton>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">The kept listing takes over any photos, ticket link or description it lacks, and people who saved a copy keep it saved.</p>
        </section>
      ) : null}
      <section>
        <h2 className="display mb-3 text-3xl">Events ({events.length})</h2>
        {events.length === 0 ? (
          <p className="card px-5 py-6 text-sm text-ink-3">No events waiting for review.</p>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="card p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{e.title}</p>
                    <p className="text-sm text-ink-3">
                      {formatShortDate(e.starts_at)} {e.time_tbc ? 'Time TBC' : formatTime(e.starts_at)} · {[e.venue_name, getCity(e.city_slug)?.name].filter(Boolean).join(', ')}
                    </p>
                    {e.description ? <p className="mt-2 line-clamp-3 text-sm text-ink-2">{e.description}</p> : null}
                    <p className="mt-2 text-xs text-ink-3">
                      From {e.email ?? 'a deleted account'} · {timeAgo(e.created_at)}
                      {e.ticket_url ? (
                        <>
                          {' · '}
                          <a href={e.ticket_url} target="_blank" rel="noreferrer nofollow" className="link">
                            check the listing
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/admin/events/${e.id}`} className="btn btn-ghost btn-sm">
                      <Pencil size={14} aria-hidden="true" /> Edit
                    </Link>
                    <RejectButton action={rejectWithReasonAction.bind(null, 'event', e.id)} reasons={REJECT_REASONS} />
                    <ActionButton action={setEventStatusAction.bind(null, e.id, 'published', 'Approved')} className="btn btn-primary btn-sm" success="Approved and published">
                      <Check size={14} aria-hidden="true" /> Approve
                    </ActionButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="display mb-3 text-3xl">Places ({places.length})</h2>
        {places.length === 0 ? (
          <p className="card px-5 py-6 text-sm text-ink-3">No places waiting for review.</p>
        ) : (
          <ul className="space-y-3">
            {places.map((p) => (
              <li key={p.id} className="card p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-ink-3">{[p.category_slug, p.address, p.city].filter(Boolean).join(' · ')}</p>
                    {p.description ? <p className="mt-2 line-clamp-3 text-sm text-ink-2">{p.description}</p> : null}
                    <p className="mt-2 text-xs text-ink-3">
                      From {p.email ?? 'a deleted account'} · {timeAgo(p.created_at)}
                      {p.website ? (
                        <>
                          {' · '}
                          <a href={p.website} target="_blank" rel="noreferrer nofollow" className="link">
                            website
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/admin/places/${p.id}`} className="btn btn-ghost btn-sm">
                      <Pencil size={14} aria-hidden="true" /> Edit
                    </Link>
                    <RejectButton action={rejectWithReasonAction.bind(null, 'place', p.id)} reasons={REJECT_REASONS} />
                    <ActionButton action={setPlaceStatusAction.bind(null, p.id, 'published', 'Approved')} className="btn btn-primary btn-sm" success="Approved and published">
                      <Check size={14} aria-hidden="true" /> Approve
                    </ActionButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
