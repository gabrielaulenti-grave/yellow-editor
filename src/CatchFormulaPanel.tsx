import { SearchableSelect } from "./editor/SearchableSelect";
import { useEffect, useMemo, useState } from "react";
import {
  effectiveBallRandomCeiling,
  formatCatchPercent,
  simulateNominalGen1Catch,
  type Gen1BallKind,
  type Gen1CatchStatus,
  type SafariCatchAdjustment,
} from "./core/catchFormula";
import type {
  BallRoutineParameters,
  ItemData,
  PokemonCatchProfile,
} from "./core/types";
import { ReadonlyField } from "./editor/EditorFields";

interface CatchFormulaPanelProps {
  parameters: BallRoutineParameters;
  items: ItemData[];
  pokemonCatchProfiles: PokemonCatchProfile[];
  catchProfilesLoading: boolean;
  catchProfilesError: string | null;
  busy: boolean;
  onChange(parameters: BallRoutineParameters): void;
  onSelectItem(itemId: number): void;
}

const BALL_CONSTANTS = [
  "MASTER_BALL",
  "POKE_BALL",
  "GREAT_BALL",
  "ULTRA_BALL",
  "SAFARI_BALL",
] as const;

const BALL_ROWS: Array<{ kind: Gen1BallKind; constant: typeof BALL_CONSTANTS[number]; label: string }> = [
  { kind: "master", constant: "MASTER_BALL", label: "Master Ball" },
  { kind: "poke", constant: "POKE_BALL", label: "Poké Ball" },
  { kind: "great", constant: "GREAT_BALL", label: "Great Ball" },
  { kind: "ultra", constant: "ULTRA_BALL", label: "Ultra Ball" },
  { kind: "safari", constant: "SAFARI_BALL", label: "Safari Ball" },
];

type EditableBallKey = Exclude<
  keyof BallRoutineParameters,
  "kind" | "masterBallGuaranteed" | "currentHpDivisor"
>;

