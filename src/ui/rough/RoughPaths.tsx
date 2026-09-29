import type { RoughPath } from './roughShapes';

/** roughPaths.ts が作ったパスを <path> として描く */
export function RoughPaths({ paths }: { paths: RoughPath[] }) {
  return (
    <>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          style={{ stroke: p.stroke, strokeWidth: p.strokeWidth, fill: p.fill }}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}
