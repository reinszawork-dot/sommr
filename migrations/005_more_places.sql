-- More things to see and do: new map categories (filled from OpenStreetMap via Geoapify)
-- and Wikivoyage "See" / "Do" listings as a place source.
alter table places drop constraint places_source_check;
alter table places add constraint places_source_check check (source in ('osm', 'admin', 'community', 'wikivoyage'));

insert into categories (slug, kind, label, description, icon, color, osm_filters, sort) values
  ('museums', 'place', 'Museums & galleries', 'Museums, art galleries and planetariums.', 'landmark', '#8a5a44', '{tourism=museum,tourism=gallery,amenity=planetarium}', 40),
  ('animals', 'place', 'Zoos & aquariums', 'Zoos, aquariums and animal parks.', 'paw-print', '#5f8a3a', '{tourism=zoo,tourism=aquarium}', 41),
  ('swimming', 'place', 'Swimming', 'Public pools for a summer dip.', 'droplets', '#3a8fb7', '{leisure=swimming_pool}', 42),
  ('wine', 'place', 'Wine & craft beer', 'Wine farms and craft breweries.', 'wine', '#8e2f4f', '{craft=winery,craft=brewery}', 43),
  ('fun', 'place', 'Fun & games', 'Mini-golf, escape rooms, trampoline parks, climbing and arcades.', 'gamepad-2', '#7b4fc4', '{leisure=miniature_golf,leisure=escape_game,leisure=trampoline_park,sport=climbing,leisure=amusement_arcade}', 44),
  ('hiking', 'place', 'Peaks & parks', 'Mountain peaks and national parks.', 'mountain-snow', '#4f6f52', '{natural=peak,boundary=national_park}', 45),
  ('sights', 'place', 'Sights to see', 'The sights travellers recommend, from Wikivoyage.', 'camera', '#b5643c', '{}', 46),
  ('activities', 'place', 'Things to do', 'Activities travellers recommend, from Wikivoyage.', 'compass', '#c48a2c', '{}', 47)
on conflict (slug) do nothing;
