const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'skin-images';

// Camada de dados. Toda a lógica de banco fica nas funções SQL de
// supabase/migrations; aqui só chamamos essas funções e o Storage.
//
// `rpc(nome, args)` deve resolver com o retorno da função SQL.
// `storage` precisa de upload(path, buffer, contentType), remove(paths) e publicUrl(path).
function createStore({ rpc, storage }) {
  const withUrls = (skin) => skin && { ...skin, images: skin.images.map((p) => storage.publicUrl(p)) };

  return {
    async listSkins({ q, tag, sort, limit, offset, voter }) {
      const data = await rpc('list_skins', { p_q: q, p_tag: tag, p_sort: sort, p_limit: limit, p_offset: offset, p_voter: voter });
      return { total: Number(data.total), skins: data.skins.map(withUrls) };
    },
    async getSkin(id, voter) {
      return withUrls(await rpc('get_skin', { p_id: id, p_voter: voter }));
    },
    async createSkin({ name, code, author, description, images, tags }) {
      return withUrls(
        await rpc('create_skin', {
          p_name: name,
          p_code: code,
          p_author: author,
          p_description: description,
          p_images: images,
          p_tags: tags,
        }),
      );
    },
    incrementCopies: (id) => rpc('increment_copies', { p_id: id }),
    toggleLike: (id, voter) => rpc('toggle_like', { p_id: id, p_voter: voter }),
    deleteSkin: (id) => rpc('delete_skin', { p_id: id }),
    topTags: () => rpc('top_tags', { p_limit: 20 }),
    uploadImage: (path, buffer, contentType) => storage.upload(path, buffer, contentType),
    removeImages: (paths) => (paths.length ? storage.remove(paths) : Promise.resolve()),
  };
}

function createSupabaseStore({ url, serviceRoleKey }) {
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = client.storage.from(BUCKET);

  const unwrap = ({ data, error }) => {
    if (error) throw new Error(`Supabase: ${error.message}`);
    return data;
  };

  return createStore({
    rpc: async (name, args) => unwrap(await client.rpc(name, args)),
    storage: {
      upload: async (path, buffer, contentType) =>
        unwrap(await bucket.upload(path, buffer, { contentType, cacheControl: '2592000', upsert: false })),
      remove: async (paths) => unwrap(await bucket.remove(paths)),
      publicUrl: (path) => bucket.getPublicUrl(path).data.publicUrl,
    },
  });
}

module.exports = { createStore, createSupabaseStore, BUCKET };
