import { SearchableSelect } from "./editor/SearchableSelect";
import { useMemo, useState } from "react";
import type {
  PokemonIndexEntry,
  TrainerClassCreateValues,
  TrainerClassEntry,
} from "./core/types";
import { VANILLA_MAX_TRAINER_CLASSES } from "./core/trainerClassEditing";

function suggestConstant(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function TrainerClassCreateDialog({
  classes,
  pokemonIndex,
  busy,
  onCancel,
  onCreate,
}: {
  classes: TrainerClassEntry[];
  pokemonIndex: PokemonIndexEntry[];
  busy: boolean;
  onCancel(): void;
  onCreate(values: TrainerClassCreateValues): Promise<void>;
}) {
  const species = useMemo(
    () => pokemonIndex.filter((entry) => entry.kind === "pokemon" && entry.constant),
    [pokemonIndex],
  );
  const defaultClass = classes[0] ?? null;
  const [name, setName] = useState("");
  const [constant, setConstant] = useState("");
  const [constantEdited, setConstantEdited] = useState(false);
  const [portraitClassConstant, setPortraitClassConstant] = useState(
    defaultClass?.constant ?? "",
  );
  const [behaviorClassConstant, setBehaviorClassConstant] = useState(
    defaultClass?.constant ?? "",
  );
  const [baseReward, setBaseReward] = useState("15");
  const [level, setLevel] = useState("5");
  const [speciesConstant, setSpeciesConstant] = useState(
    species[0]?.constant ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  const behaviorClass = classes.find(
    (entry) => entry.constant === behaviorClassConstant,
  ) ?? null;
  const numericReward = Number(baseReward);
  const numericLevel = Number(level);
  const remainingSlots = Math.max(0, VANILLA_MAX_TRAINER_CLASSES - classes.length);
  const nameValid = name.trim().length >= 1
    && name.trim().length <= 12
    && !/["@\r\n]/.test(name);
  const constantValid = /^[A-Z][A-Z0-9_]*$/.test(constant)
    && !classes.some((entry) => entry.constant === constant);
  const rewardValid = /^\d+$/.test(baseReward)
    && Number.isInteger(numericReward)
    && numericReward >= 0
    && numericReward <= 99;
  const levelValid = /^\d+$/.test(level)
    && Number.isInteger(numericLevel)
    && numericLevel >= 1
    && numericLevel <= 100;
  const canCreate = !busy
    && remainingSlots > 0
    && nameValid
    && constantValid
    && rewardValid
    && levelValid
    && Boolean(portraitClassConstant)
    && Boolean(behaviorClass?.aiRoutine)
    && Boolean(speciesConstant);

  async function submit() {
    if (!canCreate || !behaviorClass?.aiRoutine) return;
    setError(null);
    try {
      await onCreate({
        constant,
        name: name.trim(),
        portraitClassConstant,
        baseRewardPerLevel: numericReward,
        aiRoutine: behaviorClass.aiRoutine,
        aiUsesPerPokemon: behaviorClass.aiUsesPerPokemon ?? 3,
        moveChoiceModifiers: [...behaviorClass.moveChoiceModifiers],
        initialParty: {
          partyFormat: "shared-level",
          pokemon: [{
            level: numericLevel,
            speciesConstant,
          }],
        },
      });
      onCancel();
    } catch (createError) {
      setError(String(createError));
    }
  }

  return (
    <div className="text-editor-backdrop" role="presentation">
      <section
        className="text-editor-dialog trainer-class-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add trainer class"
      >
        <div className="text-editor-dialog-heading">
          <div>
            <h3>Add trainer class</h3>
            <p>
              New classes are appended so all existing vanilla trainer IDs stay unchanged.
            </p>
          </div>
          <button type="button" className="small-button" disabled={busy} onClick={onCancel}>
            Close
          </button>
        </div>

        <p className="shared-warning">
          {remainingSlots > 0
            ? `${remainingSlots} vanilla-safe trainer class slot${remainingSlots === 1 ? "" : "s"} remaining.`
            : "The vanilla one-byte opponent-ID range has no remaining trainer class slots."}
        </p>

        <div className="trainer-class-create-grid">
          <label className="trainer-reward-field">
            <span>Class name</span>
            <input
              value={name}
              maxLength={12}
              disabled={busy}
              placeholder="CAMPER GIRL"
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (!constantEdited) setConstant(suggestConstant(next));
              }}
            />
            <small>Up to 12 characters, matching the vanilla trainer-name field.</small>
          </label>

          <label className="trainer-reward-field">
            <span>Constant</span>
            <input
              value={constant}
              disabled={busy}
              placeholder="CAMPER_GIRL"
              onChange={(event) => {
                setConstantEdited(true);
                setConstant(event.target.value.toUpperCase());
              }}
            />
            <small>Used by map objects as <code>OPP_{constant || "CLASS"}</code>.</small>
          </label>

          <label className="trainer-reward-field">
            <span>Battle portrait</span>
            <SearchableSelect
              value={portraitClassConstant}
              disabled={busy}
              onChange={(event) => setPortraitClassConstant(event.target.value)}
            >
              {classes.map((entry) => (
                <option key={entry.constant} value={entry.constant}>{entry.name}</option>
              ))}
            </SearchableSelect>
            <small>Reuses an existing trainer battle sprite until graphics editing is available.</small>
          </label>

          <label className="trainer-reward-field">
            <span>Battle behavior template</span>
            <SearchableSelect
              value={behaviorClassConstant}
              disabled={busy}
              onChange={(event) => setBehaviorClassConstant(event.target.value)}
            >
              {classes.map((entry) => (
                <option key={entry.constant} value={entry.constant}>{entry.name}</option>
              ))}
            </SearchableSelect>
            <small>
              Copies the selected class's AI routine, AI-use count, and move-choice groups.
            </small>
          </label>

          <label className="trainer-reward-field">
            <span>Base prize rate</span>
            <input
              type="number"
              min={0}
              max={99}
              step={1}
              value={baseReward}
              disabled={busy}
              onChange={(event) => setBaseReward(event.target.value)}
            />
            <small>Money awarded is this rate × the last enemy Pokémon's level.</small>
          </label>

          <label className="trainer-reward-field">
            <span>Initial Pokémon</span>
            <SearchableSelect
              value={speciesConstant}
              disabled={busy}
              onChange={(event) => setSpeciesConstant(event.target.value)}
            >
              {species.map((entry) => (
                <option key={entry.constant} value={entry.constant ?? ""}>
                  {entry.displayName}
                </option>
              ))}
            </SearchableSelect>
            <small>Creates party #1. You can expand it immediately in the party editor.</small>
          </label>

          <label className="trainer-reward-field">
            <span>Initial level</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={level}
              disabled={busy}
              onChange={(event) => setLevel(event.target.value)}
            />
          </label>
        </div>

        {behaviorClass && (
          <div className="trainer-reward-selection-preview">
            <strong>Behavior copied from {behaviorClass.name}</strong>
            <span>
              {behaviorClass.aiRoutine ?? "Unknown AI"} · {behaviorClass.aiUsesPerPokemon ?? "?"} uses / Pokémon
            </span>
            <code>
              move choices: {behaviorClass.moveChoiceModifiers.length
                ? behaviorClass.moveChoiceModifiers.join(", ")
                : "none"}
            </code>
          </div>
        )}

        {!constantValid && constant.length > 0 && (
          <p className="text-editor-error">
            Use a unique uppercase constant beginning with a letter.
          </p>
        )}
        {error && <p className="text-editor-error">{error}</p>}

        <div className="text-editor-actions">
          <button type="button" className="small-button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="small-button primary-action"
            disabled={!canCreate}
            onClick={() => void submit()}
          >
            {busy ? "Adding…" : "Add trainer class"}
          </button>
        </div>
      </section>
    </div>
  );
}
