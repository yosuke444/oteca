import { useEffect, useRef, useState } from 'react';
import { UpdateNote, useOnlineGate } from '../../ui/common/UpdateNotice';
import { checkForUpdate } from '../../update/update';
import { preloadCards } from '../../ui/imageLoader';
import { flushSync } from 'react-dom';
import { SuspensionGate } from '../../ui/common/SuspensionGate';
import { TrophyArrival } from './TrophyArrival';
import { MAILBOX_EVERY_MS, checkMailbox } from '../../online/mailbox';
import { audio } from '../../audio/audioManager';
import { type DailyCarry, claimAllClear, claimMission, claimableCount, cycleKeyAt, drawDailyBags, rollDaily } from '../../daily/daily';
import { addDailyNotice, clearDailyNotice, peekDailyNotice } from '../../daily/noticeStore';
import { CARD_DB } from '../../data/cards';
import { useFx } from '../../fx/fxSettings';
import { type PullResult, cryptoRand } from '../../gacha/gacha';
import type { DailyMissionId } from '../../save/saveData';
import { PrizeCard } from '../../ui/card/PrizeCard';
import { imageUrl } from '../../ui/imageFiles';
import { DailyIcon, DailyPanel } from '../Daily/DailyPanel';
import type { GachaPayload } from '../Gacha/GachaScene';
import '../Daily/daily.css';
import { clearPendingNotice, peekPendingNotice } from '../../online/rate';
import { clearFriendNotice, peekFriendNotice } from '../../online/pendingMatch';
import { loadPendingTrade } from '../../trade/pendingStore';
import { features } from '../../config/features';
import { isDebugMode, useNav } from '../../router';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import { Logo } from '../../ui/common/Logo';
import { Sticky } from '../../ui/common/Sticky';
import { Dialog } from '../../ui/common/Dialog';
import { DiceDoodle, StarDoodle } from '../../ui/common/Doodles';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { useIsSandbox, useSave } from '../../state/SaveContext';
import { needsSuperFix } from '../../save/collection';
import { STEP_FROM_NOTICE } from '../../tutorial/post';
import { useT } from '../../i18n/useT';
import { CoinCounter, centerIn, flyCoins } from '../../ui/coin/Coin';
import { PresentBox } from '../../ui/coin/PresentBox';
import { ECONOMY, canClaimLoginBonus, claimLoginBonus, loginBonusRemainingMs } from '../../economy/rewards';
import { PresentWait } from '../../ui/coin/PresentWait';
import './menu.css';

type LockedId = 'story' | 'gacha' | 'trade' | 'ranking';

/** 「デッキを なおしてね」を、この起動で もう出したか（v2.4） */
let superFixShown = false;

