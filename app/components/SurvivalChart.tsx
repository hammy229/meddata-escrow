"use client";

// Kaplan-Meier step chart in plain SVG, no chart library. Groups differ by dash
// pattern and marker shape as well as ink, so colour is never the only signal.
// Wide screens get direct labels at the end of each curve; narrow screens get
// a key under the chart. The at-risk table and the values table carry the same
// numbers for anyone who cannot read the picture. Colours are the page tokens,
// so the chart follows light and dark mode.
import { useId } from "react";
import type {
  SurvivalAnalysis,
  SurvivalGroup,
} from "../../lib/query/survival-analysis";
import {
  dashFor,
  formatP,
  groupByLabel,
  groupLabel,
  markerFor,
  spreadLabels,
  stepPath,
  type MarkerShape,
} from "../../lib/query/survival-chart";

const W = 640;
const H = 340;
const M = { left: 52, right: 118, top: 14, bottom: 46 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;
const X_TICKS = [0, 6, 12, 18, 24, 30, 36];
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];

// Ink for the first group, muted for the second, and so on.
const STROKES = [
  "var(--foreground)",
  "var(--muted)",
  "var(--foreground)",
  "var(--muted)",
  "var(--foreground)",
];

function Marker({
  shape,
  cx,
  cy,
  stroke,
}: {
  shape: MarkerShape;
  cx: number;
  cy: number;
  stroke: string;
}) {
  const s = 4;
  const common = { fill: "var(--background)", stroke, strokeWidth: 1.5 };
  switch (shape) {
    case "square":
      return (
        <rect x={cx - s} y={cy - s} width={s * 2} height={s * 2} {...common} />
      );
    case "triangle":
      return (
        <polygon
          points={`${cx},${cy - s - 1} ${cx + s + 1},${cy + s} ${cx - s - 1},${cy + s}`}
          {...common}
        />
      );
    case "diamond":
      return (
        <polygon
          points={`${cx},${cy - s - 1} ${cx + s + 1},${cy} ${cx},${cy + s + 1} ${cx - s - 1},${cy}`}
          {...common}
        />
      );
    case "cross":
      return (
        <path
          d={`M${cx - s} ${cy - s} L${cx + s} ${cy + s} M${cx + s} ${cy - s} L${cx - s} ${cy + s}`}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
        />
      );
    default:
      return <circle cx={cx} cy={cy} r={s} {...common} />;
  }
}

/** A short line sample with its marker, used in the key. */
function Swatch({ i }: { i: number }) {
  const stroke = STROKES[i % STROKES.length];
  return (
    <svg
      width="34"
      height="12"
      viewBox="0 0 34 12"
      aria-hidden="true"
      className="shrink-0"
    >
      <line
        x1="1"
        x2="33"
        y1="6"
        y2="6"
        stroke={stroke}
        strokeWidth="2"
        strokeDasharray={dashFor(i)}
      />
      <Marker shape={markerFor(i)} cx={17} cy={6} stroke={stroke} />
    </svg>
  );
}

function medianText(g: SurvivalGroup): string {
  return g.medianMonths === null
    ? "Median not reached"
    : `Median about ${g.medianMonths} months`;
}

const pct = (s: number) => `${Math.round(s * 100)}%`;

