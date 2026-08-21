-- Widgets moved from flat {id,type,x,y,w,h} to {id,type,config,layout:{x,y,w,h}}
-- (config validated by the web registry). Reshape rows stored before the change.
UPDATE "dashboards" SET "widgets" = (
  SELECT COALESCE(jsonb_agg(
    CASE WHEN elem ? 'layout' THEN elem
    ELSE jsonb_build_object(
      'id', elem->'id',
      'type', elem->'type',
      'config', '{}'::jsonb,
      'layout', jsonb_build_object('x', elem->'x', 'y', elem->'y', 'w', elem->'w', 'h', elem->'h')
    ) END), '[]'::jsonb)
  FROM jsonb_array_elements("widgets") elem
) WHERE "widgets" @> '[]'::jsonb AND "widgets" != '[]'::jsonb;
