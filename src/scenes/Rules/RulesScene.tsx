import { type ReactNode, useEffect, useState } from 'react';
import { CARD_DB } from '../../data/cards';
import { DEFAULT_RULES } from '../../engine';
import type { CardDef, OtegeCardDef } from '../../engine/types';
import { useNav } from '../../router';
import { CardMini } from '../../ui/card/CardMini';
import { DiceDoodle, StarDoodle } from '../../ui/common/Doodles';
import { OtegeArt } from '../../ui/common/OtegeArt';
import { turnPage } from '../../ui/common/PageTurn';
import { RoughBox } from '../../ui/rough/RoughBox';
import { RoughButton } from '../../ui/rough/RoughButton';
import { tiltStyle } from '../../ui/rough/seed';
import './rules.css';

/**
 * S07 ルールせつめい（SPEC §7。P1）
 * ノートのページをめくる形式で6ページ。§4 の内容を子ども向けの言葉とイラストで。
 * 各ページの下に「もっと くわしく」の小さな注記。
 * ルールの数（15まい・3たい など）は RuleSet から、アイテムの名前と説明は cards.json から読む（コードに直接書かない）。
 */

const R = DEFAULT_RULES;
const cards = Object.values(CARD_DB).sort((a, b) => a.no - b.no);
const otege = cards.filter((c): c is OtegeCardDef => c.kind === 'otege');
const items = cards.filter((c) => c.kind === 'item');
const normalSample = otege.find((c) => c.rarity === 'normal');
const superSample = otege.find((c) => c.rarity === 'super');
/** アイテムの効果の数（ダメージ計算の説明用） */
const effectValue = (type: 'addAttack' | 'overrideAttack'): number | null => {
  for (const c of items) {
    if (c.kind !== 'item') continue;
    for (const e of c.effects) {
      if (e.type === 'addAttack' && type === 'addAttack') return e.amount;
      if (e.type === 'overrideAttack' && type === 'overrideAttack') return e.value;
    }
  }
  return null;
};
const itemName = (type: 'addAttack' | 'overrideAttack'): string =>
  items.find((c) => c.kind === 'item' && c.effects.some((e) => e.type === type))?.name ?? '';

type Page = { title: string; body: ReactNode; art: ReactNode; more: ReactNode };

const Mark = ({ children }: { children: ReactNode }) => <span className="rules-mark">{children}</span>;