/** S01 メニュー（SPEC §7） */
export function MenuScene() {
  const { go } = useNav();
  const debug = isDebugMode();
  const { save, update, remindBackup } = useSave();
  // トロフィーの郵便受け（v2.0-J）：メニューに来た時と、メニューにいる間10分おきに確かめる
  const mailSave = useRef(save);
  mailSave.current = save;
  useEffect(() => {
    void checkMailbox(mailSave.current, update);
    const id = window.setInterval(() => void checkMailbox(mailSave.current, update), MAILBOX_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);
  const tr = useT();
  // 🔒 じゅんびちゅう のふせんを揺らす合図（押した回数）
  const [shake, setShake] = useState<Record<LockedId, number>>({ story: 0, gacha: 0, trade: 0, ranking: 0 });

  // ログインボーナス（SPEC §7 S11・v2.1-L）：受け取れる時はリボン付きのプレゼントボックス、
  // 受け取った後は空いた箱と、次にもらえるまでの残り時間（1秒ごとの数え直しは PresentWait の中。0 になったら now を進める）
  const [now, setNow] = useState(() => Date.now());
  const fxLayer = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState(false);
  /** コインが飛んでくるまで、コイン表示は前の枚数のままにする */
  const [heldCoins, setHeldCoins] = useState<number | null>(null);
  const claimable = canClaimLoginBonus(save, now);
  const showPresent = features.coins && (opening || claimable);
  // メニューを開いている間に0になった：空いた箱からリボン付きに戻る演出（何回目か＝箱を作り直す印）
  const wasClaimable = useRef(claimable);
  const [reappear, setReappear] = useState(0);
  useEffect(() => {
    if (claimable && !wasClaimable.current && !opening) setReappear((n) => n + 1);
    wasClaimable.current = claimable;
  }, [claimable]);

  // チュートリアルを終えた・とばした人に1回だけ、ガチャのボタンに「コインで パックが ひけるよ」のふせん（UPDATE_v2 §6T-6）
  const [gachaInvite] = useState(() => features.gacha && save.tutorial.done && !save.tutorial.gachaInviteShown);
  useEffect(() => {
    if (gachaInvite) update((d) => void (d.tutorial.gachaInviteShown = true));
  }, []);

  const [pendingTrade] = useState(() => loadPendingTrade());
  const [superFix, setSuperFix] = useState(() => !superFixShown && needsSuperFix(save));
  const closeSuperFix = () => {
    superFixShown = true;
    setSuperFix(false);
  };
  // 前のレート対戦が とちゅうで終わって負けになった（v2.0-G。1回だけ）
  const [rateNotice, setRateNotice] = useState(() => peekPendingNotice());
  // 前のフレンド対戦が とちゅうで終わって負けになった（v2.4。1回だけ）
  const [friendNotice, setFriendNotice] = useState(() => peekFriendNotice());
  useEffect(() => {
    if (sandbox) return;
    clearPendingNotice();
    clearFriendNotice();
  }, []);

  // デイリーミッション（SPEC §7 S17・v2.1-M）：開いた時に「その日」が変わっていたら入れ替える。
  // 前の日に受け取らなかった報酬は自動で受け取り、「きのうの ミッションの ほうしゅうを うけとったよ」と知らせる
  const fx = useFx();
  const [dailyOpen, setDailyOpen] = useState(false);
  const [carry, setCarry] = useState<DailyCarry | null>(null);
  const topFx = useRef<HTMLDivElement>(null);
  const sandbox = useIsSandbox();
  const rollNow = () => {
    const now = Date.now();
    // 練習用の写し（チュートリアルの見返し）の中では入れ替えない（知らせが本物の localStorage に入らないように）
    if (sandbox || !features.daily || save.daily.cycleKey === cycleKeyAt(now)) return;
    // 知らせは写しで先に計算する（保存は同じ計算で1回。結果は同じ。src/daily/daily.ts rollDaily）
    const c = rollDaily(structuredClone(save), now);
    if (c) addDailyNotice(c);
    update((d) => void rollDaily(d, now));
  };
  // 開発時の StrictMode で2回走っても、知らせを2回足さない
  const rolledOnce = useRef(false);
  useEffect(() => {
    if (!rolledOnce.current) {
      rolledOnce.current = true;
      rollNow();
    }
    const c = peekDailyNotice();
    // きのうの ミッションの報酬で受け取ったカード：絵を読み始める（v2.4）
    if (c?.cards.length) void preloadCards(c.cards);
    setCarry(c);
  }, []);
  const closeCarry = () => {
    clearDailyNotice();
    setCarry(null);
  };
  /** ミッションの報酬：コインがボタンから飛んで、コイン表示へ */
  const claimDaily = (id: DailyMissionId, from: HTMLElement) => {
    const now = Date.now();
    const got = claimMission(structuredClone(save), id, now);
    if (got === null) return;
    setHeldCoins(save.coins);
    update((d) => void claimMission(d, id, now));
    audio.play('se_coin_burst');
    const L = topFx.current;
    // コインが上限で増えなかった時は、印だけ付ける（飛ばさない）
    if (!L || got <= 0) {
      setHeldCoins(null);
      return;
    }
    void flyCoins(L, centerIn(L, from), 12, { reduce: fx.reduceFx, burst: true }).then(() => setHeldCoins(null));
  };
  /** 確定のミッションの報酬：デイリーパック3袋と50コインを1回の保存で書いてから、パックガチャの開封の演出へ */
  const claimDailyAll = () => {
    const now = Date.now();
    const bags = drawDailyBags(cryptoRand);
    const before = save.coins;
    let got: { results: PullResult[]; coins: number } | null = null;
    flushSync(() =>
      update((d) => {
        got = claimAllClear(d, now, bags) ?? got;
      }),
    );
    const res = got as { results: PullResult[]; coins: number } | null;
    if (!res) return;
    // デイリーパックのカードが決まった：絵を読み始める（v2.4）
    void preloadCards(res.results.map((r) => r.no));
    go('gacha', { daily: { bags, results: res.results, coinsBefore: before, coins: res.coins } } satisfies GachaPayload);
  };
  const dailyBadge = features.daily ? claimableCount(save.daily) : 0;

  // 新しい版のお知らせ（v2.7）：メニューに戻った時にも確かめる
  useEffect(() => {
    void checkForUpdate();
  }, []);
  // 古い版のままではトレードに入れない（v2.7）
  const onlineGate = useOnlineGate();

  const pressLocked = (id: LockedId) => {
    // 機能フラグが ON になったら、その画面へ進む
    if (features[id]) {
      if (id === 'trade') onlineGate.gate(() => go(id));
      else go(id);
      return;
    }
    setShake((s) => ({ ...s, [id]: s[id] + 1 }));
  };

  return (
    <div className="menu-scene">
      {/* アカウント停止の確かめ（v2.0-J） */}
      <SuspensionGate mode="notice" />
      {/* 新しい版のお知らせ（v2.7）：上の ふせん と「さいよみこみ」 */}
      <UpdateNote />
      {onlineGate.dialog}
      {/* トロフィーが届いた（v2.0-J） */}
      <TrophyArrival />
      {/* 上の帯：小さいロゴ／コイン／なまえ／設定 */}
      <Logo width={170} className="menu-scene__logo" />
      <div className="menu-scene__top-right">
        {features.daily && (
          <div className="daily-icon">
            <RoughButton seed="menu-daily" ariaLabel={tr.daily.iconAria(dailyBadge)} onClick={() => setDailyOpen(true)} data-testid="menu-daily">
              <DailyIcon img={imageUrl('images/daily.webp')} />
            </RoughButton>
            {dailyBadge > 0 && (
              <span className="daily-icon__badge num" data-testid="daily-badge">
                {dailyBadge}
              </span>
            )}
          </div>
        )}
        {features.coins && <CoinCounter value={heldCoins ?? save.coins} className="menu-scene__coins" />}
        <RoughBox seed="menu-name" className="menu-scene__name" paper>
          <span className="tilt" style={tiltStyle('menu-name')}>
            {save.playerName}
          </span>
        </RoughBox>
        <RoughButton seed="menu-settings" className="menu-scene__gear" ariaLabel={tr.menu.settings} onClick={() => go('settings')}>
          <GearIcon />
        </RoughButton>
      </div>

      {/* 左：オンラインたいせん（いちばん大きい。v2.0-G）・デッキへんしゅう。まんなか：ストーリー・CPU。右：ガチャ・トレード（UPDATE_v2 §0-2） */}
      <RoughButton seed="menu-friend" className="menu-scene__friend" strokeWidth={3} onClick={() => go('online')} data-testid="menu-online">
        <span className="menu-scene__friend-label">
          {tr.menu.friend}
          <small>{tr.menu.friendSub}</small>
        </span>
      </RoughButton>

      {/* CPUたいせん：フレンドたいせんの次に目立つ（SPEC §7 S01・v1.4） */}
      <RoughButton seed="menu-cpu" className="menu-scene__cpu" strokeWidth={2.8} onClick={() => go('cpu')}>
        <span className="menu-scene__cpu-label">
          {tr.menu.cpu}
          <small>{tr.menu.cpuSub}</small>
        </span>
      </RoughButton>

      <LockedButton id="story" label={tr.menu.story} shake={shake.story} onPress={pressLocked} />
      <LockedButton id="gacha" label={tr.menu.gacha} shake={shake.gacha} onPress={pressLocked} />
      <LockedButton id="trade" label={tr.menu.trade} shake={shake.trade} onPress={pressLocked} />
      <LockedButton id="ranking" label={tr.menu.ranking} shake={shake.ranking} onPress={pressLocked} />
      {/* とちゅうの こうかん（最終確認のあと保存の前に閉じた。v2.0-H） */}
      {pendingTrade && (
        <div className="menu-scene__trade-pending" data-testid="trade-pending">
          <Sticky seed="menu-trade-pending" color="red" angle={5}>
            {tr.trade.pendingNote(pendingTrade.room)}
          </Sticky>
        </div>
      )}
      {gachaInvite && (
        <div className="menu-scene__gacha-invite" data-testid="gacha-invite">
          <Sticky seed="menu-gacha-invite" color="yellow" angle={-6}>
            {tr.menu.gachaInvite}
          </Sticky>
        </div>
      )}

      {/* 右：デッキ・ルール（・デバッグ） */}
      <RoughButton seed="menu-deck" className="menu-scene__sub menu-scene__deck" onClick={() => go('deck')}>
        {tr.menu.deck}
      </RoughButton>
      <RoughButton seed="menu-rules" className="menu-scene__sub menu-scene__rules" onClick={() => go('rules')}>
        {tr.menu.rules}
      </RoughButton>
      {debug && (
        <RoughButton
          seed="menu-debug"
          className="menu-scene__sub menu-scene__debug"
          stroke="var(--pen-red)"
          onClick={() => go('debug')}
        >
          <span className="menu-scene__debug-label">{tr.menu.debug}</span>
        </RoughButton>
      )}
      {debug && (
        <RoughButton seed="menu-soundtest" className="menu-scene__sub menu-scene__debug menu-scene__soundtest" stroke="var(--pen-red)" onClick={() => go('soundtest')}>
          <span className="menu-scene__debug-label">{tr.menu.soundtest}</span>
        </RoughButton>
      )}

      {/* データを まもろう（SPEC §12-6） */}
      {remindBackup && (
        <button type="button" className="menu-scene__backup" onClick={() => go('settings')}>
          <Sticky seed="menu-backup" color="green" angle={3}>
            {tr.menu.backup}
            <br />
            <small>{tr.menu.backupSub}</small>
          </Sticky>
        </button>
      )}

      {/* アップデートの おしらせ（古いセーブから移行した人に1回だけ。SPEC §7 S01） */}
      {!save.updateNoticeSeen && (
        <UpdateNotice
          onAnswer={(tryTutorial) => {
            // 「あとで」でも、次から自動ではチュートリアルを始めない（ルールせつめい・せっていから いつでも）
            update((d) => {
              d.updateNoticeSeen = true;
              if (!tryTutorial) d.tutorial.done = true;
              // 「やる」：途中で閉じても、次は ことば・なまえ を出さずにチュートリアルから（今までのプレイヤーには ことば を出さない。§6-1）
              else d.tutorial.step = STEP_FROM_NOTICE;
            });
            if (tryTutorial) go('tutorial');
          }}
        />
      )}

      {(rateNotice || friendNotice) && (
        <Dialog
          seed="rate-notice"
          title={tr.online.pendingTitle}
          onClose={() => {
            setRateNotice(null);
            setFriendNotice(false);
          }}
          actions={
            <RoughButton
              seed="rate-notice-ok"
              highlight
              onClick={() => {
                setRateNotice(null);
                setFriendNotice(false);
              }}
            >
              {tr.common.ok}
            </RoughButton>
          }
        >
          {rateNotice && <p data-testid="rate-notice">{tr.online.pendingLost}</p>}
          {rateNotice && <p className="num">{tr.online.rateChange(rateNotice.before, rateNotice.after)}</p>}
          {friendNotice && <p data-testid="friend-notice">{tr.online.pendingLostFriend}</p>}
        </Dialog>
      )}

      {/* 選んでいたデッキがスーパー2枚以上で、ほかに使えるデッキも無い（v2.4。起動するたびに1回） */}
      {superFix && save.updateNoticeSeen && !rateNotice && !friendNotice && !carry && (
        <Dialog
          seed="super-fix"
          title={tr.menu.superFixTitle}
          onClose={closeSuperFix}
          actions={
            <>
              <RoughButton seed="super-fix-later" onClick={closeSuperFix}>
                {tr.menu.superFixLater}
              </RoughButton>
              <RoughButton
                seed="super-fix-go"
                highlight
                data-testid="super-fix-go"
                onClick={() => {
                  closeSuperFix();
                  go('deck');
                }}
              >
                {tr.menu.superFixGo}
              </RoughButton>
            </>
          }
        >
          <p data-testid="super-fix">{tr.menu.superFixText}</p>
        </Dialog>
      )}

      {/* ログインボーナスのプレゼントボックス */}
      {showPresent && (
        <div className="menu-scene__present">
          <PresentBox
            key={reappear}
            appear={reappear > 0}
            amount={Math.min(ECONOMY.loginBonus, ECONOMY.coinsMax - save.coins)}
            layer={() => fxLayer.current}
            onOpen={() => {
              setHeldCoins(save.coins);
              setOpening(true);
              // 押した瞬間に「コイン +50」と「受け取った時刻」を同じ保存で書く（時刻は押した時に読む）
              update((d) => void claimLoginBonus(d, Date.now()));
            }}
            onCoins={() => setHeldCoins(null)}
            onDone={() => {
              setOpening(false);
              setNow(Date.now());
            }}
          />
        </div>
      )}
      {features.coins && !showPresent && (
        <div className="menu-scene__present menu-scene__present--wait">
          <PresentWait remaining={(t) => loginBonusRemainingMs(save, t)} onZero={() => setNow(Date.now())} />
        </div>
      )}
      <div className="menu-scene__fx" ref={fxLayer} aria-hidden />

      {dailyOpen && (
        <DailyPanel
          daily={save.daily}
          onClaim={claimDaily}
          onClaimAllClear={claimDailyAll}
          onRoll={() => {
            rollNow();
            setCarry(peekDailyNotice());
          }}
          onClose={() => setDailyOpen(false)}
        />
      )}
      {/* デイリーの報酬のコインは、パネルより上を飛ぶ */}
      <div className="menu-scene__fx menu-scene__fx--top" ref={topFx} aria-hidden />
      {carry && save.updateNoticeSeen && !rateNotice && !friendNotice && (
        <Dialog
          seed="daily-carry"
          title={tr.daily.carryTitle}
          onClose={closeCarry}
          width={720}
          actions={
            <RoughButton seed="daily-carry-ok" highlight onClick={closeCarry} data-testid="daily-carry-ok">
              {tr.common.ok}
            </RoughButton>
          }
        >
          <p data-testid="daily-carry">{tr.daily.carryText}</p>
          {carry.coins > 0 && <p className="num">{tr.daily.carryCoins(carry.coins)}</p>}
          {carry.cards.length > 0 && (
            <>
              <p>{tr.daily.carryCards(carry.cards.length)}</p>
              <div className="daily-carry__cards">
                {carry.cards.map((no, i) => (
                  <PrizeCard key={i} def={CARD_DB[no]} seed={`carry-${no}-${i}`} width={112} />
                ))}
              </div>
            </>
          )}
        </Dialog>
      )}

      {/* 余白の落書き（星・サイコロはゆっくり動く。おてあげの絵は動かさない） */}
      <OtegeArt width={150} className="menu-scene__doodle menu-scene__doodle--oteage" />
      <StarDoodle seed="menu-star-1" size={54} float className="menu-scene__doodle menu-scene__doodle--star1" />
      <StarDoodle seed="menu-star-2" size={36} float className="menu-scene__doodle menu-scene__doodle--star2" />
      <DiceDoodle seed="menu-dice" size={58} face={6} float className="menu-scene__doodle menu-scene__doodle--dice" />
    </div>
  );
}

/** アップデートの おしらせ。最後に「チュートリアルを やってみる？」（やる／あとで。強制しない） */
function UpdateNotice({ onAnswer }: { onAnswer: (tryTutorial: boolean) => void }) {
  const tr = useT();
  return (
    <Dialog
      seed="update-notice"
      title={tr.notice.title}
      width={760}
      actions={
        <>
          <RoughButton seed="update-notice-later" onClick={() => onAnswer(false)}>
            {tr.notice.later}
          </RoughButton>
          <RoughButton seed="update-notice-yes" highlight onClick={() => onAnswer(true)}>
            {tr.notice.yes}
          </RoughButton>
        </>
      }
    >
      <ul className="menu-notice__list" data-testid="update-notice">
        {tr.notice.lines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <p className="menu-notice__ask">{tr.notice.ask}</p>
    </Dialog>
  );
}

/** ストーリー・ガチャ：押すと「じゅんびちゅう」ふせんがプルッと揺れる */
function LockedButton({
  id,
  label,
  shake,
  onPress,
}: {
  id: LockedId;
  label: string;
  shake: number;
  onPress: (id: LockedId) => void;
}) {
  const locked = !features[id];
  const tr = useT();
  return (
    <div className={`menu-scene__locked menu-scene__locked--${id}`}>
      <RoughButton seed={`menu-${id}`} className={`menu-scene__locked-btn ${locked ? '' : 'is-open'}`} onClick={() => onPress(id)} data-testid={`menu-${id}`}>
        {label}
      </RoughButton>
      {locked && (
        <Sticky seed={`menu-${id}-sticky`} angle={id === 'story' || id === 'trade' ? -8 : 7} shake={shake} className="menu-scene__locked-sticky">
          {tr.menu.lockedTop}
          <br />
          {tr.menu.lockedBottom}
        </Sticky>
      )}
      {locked && shake > 0 && (
        <span key={shake} className="note-pop menu-scene__locked-msg">
          {tr.menu.lockedMsg}
        </span>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 40 40" width="34" height="34" className="menu-scene__gear-icon" aria-hidden>
      <circle cx="20" cy="20" r="6" />
      <path d="M20 4 V10 M20 30 V36 M4 20 H10 M30 20 H36 M8.7 8.7 L13 13 M27 27 L31.3 31.3 M8.7 31.3 L13 27 M27 13 L31.3 8.7" />
      <circle cx="20" cy="20" r="11.5" />
    </svg>
  );
}

