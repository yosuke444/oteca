import { useId } from 'react';
import type { PackDef } from '../../data/packs';
import { imageUrl } from '../../ui/imageFiles';
import { useT } from '../../i18n/useT';

/**
 * パックの絵（SPEC §7 S09・UPDATE_v2 §11-3）。public/packs/pack_<id>.png があればそれを使う。
 * 無い時の仮表示：手描きの袋の形に、パック名をペン文字で書く（元祖＝青、真＝赤、よせあつめ＝緑）。
 * デイリーパック（color: daily）は、緑の地に黄色のしまと黄色の縁取り、まんなかに特大の「デイリー」（v2.1-M）。
 * small は開ける時の袋（破る点線を出す）
 */
export function PackArt({ pack, small = false, className }: { pack: PackDef; small?: boolean; className?: string }) {
  const tr = useT();
  const img = imageUrl(`packs/pack_${pack.id}.png`);
  // しま模様の pattern の id（同じ画面に何枚あっても別々に）
  const stripes = `stripes-${useId().replace(/:/g, '')}`;
  const daily = pack.color === 'daily';
  return (
    <div className={`pack-art pack-art--${pack.color} ${small ? 'pack-art--small' : ''} ${className ?? ''}`}>
      {img ? (
        <img src={img} alt={pack.name} className="pack-art__img" draggable={false} />
      ) : (
        <>
          <svg className="pack-art__bag" viewBox="0 0 200 300" preserveAspectRatio="none" aria-hidden>
            {daily && (
              <defs>
                <pattern id={stripes} width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">
                  <rect width="34" height="34" fill="var(--pack-daily-green)" />
                  <rect width="13" height="34" fill="var(--pack-daily-yellow)" />
                </pattern>
              </defs>
            )}
            {/* 袋：上と下はギザギザ（圧着したところ） */}
            <path
              d="M14 28 L24 16 L34 28 L44 16 L54 28 L64 16 L74 28 L84 16 L94 28 L104 16 L114 28 L124 16 L134 28 L144 16 L154 28 L164 16 L174 28 L186 18
                 L188 34 L184 150 L189 268 L186 282 L174 272 L164 284 L154 272 L144 284 L134 272 L124 284 L114 272 L104 284 L94 272 L84 284 L74 272 L64 284 L54 272 L44 284 L34 272 L24 284 L14 274
                 L12 260 L16 150 L11 40 Z"
              className="pack-art__body"
              style={daily ? { fill: `url(#${stripes})` } : undefined}
            />
            {/* デイリー：黄色の縁取り（ペンの線の内側に太く） */}
            {daily && (
              <path
                d="M24 34 L176 34 L176 266 L24 266 Z"
                className="pack-art__daily-frame"
              />
            )}
            <path d="M14 44 Q100 40 186 46" className="pack-art__seam" />
            <path d="M14 258 Q100 262 186 256" className="pack-art__seam" />
            {/* きらっとした光の落書き */}
            <path d="M40 70 L46 120 M52 68 L56 98" className="pack-art__shine" />
            {/* 星 */}
            <path d="M150 210 L155 222 L168 223 L158 231 L162 244 L150 236 L138 244 L142 231 L132 223 L145 222 Z" className="pack-art__star" />
            <path d="M44 220 L47 227 L55 228 L49 233 L51 241 L44 236 L37 241 L39 233 L33 228 L41 227 Z" className="pack-art__star" />
          </svg>
          <span className="pack-art__logo">{tr.common.logo}</span>
          {daily ? <span className="pack-art__daily">{tr.daily.packBig}</span> : <span className="pack-art__name">{pack.name}</span>}
        </>
      )}
      {small && <span className="pack-art__tear" aria-hidden />}
    </div>
  );
}
