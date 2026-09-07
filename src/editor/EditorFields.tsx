export function ReadonlyField({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <input value={value} readOnly />
    </label>
  );
}
