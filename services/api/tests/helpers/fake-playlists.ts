import type { PlaylistsRepo } from "../../src/repo";

/** 测试用 playlists fake：全部方法就绪（需要覆写行为时用 {...fakePlaylistsRepo(), ...} 展开）。 */
export function fakePlaylistsRepo(): PlaylistsRepo {
  return {
    create: async () => ({ id: "pl-1", slug: "abc12345" }),
    listPublic: async () => [],
    listEditor: async () => [],
    getPublicBySlug: async () => null,
    getById: async () => null,
    listFavorites: async () => [],
    isFavorite: async () => false,
    addFavorite: async () => ({ added: true }),
    removeFavorite: async () => {},
    update: async () => {},
    getPublicCover: async () => null,
    getOrCreateDefault: async () => ({ id: "pl-default" }),
    remove: async () => {},
    listEpisodes: async () => [],
    addEpisode: async () => ({ added: true }),
    removeEpisode: async () => {},
    reorder: async () => {},
    listByEpisode: async () => [],
  };
}