export default function SurvivalChart({
  analysis,
}: {
  analysis: SurvivalAnalysis;
}) {
  const uid = useId();
  const titleId = `${uid}-t`;
  const descId = `${uid}-d`;
  const { groups, groupBy } = analysis;
  const label = (g: SurvivalGroup) => groupLabel(groupBy, g.group);
  const x = (m: number) => M.left + (m / 36) * PLOT_W;
  const y = (s: number) => M.top + (1 - s) * PLOT_H;

  const endYs = groups.map((g) => {
    const last = g.curve[g.curve.length - 1];
    return last ? y(last.survival) : M.top;
  });
  const labelYs = spreadLabels(endYs, 15, M.top + 6, M.top + PLOT_H - 2);
  const tableMonths = X_TICKS.filter((m) => analysis.grid.includes(m));
  const find = (g: SurvivalGroup, m: number) =>
    g.curve.find((p) => p.month === m);
  const truncated = groups.filter((g) => g.truncatedAtMonth !== null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-[3px] border border-ink/30 px-1.5 py-0.5 font-mono text-[0.65rem] tracking-[0.14em]">
          SYNTHETIC
        </span>
        <span className="text-sm text-muted">
          Survival by {groupByLabel(groupBy)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="h-auto w-full"
      >
        <title id={titleId}>
          {`Kaplan-Meier survival curves by ${groupByLabel(groupBy)}, synthetic data`}
        </title>
        <desc id={descId}>
          {groups
            .map((g) => `${label(g)}: ${medianText(g).toLowerCase()}`)
            .join(". ")}
          . The tables below the chart give every value.
        </desc>

        {Y_TICKS.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={M.left + PLOT_W}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--rule)"
              strokeWidth="1"
            />
            <text
              x={M.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--muted)"
            >
              {pct(t)}
            </text>
          </g>
        ))}
        {X_TICKS.map((t) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={M.top + PLOT_H}
              y2={M.top + PLOT_H + 4}
              stroke="var(--muted)"
              strokeWidth="1"
            />
            <text
              x={x(t)}
              y={M.top + PLOT_H + 18}
              textAnchor="middle"
              fontSize="11"
              fill="var(--muted)"
            >
              {t}
            </text>
          </g>
        ))}
        <line
          x1={M.left}
          x2={M.left}
          y1={M.top}
          y2={M.top + PLOT_H}
          stroke="var(--muted)"
          strokeWidth="1"
        />
        <text
          x={M.left + PLOT_W / 2}
          y={H - 6}
          textAnchor="middle"
          fontSize="12"
          fill="var(--muted)"
        >
          Months since index
        </text>
        <text
          transform={`translate(13 ${M.top + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize="12"
          fill="var(--muted)"
        >
          Share surviving
        </text>

        {groups.map((g, i) => {
          const stroke = STROKES[i % STROKES.length];
          const pts = g.curve;
          return (
            <g key={g.group}>
              <path
                d={stepPath(pts, x, y)}
                fill="none"
                stroke={stroke}
                strokeWidth="2"
                strokeDasharray={dashFor(i)}
                strokeLinejoin="round"
              />
              {pts
                .filter((p, k) => p.month % 6 === 0 || k === pts.length - 1)
                .map((p) => (
                  <Marker
                    key={p.month}
                    shape={markerFor(i)}
                    cx={x(p.month)}
                    cy={y(p.survival)}
                    stroke={stroke}
                  />
                ))}
              <text
                x={M.left + PLOT_W + 10}
                y={labelYs[i] + 4}
                fontSize="12"
                fill="var(--foreground)"
                className="max-sm:hidden"
              >
                {label(g)}
              </text>
            </g>
          );
        })}
      </svg>

      <ul
        className="flex flex-wrap gap-x-5 gap-y-2 text-sm sm:hidden"
        aria-label="Key"
      >
        {groups.map((g, i) => (
          <li key={g.group} className="flex items-center gap-2">
            <Swatch i={i} />
            {label(g)}
          </li>
        ))}
      </ul>

      <ul className="space-y-1 text-sm text-muted">
        {groups.map((g) => (
          <li key={g.group}>
            <span className="text-ink">{label(g)}.</span> {medianText(g)}
            {g.medianMonths !== null && " (to the nearest 3 months)"}.
          </li>
        ))}
      </ul>

      <div>
        <h4 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
          People at risk
        </h4>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-sm tabular-nums">
            <caption className="sr-only">
              People still at risk, rounded to the nearest 5, by month
            </caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs text-muted">
                <th scope="col" className="py-1.5 pr-3 font-normal">
                  Group
                </th>
                {tableMonths.map((m) => (
                  <th
                    key={m}
                    scope="col"
                    className="px-2 py-1.5 text-right font-normal"
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, i) => (
                <tr key={g.group} className="border-b border-rule">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <Swatch i={i} />
                      {label(g)}
                    </span>
                  </th>
                  {tableMonths.map((m) => (
                    <td
                      key={m}
                      className="px-2 py-1.5 text-right font-mono text-xs"
                    >
                      {find(g, m)?.atRisk ?? "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-muted">
          Months since index across the top. Counts are rounded to the nearest
          5. A dash means the curve had ended.
        </p>
      </div>

      {(truncated.length > 0 || analysis.withheldGroups > 0) && (
        <p className="text-xs text-muted">
          {truncated.length > 0 &&
            `A curve stops when fewer than 11 people are still at risk${
              truncated.length === groups.length
                ? ""
                : ` (${truncated.map(label).join(", ")})`
            }. `}
          {analysis.withheldGroups > 0 &&
            `${analysis.withheldGroups} group${analysis.withheldGroups === 1 ? " was" : "s were"} left out because it had fewer than 11 people.`}
        </p>
      )}

      <details>
        <summary className="cursor-pointer text-sm underline underline-offset-4">
          Show the survival values as a table
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[30rem] border-collapse text-sm tabular-nums">
            <caption className="sr-only">Share surviving by month</caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs text-muted">
                <th scope="col" className="py-1.5 pr-3 font-normal">
                  Group
                </th>
                {analysis.grid.map((m) => (
                  <th
                    key={m}
                    scope="col"
                    className="px-2 py-1.5 text-right font-normal"
                  >
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.group} className="border-b border-rule">
                  <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                    {label(g)}
                  </th>
                  {analysis.grid.map((m) => (
                    <td
                      key={m}
                      className="px-2 py-1.5 text-right font-mono text-xs"
                    >
                      {find(g, m) ? pct(find(g, m)!.survival) : "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="text-xs text-muted">{analysis.label}</p>
    </div>
  );
}

/** Raw and age-adjusted log-rank p side by side, with the plain reading. */
export function PValues({ analysis }: { analysis: SurvivalAnalysis }) {
  const { raw, adjusted } = analysis.logRank;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="border-t border-rule pt-2">
          <dt className="text-xs text-muted">Raw comparison (log-rank p)</dt>
          <dd className="font-serif text-2xl">{formatP(raw.pValue)}</dd>
        </div>
        {adjusted && (
          <div className="border-t border-rule pt-2">
            <dt className="text-xs text-muted">
              Within age bands (stratified log-rank p)
            </dt>
            <dd className="font-serif text-2xl">{formatP(adjusted.pValue)}</dd>
          </div>
        )}
      </dl>
      <p className="font-serif text-lg leading-snug">
        {analysis.interpretation}
      </p>
    </div>
  );
}
