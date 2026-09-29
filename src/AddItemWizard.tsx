import { useEffect, useMemo, useState } from "react";
import type {
  ItemCreateDocument,
  ItemCreateTemplate,
  ItemCreateValues,
} from "./core/types";
import { formatHex } from "./editor/format";

interface AddItemWizardProps {
  document: ItemCreateDocument;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onCreate(values: ItemCreateValues): void;
}

interface TemplateOption {
  value: ItemCreateTemplate;
  label: string;
  description: string;
  defaultKeyItem: boolean;
}

const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    value: "unusable",
    label: "Script / key item",
    description:
      "No direct Item-menu effect. Useful for quest items, event checks, or items whose behavior will be scripted later.",
    defaultKeyItem: true,
  },
  {
    value: "evolution",
    label: "Evolution item",
    description:
      "Opens the party menu and uses Gen I's native EVOLVE_ITEM flow. It immediately becomes available in the Pokémon evolution editor.",
    defaultKeyItem: false,
  },
  {
    value: "repel",
    label: "Repel — 100 steps",
    description: "Uses the vanilla Repel routine and lasts 100 steps.",
    defaultKeyItem: false,
  },
  {
    value: "super-repel",
    label: "Super Repel — 200 steps",
    description: "Uses the vanilla Super Repel routine and lasts 200 steps.",
    defaultKeyItem: false,
  },
  {
    value: "max-repel",
    label: "Max Repel — 250 steps",
    description: "Uses the vanilla Max Repel routine and lasts 250 steps.",
    defaultKeyItem: false,
  },
  {
    value: "x-accuracy",
    label: "Battle item — X Accuracy",
    description: "Applies the existing Gen I X Accuracy battle flag.",
    defaultKeyItem: false,
  },
  {
    value: "guard-spec",
    label: "Battle item — Guard Spec.",
    description: "Applies the existing Mist / stat-drop protection battle flag.",
    defaultKeyItem: false,
  },
  {
    value: "dire-hit",
    label: "Battle item — Dire Hit",
    description: "Applies the existing Gen I Focus Energy battle flag.",
    defaultKeyItem: false,
  },
  {
    value: "escape-rope",
    label: "Escape Rope behavior",
    description: "Uses the vanilla Escape Rope routine and closes the item menu when used.",
    defaultKeyItem: false,
  },
  {
    value: "bicycle",
    label: "Bicycle behavior",
    description: "Uses the current project's Bicycle routine.",
    defaultKeyItem: true,
  },
  {
    value: "poke-doll",
    label: "Poké Doll behavior",
    description: "Uses the vanilla Poké Doll battle escape routine.",
    defaultKeyItem: false,
  },
];

function defaultConstant(slotId: number): string {
  return `CUSTOM_ITEM_${slotId.toString(16).toUpperCase().padStart(2, "0")}`;
}

