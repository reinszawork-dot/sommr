import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarPlus, Camera, CheckCircle2, Ticket } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';

export const metadata: Metadata = {
  title: 'List your event',
  description: 'Running a market, gig, festival or summer event in South Africa? List it on SOMMR for free.',
};

const STEPS = [
  { Icon: CalendarPlus, title: 'Tell us about it', text: 'Name, date and time, venue and town. If the time isn’t set yet, tick “time not announced”.' },
  { Icon: Ticket, title: 'Add your link', text: 'Your ticket page (Quicket, Howler, Webtickets…) or your own event page. People buy straight from you.' },
  { Icon: Camera, title: 'Add your photos', text: 'Up to three photos or your poster, so people can see what it looks like.' },
  { Icon: CheckCircle2, title: 'We check it, it goes live', text: 'We confirm the details against your link, usually within a day. Listing is free.' },
];

export default function OrganisersPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 pb-16 pt-6 sm:px-8">
      <Link href="/" className="inline-block" aria-label="SOMMR home">
        <Logo />
      </Link>
      <p className="eyebrow mt-12">For organisers</p>
      <h1 className="display mt-2 text-5xl sm:text-6xl">List your event on SOMMR</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-2">
        Running a market, gig, festival, braai day or anything worth going to this summer? SOMMR helps South Africans find what’s on near them.
        Listing your event is free.
      </p>
      <ol className="mt-10 grid gap-4 sm:grid-cols-2">
        {STEPS.map(({ Icon, title, text }) => (
          <li key={title} className="card p-5">
            <Icon size={20} className="text-sun-deep" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-ink-3">{text}</p>
          </li>
        ))}
      </ol>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/submit/event" className="btn btn-primary btn-lg">List your event</Link>
        <Link href="/register" className="btn btn-ghost btn-lg">Create a free account first</Link>
      </div>
      <p className="mt-4 text-sm text-ink-3">You need a free SOMMR account to list events, so we can reach you if a detail needs checking.</p>
    </main>
  );
}
