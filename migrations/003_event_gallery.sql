-- Extra photos for an event (the first photo stays in image_url). Links to the organiser's own images.
alter table events add column gallery text[] not null default '{}';
