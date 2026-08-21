-- Dashboard grid moved from 24 to 48 columns; double x/w so stored layouts
-- keep their proportions. Row count/height semantics are unchanged.
UPDATE "dashboards" SET "widgets" = (
  SELECT COALESCE(jsonb_agg(
    jsonb_set(jsonb_set(elem,
      '{layout,x}', to_jsonb((elem#>>'{layout,x}')::int * 2)),
      '{layout,w}', to_jsonb((elem#>>'{layout,w}')::int * 2))
  ), '[]'::jsonb)
  FROM jsonb_array_elements("widgets") elem
) WHERE "widgets" != '[]'::jsonb;
