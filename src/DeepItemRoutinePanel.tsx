import { SearchableSelect } from "./editor/SearchableSelect";
import type {
  BattleFlagEffect,
  ItemData,
  ItemRoutineParameters,
  StatusCureEffect,
} from "./core/types";
import { ReadonlyField } from "./editor/EditorFields";

interface DeepItemRoutinePanelProps {
  routine: ItemRoutineParameters;
  items: ItemData[];
  busy: boolean;
  onChange(routine: ItemRoutineParameters): void;
  onSelectItem(itemId: number): void;
  onOpenPokemon(internalId: number): void;
}

function numeric(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function SharedItemLinks({
  constants,
  items,
  onSelectItem,
}: {
  constants: string[];
  items: ItemData[];
  onSelectItem(itemId: number): void;
}) {
  const linked = constants
    .map((constant) => items.find((item) => item.constant === constant))
    .filter((item): item is ItemData => Boolean(item));

  if (linked.length < 2) return null;
  return (
    <div className="item-shared-links">
      <span className="help-text">Shared with:</span>
      {linked.map((item) => (
        <button
          key={item.id}
          type="button"
          className="small-button"
          onClick={() => onSelectItem(item.id)}
        >
          {item.name}
        </button>
      ))}
    </div>
  );
}

function itemLabel(items: ItemData[], constant: string): string {
  const item = items.find((entry) => entry.constant === constant);
  return item ? `${item.name} — ${constant}` : constant;
}

export function DeepItemRoutinePanel({
  routine,
  items,
  busy,
  onChange,
  onSelectItem,
  onOpenPokemon,
}: DeepItemRoutinePanelProps) {
  if (routine.kind === "repel") {
    return (
      <div className="item-routine-panel">
        <strong>Repel duration</strong>
        <label className="editor-field">
          <span>Steps</span>
          <input
            type="number"
            min="1"
            max="255"
            step="1"
            value={routine.steps}
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...routine,
                steps: numeric(event.target.value, routine.steps),
              })}
          />
        </label>
        <p className="help-text">
          The game stores this directly in <code>wRepelRemainingSteps</code>. Valid values are
          1–255 steps.
        </p>
      </div>
    );
  }

  if (routine.kind === "vitamin") {
    return (
      <div className="item-routine-panel">
        <strong>Vitamin Stat EXP</strong>
        <div className="field-grid two-column-fields">
          <ReadonlyField label="Raised Stat" value={routine.stat} />
          <label className="editor-field">
            <span>Stat EXP Added</span>
            <input
              type="number"
              min="256"
              max="65280"
              step="256"
              value={routine.statExpAdded}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...routine,
                  statExpAdded: numeric(event.target.value, routine.statExpAdded),
                })}
            />
          </label>
          <label className="editor-field">
            <span>Use Threshold</span>
            <input
              type="number"
              min="256"
              max="65280"
              step="256"
              value={routine.useThreshold}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...routine,
                  useThreshold: numeric(event.target.value, routine.useThreshold),
                })}
            />
          </label>
        </div>
        <p className="help-text">
          Gen I stores Stat EXP as a 16-bit value, but the vitamin routine edits only its high
          byte. Yellow Editor therefore uses multiples of 256. Vanilla adds 2,560 Stat EXP and
          stops accepting vitamins once the high byte reaches 100 (25,600 Stat EXP).
        </p>
        <p className="help-text">
          These two values are shared by all five vitamins; the item itself only chooses which
          stat receives the increase.
        </p>
        <SharedItemLinks
          constants={routine.sharedConstants}
          items={items}
          onSelectItem={onSelectItem}
        />
      </div>
    );
  }

  if (routine.kind === "revive") {
    return (
      <div className="item-routine-panel">
        <strong>Revival HP</strong>
        {routine.editable ? (
          <label className="editor-field">
            <span>HP Restored</span>
            <SearchableSelect
              value={routine.restoreMode}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...routine,
                  restoreMode: event.target.value as "quarter" | "half" | "full",
                })}
            >
              <option value="quarter">25% of maximum HP</option>
              <option value="half">50% of maximum HP — vanilla Revive</option>
              <option value="full">100% of maximum HP</option>
            </SearchableSelect>
          </label>
        ) : (
          <ReadonlyField label="HP Restored" value="100% of maximum HP" />
        )}
        <p className="help-text">
          Revive's vanilla 50% effect is encoded as a 16-bit right shift rather than a percentage
          constant. Yellow Editor safely rewrites only that small arithmetic block for 25% or 50%,
          or routes Revive to the existing full-HP path for 100%, while leaving the surrounding
          Red/Blue or Yellow-specific logic untouched.
        </p>
        {!routine.editable && (
          <p className="help-text">
            Max Revive already follows the full-HP path and remains read-only because changing it
            independently would require restructuring the shared medicine routine.
          </p>
        )}
      </div>
    );
  }

  if (routine.kind === "pp-restore") {
    return (
      <div className="item-routine-panel">
        <strong>PP restoration</strong>
        {routine.fullRestore || routine.restoreAmount === null ? (
          <ReadonlyField label="PP Restored" value="Restore selected move(s) to maximum" />
        ) : (
          <label className="editor-field">
            <span>PP Restored</span>
            <input
              type="number"
              min="1"
              max="63"
              step="1"
              value={routine.restoreAmount}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...routine,
                  restoreAmount: numeric(event.target.value, routine.restoreAmount ?? 10),
                })}
            />
          </label>
        )}
        <p className="help-text">
          Ether and Elixer share the same fixed restoration amount; Elixer simply applies it to
          each move. Max Ether and Max Elixer use the separate full-restore path.
        </p>
        <SharedItemLinks
          constants={routine.sharedConstants}
          items={items}
          onSelectItem={onSelectItem}
        />
      </div>
    );
  }

  if (routine.kind === "pp-up") {
    return (
      <div className="item-routine-panel">
        <strong>PP Up bonus formula</strong>
        <div className="field-grid two-column-fields">
          <label className="editor-field">
            <span>Base PP Divisor</span>
            <input
              type="number"
              min="1"
              max="255"
              step="1"
              value={routine.bonusDivisor}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...routine,
                  bonusDivisor: numeric(event.target.value, routine.bonusDivisor),
                })}
            />
          </label>
          <label className="editor-field">
            <span>Bonus Cap Per PP Up</span>
            <input
              type="number"
              min="1"
              max="7"
              step="1"
              value={routine.perUseCap}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...routine,
                  perUseCap: numeric(event.target.value, routine.perUseCap),
                })}
            />
          </label>
          <ReadonlyField label="Maximum PP Ups Per Move" value={String(routine.maxUses)} />
        </div>
        <p className="help-text">
          Vanilla adds floor(Base PP ÷ {routine.bonusDivisor}), capped at {routine.perUseCap},
          for each PP Up. The maximum of three uses is stored in two bits of the Pokémon PP byte,
          so Yellow Editor keeps that limit read-only.
        </p>
      </div>
    );
  }

  if (routine.kind === "bicycle") {
    return (
      <div className="item-routine-panel">
        <strong>Bicycle movement speed</strong>
        <label className="editor-field">
          <span>Movement Speed</span>
          <SearchableSelect
            value={routine.speedMultiplier}
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...routine,
                speedMultiplier: Number.parseInt(event.target.value, 10) as 1 | 2 | 4,
              })}
          >
            <option value={1}>1× — walking speed</option>
            <option value={2}>2× — vanilla bicycle</option>
            <option value={4}>4× — fast bicycle</option>
          </SearchableSelect>
        </label>
        <ReadonlyField
          label="Detected Routine Layout"
          value={routine.sourceVariant === "pokered" ? "Red / Blue" : "Yellow"}
        />
        <p className="help-text">
          Bicycle speed is not a numeric constant. The game advances the player's movement once
          normally and performs extra <code>AdvancePlayerSprite</code> calls while cycling.
          Yellow Editor rewrites only that tiny speed-up block and preserves each version's
          surrounding movement checks.
        </p>
        <p className="help-text">
          The safe presets divide the eight-step movement counter evenly: 1×, 2×, or 4×.
        </p>
      </div>
    );
  }

  if (routine.kind === "status-cure") {
    return (
      <div className="item-routine-panel">
        <strong>Status medicine effect</strong>
        <label className="editor-field">
          <span>Status Cured</span>
          <SearchableSelect
            value={routine.effect}
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...routine,
                effect: event.target.value as StatusCureEffect,
              })}
          >
            <option value="poison">Poison</option>
            <option value="burn">Burn</option>
            <option value="freeze">Freeze</option>
            <option value="sleep">Sleep</option>
            <option value="paralysis">Paralysis</option>
            <option value="all">All status conditions</option>
          </SearchableSelect>
        </label>
        <p className="help-text">
          Yellow Editor changes both the status mask and the matching party-menu message, so a
          repurposed medicine does not keep the wrong vanilla cure text. Toxic's badly-poisoned
          battle flag is also cleared by the shared medicine routine when poison is cured.
        </p>
      </div>
    );
  }

  if (routine.kind === "x-stat") {
    return (
      <div className="item-routine-panel">
        <strong>X-stat battle boost</strong>
        <div className="field-grid two-column-fields">
          <ReadonlyField label="Raised Stat" value={routine.stat} />
          <label className="editor-field">
            <span>Stages Raised</span>
            <SearchableSelect
              value={routine.stageBoost}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...routine,
                  stageBoost: Number.parseInt(event.target.value, 10) as 1 | 2,
                })}
            >
              <option value={1}>+1 stage — vanilla</option>
              <option value={2}>+2 stages</option>
            </SearchableSelect>
          </label>
        </div>
        <p className="help-text">
          Gen I derives X Attack, X Defend, X Speed, and X Special from one contiguous move-effect
          range. Changing the stage amount therefore affects all four X-stat items together.
        </p>
        <SharedItemLinks
          constants={routine.sharedConstants}
          items={items}
          onSelectItem={onSelectItem}
        />
      </div>
    );
  }

  if (routine.kind === "battle-flag") {
    return (
      <div className="item-routine-panel">
        <strong>Battle item effect</strong>
        <label className="editor-field">
          <span>Effect Applied</span>
          <SearchableSelect
            value={routine.effect}
            disabled={busy}
            onChange={(event) =>
              onChange({
                ...routine,
                effect: event.target.value as BattleFlagEffect,
              })}
          >
            <option value="x-accuracy">X Accuracy — ignore normal accuracy/evasion checks</option>
            <option value="mist">Guard Spec. — protect against stat reductions</option>
            <option value="focus-energy">Dire Hit — apply Focus Energy state</option>
          </SearchableSelect>
        </label>
        <p className="help-text">
          X Accuracy, Guard Spec., and Dire Hit each set a persistent bit in the player's battle
          status. This editor lets the item choose which of those three existing Gen I effects it
          applies; it does not rewrite the separate battle-engine implementation of the effect.
        </p>
      </div>
    );
  }

  if (routine.kind === "evolution-stone") {
    return (
      <div className="item-routine-panel">
        <strong>Evolution stone assignments</strong>
        <p className="help-text">
          The stone routine itself only asks each Pokémon's evolution data whether this item is a
          valid trigger. These rows are the actual <code>EVOLVE_ITEM</code> references using this
          stone. You can reassign an existing evolution to another project-defined evolution stone
          here; use the Pokémon editor to add/remove evolutions or change their target/minimum level.
        </p>
        {routine.references.length === 0 ? (
          <p className="help-text">No Pokémon evolution currently references this stone.</p>
        ) : (
          <div className="item-evolution-reference-list">
            {routine.references.map((reference, index) => (
              <div
                className="item-evolution-reference"
                key={`${reference.internalId}:${reference.evolutionIndex}:${reference.targetConstant}`}
              >
                <div className="item-evolution-route">
                  <a
                    href="#pokemon"
                    onClick={(event) => {
                      event.preventDefault();
                      onOpenPokemon(reference.internalId);
                    }}
                  >
                    {reference.sourceDisplayName}
                  </a>
                  <span>→</span>
                  <strong>{reference.targetDisplayName}</strong>
                  {reference.minimumLevel > 1 && (
                    <small>minimum level {reference.minimumLevel}</small>
                  )}
                </div>
                <label className="editor-field">
                  <span>Evolution Item</span>
                  <SearchableSelect
                    value={reference.itemConstant}
                    disabled={busy}
                    onChange={(event) => {
                      const references = routine.references.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? { ...candidate, itemConstant: event.target.value }
                          : candidate
                      );
                      onChange({ ...routine, references });
                    }}
                  >
                    {routine.stoneConstants.map((constant) => (
                      <option key={constant} value={constant}>
                        {itemLabel(items, constant)}
                      </option>
                    ))}
                  </SearchableSelect>
                </label>
              </div>
            ))}
          </div>
        )}
        <SharedItemLinks
          constants={routine.stoneConstants}
          items={items}
          onSelectItem={onSelectItem}
        />
      </div>
    );
  }

  return null;
}
