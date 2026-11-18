/** South African ticketing sites: a link here is a real "Get tickets" link, not just a listing article. */
const TICKET_SITES = /^https?:\/\/([a-z0-9-]+\.)*(quicket\.co\.za|howler\.co\.za|webtickets\.co\.za|computicket\.com|ticketmaster\.co\.za|ticketpro\.co\.za|plankton\.mobi|tixsa\.co\.za|itickets\.co\.za|nutickets\.co\.za)\//i;

export const isTicketSite = (url: string | null | undefined): boolean => !!url && TICKET_SITES.test(url);
