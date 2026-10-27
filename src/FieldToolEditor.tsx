import { PlayerConditionEditor } from "./PlayerConditionEditor";
import { fieldActions, normalFieldBadge, validateFieldTool, type FieldToolValues, type FieldToolSupport } from "./core/fieldTools";
import { conditionBadges } from "./core/playerConditions";

export function fieldToolError(value: FieldToolValues, support?: FieldToolSupport): string | null {
  if (!support || support.reason) return support?.reason ?? "Field tool sources are unavailable.";
  try { validateFieldTool(value, support.domains); return null; } catch (e) { return String(e); }
}
export function FieldToolEditor({ value, support, disabled = false, onChange }: { value: FieldToolValues; support?: FieldToolSupport; disabled?: boolean; onChange(value: FieldToolValues): void }) {
  const error = fieldToolError(value, support);
  const update = (patch: Partial<FieldToolValues>) => onChange({ ...value, ...patch });
  return <fieldset className="field-tool-editor" disabled={disabled || Boolean(support?.reason)}><legend>Field tool</legend>
    <div className="field-grid two-column-fields">
      <label className="editor-field">Field action<select aria-label="Field action" value={value.action} onChange={e => update({ action: e.target.value as FieldToolValues["action"], allFlyDestinations: false })}>{fieldActions.map(a => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}</select></label>
      <label className="editor-field">Required badge<select aria-label="Required badge" value={value.badge ?? ""} onChange={e => update({ badge: e.target.value || null })}><option value="">None</option>{conditionBadges.map(b => <option key={b} value={b}>{b.toLowerCase()} badge{normalFieldBadge[value.action] === b ? " (normal requirement)" : ""}</option>)}</select></label>
    </div>
    <label className="editor-field item-boolean-field"><span>Require a party Pokémon knowing {value.action.toUpperCase()}</span><input aria-label="Require the party move" type="checkbox" checked={value.requireMove} onChange={e => update({ requireMove: e.target.checked })} /></label>
    <p className="help-text">With no badge or party requirement, this works with an empty party. Map permissions and valid targets still apply. Strength lasts until the native map reset; Flash lights the current map. Cut uses the game's existing cuttable trees and grass.</p>
    <label className="editor-field item-boolean-field"><span>Consume one item after successful use</span><input aria-label="Consume field tool" type="checkbox" checked={value.consume} onChange={e => update({ consume: e.target.checked })} /></label>
    {value.action === "fly" && <label className="editor-field item-boolean-field"><span>Offer all native Fly destinations</span><input aria-label="All Fly destinations" type="checkbox" checked={value.allFlyDestinations} onChange={e => update({ allFlyDestinations: e.target.checked })} /><small>Otherwise only visited towns appear. This does not mark destinations visited. Cancelling never consumes the item.</small></label>}
    <label className="editor-field item-boolean-field"><span>Additional player condition</span><input aria-label="Additional field tool condition" type="checkbox" checked={Boolean(value.condition)} onChange={e => update({ condition: e.target.checked ? { kind: "hall-of-fame" } : null })} /></label>
    {value.condition && support && <PlayerConditionEditor value={value.condition} domains={support.domains} busy={disabled} label="Field tool condition" onChange={condition => update({ condition })} />}
    <div className="field-grid two-column-fields">{(["success", "invalid", "requirement", "cancel"] as const).map(key => <label className="editor-field" key={key}>{({ success: "Activation message", invalid: "Invalid location or target", requirement: "Missing requirements", cancel: "Cancellation message" })[key]}<textarea aria-label={`Field tool ${key} message`} rows={2} value={value.messages[key].join("\n")} onChange={e => update({ messages: { ...value.messages, [key]: e.target.value.split("\n") } })} /></label>)}</div>
    <p className="help-text">Use &lt;PLAYER&gt; for the player's name and &lt;ITEM&gt; for this item's current in-game name. Up to 18 spaces on the first row and 17 on later rows. Reusable is the default; invalid uses and cancellation leave the bag unchanged.</p>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