export function AddItemWizard({
  document,
  busy,
  error,
  onCancel,
  onCreate,
}: AddItemWizardProps) {
  const [step, setStep] = useState(0);
  const firstSlot = document.slots[0] ?? null;
  const [slotId, setSlotId] = useState(firstSlot?.id ?? 0);
  const [constant, setConstant] = useState(
    firstSlot ? defaultConstant(firstSlot.id) : "",
  );
  const [name, setName] = useState("NEW ITEM");
  const [price, setPrice] = useState(0);
  const [keyItem, setKeyItem] = useState(true);
  const [template, setTemplate] = useState<ItemCreateTemplate>("unusable");

  useEffect(() => {
    const slot = document.slots[0];
    if (!slot) return;
    setSlotId(slot.id);
    setConstant(defaultConstant(slot.id));
  }, [document]);

  const selectedSlot = document.slots.find((slot) => slot.id === slotId) ?? null;
  const selectedTemplate =
    TEMPLATE_OPTIONS.find((option) => option.value === template)
    ?? TEMPLATE_OPTIONS[0];

  const normalizedConstant = constant.trim().toUpperCase();
  const identityValid = Boolean(
    selectedSlot
    && /^[A-Z][A-Z0-9_]*$/.test(normalizedConstant)
    && normalizedConstant !== selectedSlot.constant
    && !/^ITEM_/i.test(normalizedConstant)
    && !/^(?:HM_|TM_|FLOOR_)/.test(normalizedConstant)
    && normalizedConstant !== "NO_ITEM"
    && name.trim().length >= 1
    && name.trim().length <= document.maxNameLength
    && !/["@\r\n]/.test(name)
    && Number.isInteger(price)
    && price >= 0
    && price <= 999999
  );

  const values = useMemo<ItemCreateValues>(() => ({
    slotId,
    constant: normalizedConstant,
    name: name.trim(),
    price,
    keyItem,
    template,
  }), [slotId, normalizedConstant, name, price, keyItem, template]);

  function selectTemplate(value: ItemCreateTemplate) {
    setTemplate(value);
    const option = TEMPLATE_OPTIONS.find((entry) => entry.value === value);
    if (option) setKeyItem(option.defaultKeyItem);
  }

  function next() {
    if (step === 0 && !identityValid) return;
    setStep((current) => Math.min(2, current + 1));
  }

  function back() {
    setStep((current) => Math.max(0, current - 1));
  }

  return (
    <div className="wizard-backdrop" role="presentation">
      <section
        className="wizard-dialog add-item-wizard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-wizard-title"
      >
        <div className="wizard-heading">
          <div>
            <h2 id="add-item-wizard-title">Add Item</h2>
            <p>
              Repurpose a genuinely unused Gen I item slot without reindexing the
              item table.
            </p>
          </div>
          <button
            type="button"
            className="small-button"
            onClick={onCancel}
            disabled={busy}
          >
            Close
          </button>
        </div>

        <div className="wizard-steps" aria-label="Wizard progress">
          {["Identity", "Behavior", "Review"].map((label, index) => (
            <span
              key={label}
              className={index === step ? "active" : index < step ? "complete" : ""}
            >
              {index + 1}. {label}
            </span>
          ))}
        </div>

        {document.slots.length === 0 ? (
          <div className="wizard-empty">
            <h3>No unused vanilla slots remain</h3>
            <p>
              The wizard only repurposes placeholder <code>ITEM_XX</code> entries
              that still use <code>UnusableItem</code> and are absent from the
              party/overworld-use lists. This project no longer has one available.
            </p>
            <p className="help-text">
              A later advanced mode can expand the ordinary item table, but that
              requires reindexing and broader compatibility checks.
            </p>
          </div>
        ) : step === 0 ? (
          <div className="wizard-page">
            <h3>Choose an unused slot and give it an identity</h3>
            <div className="field-grid two-column-fields">
              <label className="editor-field">
                <span>Unused Slot</span>
                <select
                  value={slotId}
                  disabled={busy}
                  onChange={(event) => {
                    const nextId = Number.parseInt(event.target.value, 10);
                    setSlotId(nextId);
                    setConstant(defaultConstant(nextId));
                  }}
                >
                  {document.slots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {formatHex(slot.id)} — {slot.constant} — {slot.displayName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="editor-field">
                <span>Assembly Constant</span>
                <input
                  value={constant}
                  disabled={busy}
                  onChange={(event) => setConstant(event.target.value.toUpperCase())}
                  placeholder="MY_CUSTOM_ITEM"
                />
                <small>
                  A-Z, 0-9, and underscores only; ITEM_, HM_, TM_, FLOOR_, and
                  NO_ITEM are reserved.
                </small>
              </label>

              <label className="editor-field">
                <span>Display Name</span>
                <input
                  value={name}
                  maxLength={document.maxNameLength}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                />
                <small>
                  {name.length}/{document.maxNameLength}
                </small>
              </label>

              <label className="editor-field">
                <span>Price</span>
                <input
                  type="number"
                  min="0"
                  max="999999"
                  step="1"
                  value={price}
                  disabled={busy}
                  onChange={(event) =>
                    setPrice(Number.parseInt(event.target.value || "0", 10))}
                />
              </label>

              <label className="editor-field item-boolean-field">
                <span>Key Item</span>
                <input
                  type="checkbox"
                  checked={keyItem}
                  disabled={busy}
                  onChange={(event) => setKeyItem(event.target.checked)}
                />
              </label>
            </div>

            <div className="item-routine-panel">
              <strong>Slot compatibility</strong>
              <p className="help-text">
                Yellow Editor keeps the old placeholder constant as an assembly
                alias. For example, code that still references{" "}
                <code>{selectedSlot?.constant ?? "ITEM_XX"}</code> continues to
                resolve to this same item ID after it becomes{" "}
                <code>{normalizedConstant || "YOUR_ITEM"}</code>.
              </p>
            </div>
          </div>
        ) : step === 1 ? (
          <div className="wizard-page">
            <h3>Choose a safe behavior template</h3>
            <p className="help-text">
              These templates reuse routines whose behavior is safe for an
              arbitrary item ID. Healing, status-medicine, and X-stat routines
              are not offered here yet because vanilla Gen I determines parts of
              their behavior from specific item-number ranges.
            </p>

            <div className="item-template-grid">
              {TEMPLATE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    option.value === template
                      ? "item-template-option active"
                      : "item-template-option"
                  }
                  disabled={busy}
                  onClick={() => selectTemplate(option.value)}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>

            <label className="editor-field item-boolean-field wizard-key-item">
              <span>Key Item</span>
              <input
                type="checkbox"
                checked={keyItem}
                disabled={busy}
                onChange={(event) => setKeyItem(event.target.checked)}
              />
              <small>
                Templates suggest a default, but you can choose whether the new
                slot is treated as a key item.
              </small>
            </label>
          </div>
        ) : (
          <div className="wizard-page">
            <h3>Review new item</h3>
            <div className="field-grid two-column-fields">
              <div className="readonly-field">
                <span>Slot</span>
                <strong>
                  {selectedSlot
                    ? `${formatHex(selectedSlot.id)} — ${selectedSlot.constant}`
                    : "Unavailable"}
                </strong>
              </div>
              <div className="readonly-field">
                <span>New Constant</span>
                <strong>{normalizedConstant}</strong>
              </div>
              <div className="readonly-field">
                <span>Name</span>
                <strong>{name.trim()}</strong>
              </div>
              <div className="readonly-field">
                <span>Price</span>
                <strong>₽{price.toLocaleString()}</strong>
              </div>
              <div className="readonly-field">
                <span>Key Item</span>
                <strong>{keyItem ? "Yes" : "No"}</strong>
              </div>
              <div className="readonly-field">
                <span>Behavior</span>
                <strong>{selectedTemplate.label}</strong>
              </div>
            </div>

            <div className="item-routine-panel">
              <strong>Files updated atomically</strong>
              <p className="help-text">
                The wizard updates the item constant, name, price, key-item flag,
                use-routine pointer, and party/overworld menu lists together. If
                any guarded source changed after the wizard opened, creation is
                rejected instead of partially writing the item.
              </p>
            </div>

            <p className="help-text">
              This first version deliberately reuses an existing unused ID. It
              does not change <code>NUM_ITEMS</code>, elevator pseudo-items, or
              the HM/TM boundary.
            </p>
          </div>
        )}

        {error && <p className="item-compatibility-error">{error}</p>}

        <div className="wizard-actions">
          {document.slots.length > 0 && step > 0 && (
            <button type="button" onClick={back} disabled={busy}>
              Back
            </button>
          )}
          <span />
          {document.slots.length > 0 && step < 2 ? (
            <button
              type="button"
              className="primary-button"
              onClick={next}
              disabled={busy || (step === 0 && !identityValid)}
            >
              Next
            </button>
          ) : document.slots.length > 0 ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => onCreate(values)}
              disabled={busy || !identityValid}
            >
              {busy ? "Adding Item…" : "Add Item"}
            </button>
          ) : (
            <button type="button" onClick={onCancel} disabled={busy}>
              Close
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
