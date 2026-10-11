import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { audio } from './audio/audioManager';
import type { BgmKey, LoopBgmKey } from './audio/soundMap';
import { ROUTE_BGM } from './audio/routeBgm';
import { tabGuard } from './tabLock/tabGuard';
import type { BattleSetup } from './battle/setup';
import { stageByNo } from './story/story';
import { setPendingNotice } from './online/rate';
import { AdminKeys } from './scenes/Admin/AdminLogin';
import { resolvePendingMatches, setFriendNotice } from './online/pendingMatch';
import { useSave } from './state/SaveContext';
import { setLang } from './i18n';
import { NavContext, type Nav, type RouteId, isDebugMode } from './router';
import { Stage } from './ui/common/Stage';
import { RotateHint } from './ui/common/RotateHint';
import { PageTurn, turnPage } from './ui/common/PageTurn';
import { TitleScene } from './scenes/Title/TitleScene';
import { MenuScene } from './scenes/Menu/MenuScene';
import { DeckEditScene } from './scenes/DeckEdit/DeckEditScene';
import { SettingsScene } from './scenes/Settings/SettingsScene';
import { BattleScene } from './scenes/Battle/BattleScene';
import { ResultScene } from './scenes/Result/ResultScene';
import { DebugScene } from './scenes/Debug/DebugScene';
import { LobbyScene } from './scenes/Lobby/LobbyScene';
import { CpuScene } from './scenes/Cpu/CpuScene';
import { FxTestScene } from './scenes/Debug/FxTestScene';
import { SoundTestScene } from './scenes/Debug/SoundTestScene';
import { CardLabScene } from './scenes/Debug/CardLabScene';
import { GachaScene } from './scenes/Gacha/GachaScene';
import { RulesScene } from './scenes/Rules/RulesScene';
import { TutorialScene } from './scenes/Tutorial/TutorialScene';
import { NameScene } from './scenes/Name/NameScene';
import { LangScene } from './scenes/Lang/LangScene';
import { PostGuide, usePostState } from './scenes/Tutorial/PostGuide';
import { SandboxSaveProvider } from './state/SaveContext';
import { offerById } from './gacha/gacha';
import { TUTORIAL_OFFER } from './scenes/Tutorial/PostGuide';
import { OnlineScene } from './scenes/Online/OnlineScene';
import { RateScene } from './scenes/Online/RateScene';
import { StoryScene } from './scenes/Story/StoryScene';
import { TradeScene } from './scenes/Trade/TradeScene';
import { RankingScene } from './scenes/Ranking/RankingScene';
import { AdminScene } from './scenes/Admin/AdminScene';
import { SpectateScene } from './scenes/Admin/SpectateScene';
import { features } from './config/features';
import { flushReports, syncRanking } from './online/rankingApi';
import { checkMailbox } from './online/mailbox';

/**
 * ルーター：行き先 → 画面 の対応表（SPEC §3、§13-5）
 */
const ROUTES: Record<RouteId, ComponentType> = {
  title: TitleScene,
  menu: MenuScene,
  deck: DeckEditScene,
  lobby: LobbyScene,
  cpu: CpuScene,
  battle: BattleScene,
  result: ResultScene,
  settings: SettingsScene,
  rules: RulesScene,
  debug: DebugScene,
  fxtest: FxTestScene,
  soundtest: SoundTestScene,
  cardlab: CardLabScene,
  // 🔒 後で実装
  story: StoryScene,
  gacha: GachaScene,
  tutorial: TutorialScene,
  name: NameScene,
  lang: LangScene,
  online: OnlineScene,
  trade: TradeScene,
  ranking: RankingScene,
  rate: RateScene,
  admin: AdminScene,
  spectate: SpectateScene,
};

/** 対戦の曲：ストーリーのボス戦は ボス別の曲 → ボスの曲 → 戦闘曲（置いてある曲を使う。SPEC §7 S08） */
function battleBgm(setup: BattleSetup | null): BgmKey {
  const boss = setup?.story ? stageByNo(setup.story.stage)?.boss : undefined;
  if (!boss) return 'battle';
  const own = `bgm_boss_${boss}` as LoopBgmKey;
  if (audio.hasBgm(own)) return own;
  return audio.hasBgm('bgm_boss') ? 'bgm_boss' : 'battle';
}

