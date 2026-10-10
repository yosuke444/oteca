import files from 'virtual:image-files';

/**
 * 置いてある絵（public/images・public/packs・public/story・public/cards）。無い絵は読みに行かず仮表示にする（公開サイトで 404 を出さない）。
 * @param path 例 'images/coin.png'
 * @returns 絵の URL。無ければ null
 */
export function imageUrl(path: string): string | null {
  return files.includes(path) ? `${import.meta.env.BASE_URL}${path}` : null;
}
