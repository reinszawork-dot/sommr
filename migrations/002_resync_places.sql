-- Place cells fetched before Geoapify paging kept only the first 500 places per cell
-- (coffee shops and braai spots were often cut off). Forget them so they're fetched again in full.
delete from place_sync_cells;
