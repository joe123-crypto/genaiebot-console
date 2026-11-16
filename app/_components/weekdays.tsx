"use client";
import { ALL_WEEKDAYS, WEEKDAYS } from "@/src/domains/campaign-days";

/** The weekday toggles, shared by campaign creation and the campaign picker.
 *  `allowed` narrows which days may be ticked; the rest show, disabled. */
export function Days({ value, onChange, allowed = ALL_WEEKDAYS, disabled = false, label }: {
  value: number[]; onChange: (days: number[]) => void; allowed?: number[]; disabled?: boolean; label: string;
}) {
  return <div className="campaign-weekdays" role="group" aria-label={label}>{WEEKDAYS.map((day, index) =>
    <label key={day}><input type="checkbox" checked={value.includes(index)} disabled={disabled || !allowed.includes(index)}
      onChange={(event) => onChange(event.target.checked ? [...value, index].sort() : value.filter((item) => item !== index))} />{day}</label>)}</div>;
}
