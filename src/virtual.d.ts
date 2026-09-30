/** 戦闘曲の一覧（vite.config.ts の battleBgm が public/audio/bgm/battle/ を数えて作る。SPEC §10-2） */
declare module 'virtual:battle-bgm' {
  /** id はファイル名から拡張子を除いたもの（例 battle_01）。files は .mp3（と、あれば同名の .ogg） */
  const tracks: { id: string; files: string[] }[];
  export default tracks;
}

/** public/audio/ の中の音のファイル（例 bgm/bgm_title.mp3、se/se_click.mp3）。vite.config.ts の battleBgm が作る */
declare module 'virtual:audio-files' {
  const files: string[];
  export default files;
}
