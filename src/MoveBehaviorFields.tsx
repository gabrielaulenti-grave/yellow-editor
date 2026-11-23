import { defaultMoveBehavior, extraEffects, type MoveBehaviorValues } from "./core/moveBehaviors";
import { isStatMoveEffect, moveStats, type MoveStatChanges } from "./core/moveStatChanges";

const statNames = ["Attack", "Defense", "Speed", "Special", "Accuracy", "Evasion"];
const statPresets: Array<{ name: string; value: MoveStatChanges }> = [
  { name: "Bulk Up", value: { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "defense", stages: 1 }] } },
  { name: "Dragon Dance", value: { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "speed", stages: 1 }] } },
  { name: "Tickle", value: { target: "opponent", changes: [{ stat: "attack", stages: -1 }, { stat: "defense", stages: -1 }] } },
  { name: "Coil", value: { target: "user", changes: [{ stat: "attack", stages: 1 }, { stat: "defense", stages: 1 }, { stat: "accuracy", stages: 1 }] } },
];

export function MoveBehaviorFields({ value, effect, reason, onChange, prefix = "Move" }: {
  value?: MoveBehaviorValues; effect: string; reason: string | null; prefix?: string;
  onChange(value: MoveBehaviorValues, move?: { effect: string; power: number }): void;
}) {
  const v = value ?? defaultMoveBehavior();
  const change = (patch: Partial<MoveBehaviorValues>) => onChange({ ...v, ...patch });
  const statGroup = v.statChanges;
  const useStats = (value: MoveStatChanges) => onChange({ ...v, counter: false, additionalEffect: null, statChanges: structuredClone(value) }, { power: 0, effect: value.changes[0].stat.toUpperCase() + (value.changes[0].stages > 0 ? "_UP1_EFFECT" : "_DOWN1_EFFECT") });
  return <fieldset className="move-behavior-fields" disabled={Boolean(reason)}>
    <legend>Special move properties</legend>
    {reason && <p className="help-text">{reason}</p>}
    <section className="move-stat-changes" aria-label={`${prefix} stat changes`}>
      <label><input aria-label={`${prefix} combined stat changes`} type="checkbox" checked={Boolean(statGroup)} onChange={e => e.target.checked ? onChange({ ...v, counter: false, additionalEffect: null, statChanges: structuredClone(statPresets[0].value) }, { power: 0, effect: isStatMoveEffect(effect) ? effect : "ATTACK_UP1_EFFECT" }) : change({ statChanges: null })} /> Combined stat changes</label>
      <p className="help-text">Changes several stats in one status move. Enabling this sets Power to 0 and selects a stat-changing battle behavior.</p>
      {statGroup && <>
        <div className="move-stat-presets">{statPresets.map(preset => <button key={preset.name} type="button" aria-label={`Use ${preset.name} stat changes`} onClick={() => useStats(preset.value)}>{preset.name}</button>)}</div>
        <label className="editor-field"><span>Recipient</span><select aria-label={`${prefix} stat recipient`} value={statGroup.target} onChange={e => change({ statChanges: { ...statGroup, target: e.target.value as MoveStatChanges["target"] } })}><option value="user">User</option><option value="opponent">Opponent</option></select></label>
        {statGroup.changes.map((row, i) => <div className="move-stat-row" key={i}>
          <label className="editor-field"><span>Stat {i + 1}</span><select aria-label={`${prefix} stat ${i + 1}`} value={row.stat} onChange={e => change({ statChanges: { ...statGroup, changes: statGroup.changes.map((item, at) => at === i ? { ...item, stat: e.target.value as typeof item.stat } : item) } })}>{moveStats.map((stat, at) => <option key={stat} value={stat} disabled={statGroup.changes.some((item, other) => other !== i && item.stat === stat)}>{statNames[at]}</option>)}</select></label>
          <label className="editor-field"><span>Stages</span><select aria-label={`${prefix} stat change ${i + 1}`} value={row.stages} onChange={e => change({ statChanges: { ...statGroup, changes: statGroup.changes.map((item, at) => at === i ? { ...item, stages: Number(e.target.value) } : item) } })}>{[2, 1, -1, -2].map(stages => <option key={stages} value={stages}>{stages > 0 ? "+" : ""}{stages} {Math.abs(stages) === 1 ? "stage" : "stages"}</option>)}</select></label>
          <button type="button" aria-label={`Remove stat change ${i + 1}`} disabled={statGroup.changes.length === 1} onClick={() => change({ statChanges: { ...statGroup, changes: statGroup.changes.filter((_, at) => at !== i) } })}>Remove</button>
        </div>)}
        <button type="button" disabled={statGroup.changes.length >= moveStats.length} onClick={() => change({ statChanges: { ...statGroup, changes: [...statGroup.changes, { stat: moveStats.find(stat => !statGroup.changes.some(row => row.stat === stat))!, stages: 1 }] } })}>Add stat change</button>
        <p className="help-text">One animation and one accuracy check for opponent moves. Stats stop at −6 and +6; other changes still apply when one stat is capped. Special is a single stat in Gen I.</p>
      </>}
    </section>
    <div className="field-grid two-column-fields">
      <label className="editor-field"><span>Turn priority</span><select aria-label={`${prefix} priority`} value={v.priority} onChange={e => change({ priority: e.target.value as MoveBehaviorValues["priority"] })}><option value="normal">Normal</option><option value="first">First (Quick Attack)</option><option value="last">Last (Counter)</option></select></label>
      <label><input aria-label={`${prefix} Counter retaliation`} type="checkbox" checked={v.counter} disabled={Boolean(statGroup)} onChange={e => change({ counter: e.target.checked })} /> Counter retaliation</label>
    </div>
    {v.counter && <p className="help-text">Uses Gen I Counter's damage and target rules. Select No additional effect; Last priority is normally used with Counter.</p>}
    {(/POISON/.test(effect) || effect === "TWINEEDLE_EFFECT" || v.additionalEffect === "POISON_SIDE_EFFECT1") && <label><input aria-label={`${prefix} badly poisoned`} type="checkbox" checked={v.badlyPoisoned} onChange={e => change({ badlyPoisoned: e.target.checked })} /> Badly poisoned (Toxic)</label>}
    {effect === "HEAL_EFFECT" && <label><input aria-label={`${prefix} Rest healing`} type="checkbox" checked={v.rest} onChange={e => change({ rest: e.target.checked })} /> Rest: fully heal, clear status and sleep</label>}
    {effect === "SPECIAL_DAMAGE_EFFECT" && <div className="field-grid two-column-fields"><label className="editor-field"><span>Special damage</span><select aria-label={`${prefix} damage mode`} value={v.damageMode} onChange={e => change({ damageMode: e.target.value as MoveBehaviorValues["damageMode"] })}><option value="level">User's level</option><option value="fixed">Fixed amount</option><option value="random">Random (Psywave)</option></select></label>{v.damageMode === "fixed" && <label className="editor-field"><span>Fixed damage</span><input aria-label={`${prefix} fixed damage`} type="number" min="1" max="255" value={Number.isFinite(v.fixedDamage) ? v.fixedDamage : ""} onChange={e => change({ fixedDamage: e.target.valueAsNumber })} /></label>}</div>}
    {effect === "RECOIL_EFFECT" && <label className="editor-field"><span>Recoil from damage dealt</span><select aria-label={`${prefix} recoil`} value={v.recoil} onChange={e => change({ recoil: e.target.value as MoveBehaviorValues["recoil"] })}><option value="quarter">25% (ordinary recoil)</option><option value="half">50% (Struggle)</option></select></label>}
    {["CHARGE_EFFECT", "FLY_EFFECT"].includes(effect) && <label className="editor-field"><span>Charging turn</span><select aria-label={`${prefix} charge mode`} value={v.charge} onChange={e => change({ charge: e.target.value as MoveBehaviorValues["charge"] })}>{[["generic", "Charging"], ["whirlwind", "Whirlwind"], ["sunlight", "Sunlight"], ["head", "Lowered head"], ["glowing", "Glowing"], ["fly", "Airborne (Fly)"], ["dig", "Underground (Dig)"]].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
    {!statGroup && <label className="editor-field"><span>Additional secondary effect</span><select aria-label={`${prefix} additional effect`} value={v.additionalEffect ?? "none"} onChange={e => change({ additionalEffect: e.target.value === "none" ? null : e.target.value as MoveBehaviorValues["additionalEffect"] })}><option value="none">None</option>{extraEffects.map((key, i) => <option key={key} value={key}>{["Poison", "Burn", "Freeze", "Paralyze", "Flinch", "Confuse", "Lower Attack", "Lower Defense", "Lower Speed", "Lower Special", "Lower Accuracy", "Lower Evasion"][i]}</option>)}</select></label>}
    {v.additionalEffect && <p className="help-text">Runs after a damaging hit if both Pokémon remain in battle. The main effect and additional effect keep their normal immunity and Substitute rules. A custom chance applies to each secondary-effect roll.</p>}
    {(/SIDE_EFFECT/.test(effect) || effect === "TWINEEDLE_EFFECT" || v.additionalEffect) && <div className="field-grid two-column-fields"><label className="editor-field"><span>Secondary-effect chance</span><select aria-label={`${prefix} chance mode`} value={v.secondaryChance === null ? "native" : "custom"} onChange={e => change({ secondaryChance: e.target.value === "native" ? null : 30 })}><option value="native">Original engine chance</option><option value="custom">Custom percentage</option></select></label>{v.secondaryChance !== null && <label className="editor-field"><span>Chance (%)</span><input aria-label={`${prefix} secondary chance`} type="number" min="0" max="100" value={Number.isFinite(v.secondaryChance) ? v.secondaryChance : ""} onChange={e => change({ secondaryChance: e.target.valueAsNumber })} /></label>}</div>}
    <p className="help-text">Settings use the project's Gen I mechanics, including their original immunity and battle rules. High critical-hit rate can be combined with these properties.</p>
  </fieldset>;
}
