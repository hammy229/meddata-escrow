// The escrow lifecycle as a row of chips. PayPal blue marks held and settled
// states; disputes, voids and cancellations get their own chips.
import { ESCROW_FLOW, type EscrowFlowState } from "../../lib/ui/order-sync";

const offRamp =
  "rounded-full border border-rose-300 bg-rose-50 px-3 py-1 font-mono text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300";

export default function EscrowStepper({
  state,
  voided,
  disputed,
  cancelled = false,
}: {
  state: EscrowFlowState | null;
  voided: boolean;
  disputed: boolean;
  cancelled?: boolean;
}) {
  const activeIndex = state ? ESCROW_FLOW.indexOf(state) : -1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ESCROW_FLOW.map((s, i) => {
        const reached = i <= activeIndex;
        const held = s === "AUTHORIZED" || s === "DELIVERED";
        return (
          <span
            key={s}
            className={[
              "rounded-full border px-3 py-1 font-mono text-xs transition-colors",
              reached && held
                ? "border-pp-300 bg-pp-50 text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300"
                : reached
                  ? "border-pp-600 bg-pp-600 text-white dark:border-pp-500 dark:bg-pp-500"
                  : "border-rule bg-paper text-zinc-400 dark:text-zinc-600",
            ].join(" ")}
          >
            {s}
          </span>
        );
      })}
      {disputed && (
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 font-mono text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          DISPUTED
        </span>
      )}
      {voided && <span className={offRamp}>VOIDED</span>}
      {cancelled && <span className={offRamp}>CANCELLED</span>}
    </div>
  );
}
