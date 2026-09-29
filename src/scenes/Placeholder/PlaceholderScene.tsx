import { useNav } from '../../router';
import { RoughButton } from '../../ui/rough/RoughButton';
import { Sticky } from '../../ui/common/Sticky';
import './placeholder.css';

/** 🔒後で実装する画面（ストーリー・ガチャ）の「じゅんびちゅう」表示（SPEC §13-5） */
export function ComingSoonScene() {
  return (
    <PlaceholderBase seed="coming-soon" title="じゅんびちゅう" message="もうすこし まってね" />
  );
}

/** これから作る画面（フェーズ2以降で本物に差し替える） */
export function UnderConstructionScene() {
  return (
    <PlaceholderBase seed="under-construction" title="つくっている とちゅう" message="つぎの アップデートで あそべるよ" />
  );
}

function PlaceholderBase({ seed, title, message }: { seed: string; title: string; message: string }) {
  const { go } = useNav();
  return (
    <div className="placeholder-scene">
      <Sticky seed={seed} color="yellow" className="placeholder-scene__sticky">
        <span className="placeholder-scene__title">{title}</span>
      </Sticky>
      <p className="placeholder-scene__msg">{message}</p>
      <RoughButton seed={`${seed}-back`} className="placeholder-scene__back" onClick={() => go('menu')}>
        もどる
      </RoughButton>
    </div>
  );
}
