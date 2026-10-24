-- Just Volleyball Skins: esquema do banco.
-- Rode este arquivo uma vez no SQL Editor do Supabase.
--
-- O acesso aos dados é feito só pelo servidor (chave service_role), por isso
-- o RLS fica ligado sem políticas públicas: a chave anon não lê nem escreve.

create table if not exists public.skins (
  id          bigint generated always as identity primary key,
  name        text        not null check (char_length(name) between 1 and 60),
  code        text        not null check (char_length(code) between 1 and 4000),
  author      text        not null default '' check (char_length(author) <= 40),
  description text        not null default '' check (char_length(description) <= 500),
  copies      integer     not null default 0,
  likes       integer     not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.skin_images (
  id       bigint generated always as identity primary key,
  skin_id  bigint  not null references public.skins(id) on delete cascade,
  path     text    not null,
  position integer not null default 0
);

create table if not exists public.skin_tags (
  skin_id bigint not null references public.skins(id) on delete cascade,
  tag     text   not null check (char_length(tag) between 1 and 24),
  primary key (skin_id, tag)
);

create table if not exists public.skin_likes (
  skin_id bigint not null references public.skins(id) on delete cascade,
  voter   text   not null,
  primary key (skin_id, voter)
);

create table if not exists public.rate_limits (
  key text        not null,
  at  timestamptz not null default now()
);

create index if not exists skin_images_skin_idx on public.skin_images (skin_id, position);
create unique index if not exists skin_images_path_key on public.skin_images (path);
create index if not exists rate_limits_key_idx on public.rate_limits (key, at);
create index if not exists skin_tags_tag_idx on public.skin_tags (tag);
create index if not exists skins_copies_idx on public.skins (copies desc, id desc);
create index if not exists skins_likes_idx on public.skins (likes desc, id desc);

alter table public.skins       enable row level security;
alter table public.skin_images enable row level security;
alter table public.skin_tags   enable row level security;
alter table public.skin_likes  enable row level security;
alter table public.rate_limits enable row level security;

-- Converte uma skin em JSON no formato usado pela API.
create or replace function public.skin_json(s public.skins, p_voter text)
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'code', s.code,
    'author', s.author,
    'description', s.description,
    'copies', s.copies,
    'likes', s.likes,
    'liked', exists (select 1 from skin_likes l where l.skin_id = s.id and l.voter = p_voter),
    'createdAt', s.created_at,
    'images', coalesce((select jsonb_agg(i.path order by i.position) from skin_images i where i.skin_id = s.id), '[]'::jsonb),
    'tags', coalesce((select jsonb_agg(t.tag order by t.tag) from skin_tags t where t.skin_id = s.id), '[]'::jsonb)
  );
$$;

create or replace function public.list_skins(
  p_q text default '',
  p_tag text default '',
  p_sort text default 'recent',
  p_limit integer default 24,
  p_offset integer default 0,
  p_voter text default ''
)
returns jsonb
language sql stable
set search_path = public
as $$
  with filtered as (
    select s
    from skins s
    where (
        coalesce(p_q, '') = ''
        or s.name        ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or s.author      ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or s.description ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        or s.code = p_q
      )
      and (coalesce(p_tag, '') = '' or exists (select 1 from skin_tags t where t.skin_id = s.id and t.tag = p_tag))
  ),
  page as (
    select f.s, row_number() over (
      order by
        case when p_sort = 'popular' then (f.s).copies end desc nulls last,
        case when p_sort = 'likes' then (f.s).likes end desc nulls last,
        (f.s).id desc
    ) as rn
    from filtered f
    order by rn
    limit greatest(p_limit, 0) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'skins', coalesce((select jsonb_agg(skin_json(p.s, p_voter) order by p.rn) from page p), '[]'::jsonb)
  );
$$;

create or replace function public.get_skin(p_id bigint, p_voter text default '')
returns jsonb
language sql stable
set search_path = public
as $$
  select skin_json(s, p_voter) from skins s where s.id = p_id;
$$;

create or replace function public.create_skin(
  p_name text,
  p_code text,
  p_author text,
  p_description text,
  p_images text[],
  p_tags text[]
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  new_id bigint;
begin
  insert into skins (name, code, author, description)
  values (p_name, p_code, coalesce(p_author, ''), coalesce(p_description, ''))
  returning id into new_id;

  insert into skin_images (skin_id, path, position)
  select new_id, img.path, img.ord - 1
  from unnest(p_images) with ordinality as img(path, ord);

  insert into skin_tags (skin_id, tag)
  select distinct new_id, t from unnest(coalesce(p_tags, '{}')) as t
  on conflict do nothing;

  return get_skin(new_id, '');
end;
$$;

-- Retorna o novo total de cópias, ou null se a skin não existir.
create or replace function public.increment_copies(p_id bigint)
returns integer
language sql
set search_path = public
as $$
  update skins set copies = copies + 1 where id = p_id returning copies;
$$;

-- Alterna a curtida de um visitante. Retorna null se a skin não existir.
create or replace function public.toggle_like(p_id bigint, p_voter text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  was_liked boolean;
  total integer;
begin
  perform 1 from skins where id = p_id for update;
  if not found then
    return null;
  end if;

  delete from skin_likes where skin_id = p_id and voter = p_voter;
  was_liked := found;
  if not was_liked then
    insert into skin_likes (skin_id, voter) values (p_id, p_voter);
  end if;

  update skins set likes = (select count(*) from skin_likes where skin_id = p_id)
  where id = p_id
  returning likes into total;

  return jsonb_build_object('liked', not was_liked, 'likes', total);
end;
$$;

-- Apaga a skin e retorna os caminhos das imagens para remover do Storage.
-- Retorna null se a skin não existir.
create or replace function public.delete_skin(p_id bigint)
returns text[]
language plpgsql
set search_path = public
as $$
declare
  paths text[];
begin
  select coalesce(array_agg(path), '{}') into paths from skin_images where skin_id = p_id;
  delete from skins where id = p_id;
  if not found then
    return null;
  end if;
  return paths;
end;
$$;

create or replace function public.top_tags(p_limit integer default 20)
returns jsonb
language sql stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('tag', tag, 'count', n) order by n desc, tag), '[]'::jsonb)
  from (
    select tag, count(*) as n from skin_tags group by tag order by n desc, tag limit p_limit
  ) t;
$$;

-- Registra uma tentativa para `p_key` e diz se ainda está dentro do limite
-- de `p_max` tentativas na janela de `p_window_seconds`.
create or replace function public.hit_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  recent integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_key));
  delete from rate_limits where key = p_key and at < now() - make_interval(secs => p_window_seconds);
  select count(*) into recent from rate_limits where key = p_key;
  if recent >= p_max then
    return false;
  end if;
  insert into rate_limits (key) values (p_key);
  return true;
end;
$$;

-- As funções só podem ser chamadas pelo servidor.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'skin_json(public.skins, text)',
    'list_skins(text, text, text, integer, integer, text)',
    'get_skin(bigint, text)',
    'create_skin(text, text, text, text, text[], text[])',
    'increment_copies(bigint)',
    'toggle_like(bigint, text)',
    'delete_skin(bigint)',
    'top_tags(integer)',
    'hit_rate_limit(text, integer, integer)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function public.%s from anon, authenticated', fn);
      execute format('grant execute on function public.%s to service_role', fn);
    end if;
  end loop;
end;
$$;

-- Bucket público para as imagens (só existe no Supabase).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('skin-images', 'skin-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    on conflict (id) do nothing;
  end if;
end;
$$;
