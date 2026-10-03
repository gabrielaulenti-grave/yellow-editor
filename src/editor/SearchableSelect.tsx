import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { matchesSearch } from "./search";
import "./SearchableSelect.css";

type Props = SelectHTMLAttributes<HTMLSelectElement>;
function textOf(value: ReactNode): string {
  return Children.toArray(value).map((child) => isValidElement<{ children?: ReactNode }>(child)
    ? textOf(child.props.children) : String(child)).join(" ");
}

export function SearchableSelect({ children, ...props }: Props) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [fieldLabel, setFieldLabel] = useState("options");
  const selectRef = useRef<HTMLSelectElement>(null);
  const options = Children.toArray(children);
  // Keep small controls and unfamiliar option structures as native selects.
  const searchable = props.value !== undefined && options.length > 20 && options.every((option) => isValidElement(option) && option.type === "option");
  useEffect(() => {
    const label = selectRef.current?.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
    label?.querySelectorAll(".searchable-select, select, input, button").forEach((node) => node.remove());
    setFieldLabel(label?.textContent?.trim() || "options");
  }, [props.id, props["aria-label"], searchable]);
  if (!searchable) return <select {...props} ref={selectRef}>{children}</select>;
  const selected = new Set([props.value ?? props.defaultValue].flat().map(String));
  let matched = 0;
  const filtered = options.filter((option) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode }>(option)) return false;
    const value = String(option.props.value ?? textOf(option.props.children));
    const matches = matchesSearch(query, value, textOf(option.props.children));
    if (matches) matched++;
    return matches || selected.has(value);
  });
  const selectId = props.id ?? id;
  return (
    <span className="searchable-select">
      <select {...props} id={selectId} ref={selectRef}>
        {filtered}
        {matched === 0 && <option disabled>No matching options</option>}
      </select>
      <input type="search" value={query} disabled={props.disabled}
        aria-label={`Search ${props["aria-label"] ?? fieldLabel}`} aria-controls={selectId}
        placeholder="Search options…" onChange={(event) => setQuery(event.target.value)} />
      {query.trim() && <small role="status">{matched} of {options.length} match. Current selection stays available.</small>}
    </span>
  );
}