export function App() {
  const [nav, setNav] = useState<{ route: RouteId; payload: unknown; n: number }>({ route: 'title', payload: null, n: 0 });
  const go = useCallback((to: RouteId, payload?: unknown) => {
    // ノートのページが右下からめくれる（いまの画面を写し取ってからめくる）
    turnPage(document.querySelector<HTMLElement>('.stage'));
    setNav((cur) => ({ route: to, payload: payload ?? null, n: cur.n + 1 }));
  }, []);
  const value = useMemo<Nav>(() => ({ route: nav.route, payload: nav.payload, go }), [nav, go]);
  // デバッグ（?debug=1）の時だけ、確認用の自動操作（scripts/shots-*.mjs）が画面を直接開けるようにする
  useEffect(() => {
    if (!isDebugMode()) return;
    const w = window as unknown as { __otecaGo?: typeof go };
    w.__otecaGo = go;
    return () => {
      delete w.__otecaGo;
    };
  }, [go]);
  const Scene = ROUTES[nav.route];
  const { save } = useSave();
  // ことば：React の外（演出・対戦ログ）でも今の言語の辞書を使えるように、描く前に知らせる（SPEC §6-4b）
  setLang(save.settings.lang);

  // 前のオンライン対戦が とちゅうで終わっていた（ページを閉じた・読み込み直した・通信が切れたまま閉じた）：起動した時に負けとして計算する（SPEC §7 S15・§11-7）
  const { update } = useSave();
  useEffect(() => {
    if (!save.pendingRateMatch && !save.pendingFriendMatch) return;
    const now = Date.now();
    const res = resolvePendingMatches(structuredClone(save), { ranking: features.ranking, now });
    setPendingNotice(res.rate);
    setFriendNotice(res.friend);
    update((d) => void resolvePendingMatches(d, { ranking: features.ranking, now }));
  }, []);

  // ランキング（v2.0-I。SPEC §7 S15）：起動した時に、送れなかった結果の報告を送り直し、
  // 次の更新（毎日 4:00 と 16:00）の後なら正式なレートで上書きする。名前・「ランキングに のる」がサーバーと違えば知らせる
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!features.ranking) return;
    // playerId は起動した時に作るので、少し待ってから
    // 登録できたら、トロフィーの郵便受けも確かめる（v2.0-J。届いていればメニューで演出）
    const id = window.setTimeout(
      () =>
        void syncRanking(() => saveRef.current, update).then((who) => {
          if (!who) return;
          const cur = saveRef.current;
          void checkMailbox({ ...cur, userId: who.userId, userIdRegistered: true, ranking: { ...cur.ranking, token: who.token } }, update);
        }),
      1500,
    );
    return () => window.clearTimeout(id);
  }, []);
  // 送れなかった報告が増えた（レート対戦が終わった）：すぐ送る。送れなければ次に開いた時・次の試合の後
  useEffect(() => {
    if (features.ranking && save.ranking.unsent.length) void flushReports(() => saveRef.current, update);
  }, [save.ranking.unsent.length]);

  // 画面に触ったら、いつでも音を有効にし直す（スマホで裏に回して戻った時など）
  useEffect(() => {
    // iPhone は touchend・click でないと再開を許さないことがあるので、いくつかの操作で試す
    const on = () => audio.unlock();
    const kinds = ['pointerdown', 'touchend', 'click', 'keydown'] as const;
    kinds.forEach((k) => document.addEventListener(k, on, { capture: true, passive: true }));
    // アプリを切り替えて戻った時（画面が見えるようになった時）も再開を試す（だめでも次に触れば再開する）
    const onVisible = () => {
      if (document.visibilityState === 'visible') audio.unlock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      kinds.forEach((k) => document.removeEventListener(k, on, { capture: true }));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // 音量は設定の値（0〜10）
  useEffect(() => audio.setVolumes(save.settings.bgm, save.settings.se), [save.settings.bgm, save.settings.se]);
  // 画面が変わったら BGM を切り替える（0.8秒のクロスフェード）
  useEffect(() => {
    const bgm = nav.route === 'battle' ? battleBgm(nav.payload as BattleSetup | null) : ROUTE_BGM[nav.route];
    if (bgm !== undefined) audio.playBgm(bgm);
  }, [nav.route, nav.payload]);
  // 対戦中かを「いまのタブ」の札に書く（ほかのタブで「この タブで あそぶ」を押した時の確認に使う。v2.3）
  useEffect(() => {
    tabGuard.setBattle(nav.route === 'battle' && (nav.payload as BattleSetup | null)?.mode !== 'spectate');
    return () => tabGuard.setBattle(false);
  }, [nav.route, nav.payload]);

  // チュートリアルの延長（UPDATE_v2_1 §6-2）。見返しの時は、練習用の写しのセーブで動かす（コインは減らない・保存しない。§6-3）
  const post = usePostState();
  const screen = (
    <>
      <Scene key={`${nav.route}-${nav.n}`} />
      <PostGuide />
    </>
  );
  return (
    <NavContext.Provider value={value}>
      <Stage>
        {post.active && post.review ? (
          <SandboxSaveProvider keepCoins={Math.max(save.coins, offerById(TUTORIAL_OFFER)?.price ?? 0)}>{screen}</SandboxSaveProvider>
        ) : (
          screen
        )}
      </Stage>
      <PageTurn />
      <RotateHint />
      {/* 管理画面の入り口：O と T の同時押し（v2.4。SPEC §7 S20） */}
      <AdminKeys route={nav.route} />
    </NavContext.Provider>
  );
}