function numericValue(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function NumberField({
  label,
  value,
  min = 0,
  max = 255,
  busy,
  help,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  busy: boolean;
  help?: string;
  onChange(value: number): void;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step="1"
        value={value}
        disabled={busy}
        onChange={(event) => onChange(numericValue(event.target.value, value))}
      />
      {help && <small>{help}</small>}
    </label>
  );
}

export function CatchFormulaPanel({
  parameters,
  items,
  pokemonCatchProfiles,
  catchProfilesLoading,
  catchProfilesError,
  busy,
  onChange,
  onSelectItem,
}: CatchFormulaPanelProps) {
  const sortedProfiles = useMemo(
    () => [...pokemonCatchProfiles].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [pokemonCatchProfiles],
  );
  const [profileId, setProfileId] = useState<number | null>(null);
  const [maxHp, setMaxHp] = useState(100);
  const [currentHp, setCurrentHp] = useState(100);
  const [status, setStatus] = useState<Gen1CatchStatus>("none");
  const [safariAdjustment, setSafariAdjustment] = useState<SafariCatchAdjustment>("none");

  useEffect(() => {
    if (sortedProfiles.length === 0) {
      setProfileId(null);
      return;
    }
    if (!sortedProfiles.some((profile) => profile.internalId === profileId)) {
      const pikachu = sortedProfiles.find((profile) => profile.constant === "PIKACHU");
      setProfileId((pikachu ?? sortedProfiles[0]).internalId);
    }
  }, [profileId, sortedProfiles]);

  const selectedProfile =
    sortedProfiles.find((profile) => profile.internalId === profileId) ?? null;

  const effectiveUltraCeiling = effectiveBallRandomCeiling(parameters, "ultra");

  function update(key: EditableBallKey, value: number) {
    onChange({ ...parameters, [key]: value });
  }

  function openBall(constant: string) {
    const item = items.find((entry) => entry.constant === constant);
    if (item) onSelectItem(item.id);
  }

  function setMaximumHp(value: number) {
    const next = Math.max(1, Math.min(999, value));
    setMaxHp(next);
    setCurrentHp((current) => Math.min(current, next));
  }

  const simulations = selectedProfile
    ? BALL_ROWS.map((row) => ({
      ...row,
      result: simulateNominalGen1Catch(parameters, {
        ball: row.kind,
        catchRate: selectedProfile.catchRate,
        maxHp,
        currentHp,
        status,
        safariAdjustment,
      }),
    }))
    : [];

  return (
    <div className="catch-formula">
      <div className="catch-formula-intro">
        <strong>Shared Gen I catch formula</strong>
        <p>
          Red, Blue, and Yellow do not give each ball one simple multiplier. Capture uses a
          first random-roll gate, a catch-rate/status check, and then an HP-dependent second
          roll. The failure animation is calculated separately after a catch has already failed.
        </p>
        <div className="item-shared-links" aria-label="Items that share this routine">
          {BALL_ROWS.map((row) => (
            <button
              key={row.constant}
              type="button"
              className="small-button"
              onClick={() => openBall(row.constant)}
            >
              {row.label}
            </button>
          ))}
        </div>
      </div>

      <h5>What each ball actually changes</h5>
      <div className="catch-ball-summary-grid">
        <div className="catch-ball-summary">
          <strong>Master Ball</strong>
          <span>Skips the normal checks and catches any otherwise-catchable target.</span>
        </div>
        <div className="catch-ball-summary">
          <strong>Poké Ball</strong>
          <span>
            First roll 0–255; HP factor divisor {parameters.otherHpDivisor}.
          </span>
        </div>
        <div className="catch-ball-summary">
          <strong>Great Ball</strong>
          <span>
            First roll 0–{parameters.greatRandomCeiling}; stronger HP factor divisor{" "}
            {parameters.greatHpDivisor}.
          </span>
        </div>
        <div className="catch-ball-summary">
          <strong>Ultra Ball</strong>
          <span>
            First roll 0–{effectiveUltraCeiling}; HP factor divisor {parameters.otherHpDivisor}.
          </span>
        </div>
        <div className="catch-ball-summary">
          <strong>Safari Ball</strong>
          <span>
            Same base ball calculation as Ultra; bait or rocks can separately alter the target's
            effective catch rate.
          </span>
        </div>
      </div>

      <details className="catch-simulator" open>
        <summary>Test Capture</summary>
        <p className="help-text">
          This calculator follows the integer arithmetic in the game routine. It assumes each
          random byte is independent and uniformly distributed, so it is a nominal formula result,
          not cycle-accurate emulation of Gen I RNG correlation.
        </p>

        {catchProfilesLoading ? (
          <p className="help-text">Reading Pokémon catch rates…</p>
        ) : catchProfilesError ? (
          <p className="item-compatibility-error">{catchProfilesError}</p>
        ) : sortedProfiles.length === 0 ? (
          <p className="help-text">No Pokémon catch-rate data is available.</p>
        ) : (
          <>
            <div className="field-grid two-column-fields">
              <label className="editor-field">
                <span>Pokémon</span>
                <SearchableSelect
                  value={profileId ?? ""}
                  onChange={(event) => setProfileId(Number.parseInt(event.target.value, 10))}
                >
                  {sortedProfiles.map((profile) => (
                    <option key={profile.internalId} value={profile.internalId}>
                      {profile.displayName} — catch rate {profile.catchRate}
                    </option>
                  ))}
                </SearchableSelect>
              </label>
              <ReadonlyField
                label="Base Catch Rate"
                value={selectedProfile ? String(selectedProfile.catchRate) : "—"}
              />
              <label className="editor-field">
                <span>Maximum HP</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={maxHp}
                  onChange={(event) =>
                    setMaximumHp(numericValue(event.target.value, maxHp))}
                />
              </label>
              <label className="editor-field">
                <span>Status</span>
                <SearchableSelect
                  value={status}
                  onChange={(event) => setStatus(event.target.value as Gen1CatchStatus)}
                >
                  <option value="none">No status</option>
                  <option value="minor">Burn / Poison / Paralysis</option>
                  <option value="major">Sleep / Freeze</option>
                </SearchableSelect>
              </label>
              <label className="editor-field catch-hp-slider">
                <span>Current HP — {currentHp} / {maxHp}</span>
                <input
                  type="range"
                  min="1"
                  max={maxHp}
                  value={currentHp}
                  onChange={(event) => setCurrentHp(Number.parseInt(event.target.value, 10))}
                />
              </label>
              <label className="editor-field">
                <span>Safari Catch Rate</span>
                <SearchableSelect
                  value={safariAdjustment}
                  onChange={(event) =>
                    setSafariAdjustment(event.target.value as SafariCatchAdjustment)}
                >
                  <option value="none">Base rate</option>
                  <option value="bait">After one bait — halve rate</option>
                  <option value="rock">After one rock — double rate, cap 255</option>
                </SearchableSelect>
              </label>
            </div>

            <div className="catch-results-table-wrap">
              <table className="catch-results-table">
                <thead>
                  <tr>
                    <th>Ball</th>
                    <th>Nominal capture chance</th>
                    <th>Effective first roll</th>
                    <th>HP factor W</th>
                    <th>Second-roll chance</th>
                  </tr>
                </thead>
                <tbody>
                  {simulations.map(({ kind, label, result }) => (
                    <tr key={kind}>
                      <th scope="row">{label}</th>
                      <td><strong>{formatCatchPercent(result.probability)}</strong></td>
                      <td>
                        {kind === "master"
                          ? "Skipped"
                          : `0–${result.effectiveRandomCeiling}`}
                      </td>
                      <td>
                        {kind === "master"
                          ? "Skipped"
                          : result.hpFactor > 255
                            ? `${result.hpFactor} → automatic`
                            : String(result.hpFactor)}
                      </td>
                      <td>
                        {kind === "master"
                          ? "Skipped"
                          : formatCatchPercent(result.secondRollChance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {safariAdjustment !== "none" && simulations.length > 0 && (
              <p className="help-text">
                Safari Ball effective catch rate in this test:{" "}
                {simulations.find((row) => row.kind === "safari")?.result.effectiveCatchRate}.
                Bait and rocks also affect Safari escape behavior elsewhere in the battle code.
              </p>
            )}
          </>
        )}
      </details>

      <details className="catch-advanced" open>
        <summary>Advanced Capture Formula</summary>
        <p className="help-text">
          These values affect whether capture succeeds. Lower HP divisors make the HP check easier.
          Status bonuses are subtracted from the first roll; if the bonus is larger than the roll,
          capture succeeds immediately.
        </p>
        <div className="field-grid two-column-fields">
          <NumberField
            label="Great / Ultra / Safari First Gate"
            value={parameters.greatRandomCeiling}
            busy={busy}
            help="Vanilla: 200. Affects Great, Ultra, and Safari before Ultra/Safari's second gate."
            onChange={(value) => update("greatRandomCeiling", value)}
          />
          <NumberField
            label="Ultra / Safari Second Gate"
            value={parameters.ultraSafariRandomCeiling}
            busy={busy}
            help={`Vanilla: 150. Effective Ultra/Safari ceiling is currently ${effectiveUltraCeiling}.`}
            onChange={(value) => update("ultraSafariRandomCeiling", value)}
          />
          <NumberField
            label="Burn / Poison / Paralysis Bonus"
            value={parameters.minorStatusCatchBonus}
            busy={busy}
            help="Vanilla: 12. Subtracted from the first catch roll."
            onChange={(value) => update("minorStatusCatchBonus", value)}
          />
          <NumberField
            label="Sleep / Freeze Bonus"
            value={parameters.majorStatusCatchBonus}
            busy={busy}
            help="Vanilla: 25. Subtracted from the first catch roll."
            onChange={(value) => update("majorStatusCatchBonus", value)}
          />
          <NumberField
            label="Great Ball HP Divisor"
            value={parameters.greatHpDivisor}
            min={1}
            busy={busy}
            help="Vanilla: 8. Lower values make the Great Ball's HP check stronger."
            onChange={(value) => update("greatHpDivisor", value)}
          />
          <NumberField
            label="Poké / Ultra / Safari HP Divisor"
            value={parameters.otherHpDivisor}
            min={1}
            busy={busy}
            help="Vanilla: 12. Shared by Poké, Ultra, and Safari Balls."
            onChange={(value) => update("otherHpDivisor", value)}
          />
          <ReadonlyField
            label="Current-HP Divisor"
            value={String(parameters.currentHpDivisor)}
          />
        </div>
        <p className="help-text">
          The current-HP divisor is {parameters.currentHpDivisor} because the original assembly
          divides HP with CPU shift instructions rather than a numeric constant. It is displayed
          accurately but remains read-only until structural routine editing is available.
        </p>
        <div className="catch-formula-code">
          <code>
            W = floor(floor(MaxHP × 255 / BallHPDivisor) / max(floor(CurrentHP / {parameters.currentHpDivisor}), 1))
          </code>
        </div>
      </details>

      <details className="catch-failure-animation">
        <summary>Failure Animation — does not change capture chance</summary>
        <p className="help-text">
          Yellow calculates these only after capture has already failed. They choose whether the
          animation shows a miss, one shake, two shakes, or three shakes.
        </p>
        <div className="field-grid two-column-fields">
          <NumberField
            label="Poké Ball Shake Divisor"
            value={parameters.pokeShakeDivisor}
            min={1}
            busy={busy}
            help="Vanilla: 255."
            onChange={(value) => update("pokeShakeDivisor", value)}
          />
          <NumberField
            label="Great Ball Shake Divisor"
            value={parameters.greatShakeDivisor}
            min={1}
            busy={busy}
            help="Vanilla: 200."
            onChange={(value) => update("greatShakeDivisor", value)}
          />
          <NumberField
            label="Ultra / Safari Shake Divisor"
            value={parameters.ultraSafariShakeDivisor}
            min={1}
            busy={busy}
            help="Vanilla: 150."
            onChange={(value) => update("ultraSafariShakeDivisor", value)}
          />
          <NumberField
            label="Burn / Poison / Paralysis Shake Bonus"
            value={parameters.minorStatusShakeBonus}
            busy={busy}
            help="Vanilla: 5."
            onChange={(value) => update("minorStatusShakeBonus", value)}
          />
          <NumberField
            label="Sleep / Freeze Shake Bonus"
            value={parameters.majorStatusShakeBonus}
            busy={busy}
            help="Vanilla: 10."
            onChange={(value) => update("majorStatusShakeBonus", value)}
          />
        </div>

        <h6>Shake-score thresholds</h6>
        <div className="field-grid three-column-fields">
          <NumberField
            label="1 Shake Starts At"
            value={parameters.shakeOneThreshold}
            busy={busy}
            help="Vanilla: 10."
            onChange={(value) => update("shakeOneThreshold", value)}
          />
          <NumberField
            label="2 Shakes Start At"
            value={parameters.shakeTwoThreshold}
            busy={busy}
            help="Vanilla: 30."
            onChange={(value) => update("shakeTwoThreshold", value)}
          />
          <NumberField
            label="3 Shakes Start At"
            value={parameters.shakeThreeThreshold}
            busy={busy}
            help="Vanilla: 70."
            onChange={(value) => update("shakeThreeThreshold", value)}
          />
        </div>
        <p className="help-text">
          Keep the thresholds increasing. Changing these can make a failed throw look more or less
          promising without changing the actual probability of capture.
        </p>
      </details>
    </div>
  );
}
