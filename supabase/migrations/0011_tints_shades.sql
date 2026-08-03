-- Sixteen families of five.
--
-- Long-pressing a swatch fans out its two shades and two tints, so the bar
-- still shows sixteen while eighty colours are reachable through it. They are
-- stored rather than derived at submit time because the server has to be able
-- to say yes or no to a colour without trusting the client's maths — and
-- tests/colour.spec.ts asserts the client derives byte-identical values.

alter table public.palette_colors
  add column if not exists base_idx smallint,
  add column if not exists step     smallint not null default 0;

-- Reference data with no foreign keys pointing at it; layers record colours as
-- hex, not as a row reference. Replacing wholesale avoids renumbering into a
-- collision with the ids already there.
delete from public.palette_colors;

insert into public.palette_colors (idx, hex, base_idx, step) values
  (3,'#0E0D0C',0,-2), (4,'#141311',0,-1), (0,'#1B1A17',0,0), (6,'#656157',0,1), (7,'#A09D93',0,2),
  (13,'#2E2C28',1,-2), (14,'#43413B',1,-1), (10,'#5B5850',1,0), (16,'#8F8B81',1,1), (17,'#B8B6B1',1,2),
  (23,'#504C44',2,-2), (24,'#767164',2,-1), (20,'#9C978B',2,0), (26,'#B9B6AE',2,1), (27,'#D3D1CD',2,2),
  (33,'#C39833',3,-2), (34,'#DFC78D',3,-1), (30,'#FBF8F1',3,0), (36,'#F9F5EC',3,1), (37,'#F8F4ED',3,2),
  (43,'#551C19',4,-2), (44,'#7C2A26',4,-1), (40,'#A73A34',4,0), (46,'#C96E69',4,1), (47,'#D9A7A5',4,2),
  (53,'#792C12',5,-2), (54,'#B1421C',5,-1), (50,'#DD6238',5,0), (56,'#E19479',5,1), (57,'#E8BEAF',5,2),
  (63,'#82540E',6,-2), (64,'#BE7C18',6,-1), (60,'#E5A23C',6,0), (66,'#E7BD7C',6,1), (67,'#EBD4B1',6,2),
  (73,'#5E441C',7,-2), (74,'#89642B',7,-1), (70,'#B8873C',7,0), (76,'#CCAB77',7,1), (77,'#DCC9AD',7,2),
  (83,'#3E4623',8,-2), (84,'#5C6734',8,-1), (80,'#7C8A47',8,0), (86,'#A7B477',8,1), (87,'#C6CDAC',8,2),
  (93,'#233C27',9,-2), (94,'#35583A',9,-1), (90,'#48764F',9,0), (96,'#77A77E',9,1), (97,'#ABC6AF',9,2),
  (103,'#153E3A',10,-2), (104,'#205B56',10,-1), (100,'#2C7A73',10,0), (106,'#54BAB0',10,1), (107,'#98CFCA',10,2),
  (113,'#1D3145',11,-2), (114,'#2B4965',11,-1), (110,'#3B6288',11,0), (116,'#6A91B8',11,1), (117,'#A4BACF',11,2),
  (123,'#151C3A',12,-2), (124,'#1F2B55',12,-1), (120,'#2B3A72',12,0), (126,'#5166B6',12,1), (127,'#96A2CD',12,2),
  (133,'#352542',13,-2), (134,'#4E3761',13,-1), (130,'#6A4B82',13,0), (136,'#987AAE',13,1), (137,'#BEAECA',13,2),
  (143,'#56213C',14,-2), (144,'#7E3259',14,-1), (140,'#A94578',14,0), (146,'#C47CA1',14,1), (147,'#D7B0C4',14,2),
  (153,'#983628',15,-2), (154,'#CE5D4D',15,-1), (150,'#E3A59C',15,0), (156,'#E9C2BC',15,1), (157,'#EFDAD7',15,2);

alter table public.palette_colors alter column base_idx set not null;
create index if not exists palette_family_idx on public.palette_colors (base_idx, step);

comment on table public.palette_colors is
  'Sixteen families of five. step 0 is the swatch shown in the bar; -2..2 are the shades and tints behind a long press. All eighty are legal ink.';

-- The bar shows the sixteen. Tints are reached through them, not listed beside
-- them, so a turn palette stays a list of families.
create or replace function public.inherited_palette(
  p_used  jsonb,
  p_seed  text,
  p_extra int default 2,
  p_floor int default 16
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  master text[]; have text[]; unused text[]; fresh text[]; result text[];
  want int; take int; origin int;
begin
  select array_agg(hex order by base_idx) into master
    from public.palette_colors where step = 0;

  select array_agg(m order by i) into have
    from unnest(master) with ordinality as t(m, i)
   where m in (select jsonb_array_elements_text(coalesce(p_used, '[]'::jsonb)));

  if have is null or array_length(have, 1) is null then
    return to_jsonb(master);
  end if;

  select array_agg(m order by i) into unused
    from unnest(master) with ordinality as t(m, i)
   where not (m = any(have));

  if unused is null or array_length(unused, 1) is null then
    return to_jsonb(master);
  end if;

  want   := greatest(p_extra, p_floor - array_length(have, 1));
  take   := least(greatest(want, 0), array_length(unused, 1));
  origin := (abs(hashtext(coalesce(p_seed, ''))) % array_length(unused, 1))::int;

  select array_agg(unused[1 + ((origin + g) % array_length(unused, 1))]) into fresh
    from generate_series(0, take - 1) g;
  fresh := coalesce(fresh, '{}');

  select array_agg(m order by i) into result
    from unnest(master) with ordinality as t(m, i)
   where m = any(have) or m = any(fresh);

  return to_jsonb(coalesce(result, have));
end
$$;

revoke execute on function public.inherited_palette(jsonb, text, int, int)
  from public, anon, authenticated;