const PAGES: Page[] = [
  {
    title: 'オテカって なに？',
    body: (
      <>
        <p>
          ふたりで あそぶ <Mark>カードバトル</Mark> だよ。
        </p>
        <p>じぶんの「おてあげ」を たたかわせて、サイコロで でた めで わざが きまるよ。</p>
        <p>
          あいての おてあげを <Mark>{R.koToWin}たい たおしたら かち！</Mark>
        </p>
        <p>うんで きまる ところと、じゅんびで かわる ところが あるのが おもしろさ。</p>
      </>
    ),
    art: (
      <div className="rules-art rules-art--vs">
        <OtegeArt width={240} />
        <DiceDoodle seed="rules-p1-dice" size={80} face={6} float />
      </div>
    ),
    more: '1しあいは だいたい 5〜10ぷん。「おてあげ」には「こうさん」という いみも あるよ。',
  },
  {
    title: 'じゅんび',
    body: (
      <>
        <p>
          デッキは <Mark>ちょうど {R.deckSize}まい</Mark>。おてあげを 1まい いじょう いれてね。スーパーおてあげ（S）は デッキに {R.superMaxPerDeck}まい まで。
        </p>
        <p>① サイコロで せんこうを きめる（おおきい めが さき）</p>
        <p>
          ② カードを {R.initialHand}まい ひく。{R.mulliganIfNoOtege ? 'おてあげが いなかったら ひきなおし' : ''}
        </p>
        <p>③ バトルばに おてあげを 1たい、うらむきで だす。ふたり そろったら オープン！</p>
      </>
    ),
    art: (
      <div className="rules-art rules-art--cards">
        {normalSample && <CardMini def={normalSample} seed="rules-normal" variant="tile" />}
        {superSample && <CardMini def={superSample} seed="rules-super" variant="tile" />}
      </div>
    ),
    more: 'おなじ カードは なんまい いれても いいよ（スーパーだけ かずが きまっている）。せんこうきめで おなじ めが でたら ふりなおし。じゅんびの あいだは ベンチに だせないよ。',
  },
  {
    title: 'じぶんの ターン',
    body: (
      <>
        <p>すきな じゅんばんで、なんかいでも できるよ。</p>
        <p>
          ・おてあげを <Mark>ベンチに だす</Mark>（1ターンに {R.benchPlacePerTurn}たい、ベンチは {R.benchMax}たい まで）
        </p>
        <p>・<Mark>アイテム</Mark> を つかう（なんまいでも）</p>
        <p>
          ・<Mark>こうたい</Mark>（バトルば ⇄ ベンチ）…でも こうたいした ターンは こうげき できないよ
        </p>
        <p>カードは {R.drawEveryNTurns}ターンに 1かい、ターンの はじめに 1まい ひけるよ。</p>
      </>
    ),
    art: (
      <div className="rules-art rules-art--turn">
        <div className="rules-slot">ベンチ</div>
        <div className="rules-slot rules-slot--active">バトルば</div>
        <div className="rules-slot">ベンチ</div>
        <span className="rules-arrow">⇄</span>
      </div>
    ),
    more: `カードを ひくのは、じぶんの ${R.drawEveryNTurns}・${R.drawEveryNTurns * 2}・${R.drawEveryNTurns * 3}ターンめ…。やまふだが なくなっても まけには ならないよ。`,
  },
  {
    title: 'こうげき',
    body: (
      <>
        <p>
          「<Mark>ターンおわり＆こうげき！</Mark>」を おすと、サイコロが ころがるよ。
        </p>
        <p>でた めの わざを、バトルばの おてあげが つかう。</p>
        <p>ダメージは あいての バトルばへ。かいふくは じぶん じしんを なおすよ（さいだいHPまで）。</p>
        <p>こうげきは かならず する（さきに はじめる ひとの 1ターンめも）。こうたいした ターンだけ こうげき なし。</p>
      </>
    ),
    art: (
      <div className="rules-art rules-art--attack">
        <DiceDoodle seed="rules-p4-dice" size={110} face={4} />
        {normalSample && <CardMini def={normalSample} seed="rules-attack" variant="tile" />}
      </div>
    ),
    more: (
      <>
        ダメージの けいさん：わざの ダメージ →（{itemName('overrideAttack')}なら、もとが おおきくても {effectValue('overrideAttack')} に かわる）→（{itemName('addAttack')} 1まいごとに +{effectValue('addAttack')}）。かいふくの わざは かわらない。あまった ダメージは つぎの おてあげに のこらないよ。
      </>
    ),
  },
  {
    title: 'アイテム',
    body: (
      <>
        <p>つかいきりの カード。じぶんの おてあげ 1たいに つかうよ。</p>
        <ul className="rules-items">
          {items.map((c: CardDef) => (
            <li key={c.no}>
              <b>{c.name}</b>：{c.kind === 'item' ? c.text : ''}
            </li>
          ))}
        </ul>
      </>
    ),
    art: (
      <div className="rules-art rules-art--items">
        {items.slice(0, 4).map((c) => (
          <CardMini key={c.no} def={c} seed={`rules-item-${c.no}`} variant="tile" />
        ))}
      </div>
    ),
    more: 'HPが まんたんの おてあげには、かいふくの アイテムは つかえないよ。ベンチの おてあげに こうげきの アイテムを つかっても、その ターンは こうげきしないので むだに なるよ（つかう まえに おしえてくれる）。',
  },
  {
    title: 'きぜつと かちまけ',
    body: (
      <>
        <p>
          HPが 0いかに なった おてあげは <Mark>きぜつ</Mark>。すてふだへ いくよ。
        </p>
        <p>
          ・あいてを {R.koToWin}たい たおしたら かち
          <br />・あいての ベンチが からっぽの ときに たおしても かち
        </p>
        <p>
          そうでなければ、たおされた ほうが ベンチから 1たい えらんで バトルばへ（<Mark>くりだし</Mark>）。
        </p>
        <p>こまったら ⚙ の「おてあげする」で こうさん できるよ。</p>
      </>
    ),
    art: (
      <div className="rules-art rules-art--win">
        {Array.from({ length: R.koToWin }, (_, i) => (
          <StarDoodle key={i} seed={`rules-star-${i}`} size={80} float />
        ))}
      </div>
    ),
    more: 'くりだしは「こうたい」とは ちがうので、つぎの じぶんの ターンに ふつうに こうげき できるよ。',
  },
];

export function RulesScene() {
  const { go } = useNav();
  const [page, setPage] = useState(0);
  const last = PAGES.length - 1;

  const turn = (to: number) => {
    if (to < 0 || to > last || to === page) return;
    // ノートの ページを めくる
    turnPage(document.querySelector<HTMLElement>('.stage'));
    setPage(to);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') turn(page + 1);
      if (e.key === 'ArrowLeft') turn(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const p = PAGES[page];
  return (
    <div className="rules-scene">
      <RoughBox seed={`rules-page-${page}`} className="rules-page" paper radius={6}>
        <div className="rules-page__head">
          <h1 className="rules-page__title" style={tiltStyle(`rules-title-${page}`)}>
            {p.title}
          </h1>
          <span className="rules-page__num num">
            {page + 1} / {PAGES.length}
          </span>
        </div>
        <div className="rules-page__main">
          <div className="rules-page__body">{p.body}</div>
          {p.art}
        </div>
        <p className="rules-page__more pencil">
          <b>もっと くわしく：</b>
          {p.more}
        </p>
      </RoughBox>
      <RoughButton seed="rules-prev" className="rules-nav rules-nav--prev" disabled={page === 0} onClick={() => turn(page - 1)}>
        ← まえ
      </RoughButton>
      <RoughButton seed="rules-next" className="rules-nav rules-nav--next" highlight={page < last} disabled={page === last} onClick={() => turn(page + 1)}>
        つぎ →
      </RoughButton>
      <RoughButton seed="rules-back" className="rules-back" onClick={() => go('menu')}>
        もどる
      </RoughButton>
    </div>
  );
}
