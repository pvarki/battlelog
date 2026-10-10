import type { ReactNode } from "react";
import { type FormConfig, fieldLabel, type VisibleField } from "./widget.ts";

// NATO Admiralty Code meanings, so a paper form is fillable without a cheat sheet.
const RELIABILITY_MEANINGS = [
  ["A", "Completely reliable"],
  ["B", "Usually reliable"],
  ["C", "Fairly reliable"],
  ["D", "Not usually reliable"],
  ["E", "Unreliable"],
  ["F", "Cannot be judged"],
] as const;
const CREDIBILITY_MEANINGS = [
  ["1", "Confirmed"],
  ["2", "Probably true"],
  ["3", "Possibly true"],
  ["4", "Doubtfully true"],
  ["5", "Improbable"],
  ["6", "Cannot be judged"],
] as const;

const Choices = ({ options }: { options: readonly (readonly [string, string?])[] }) => (
  <div className="print-choices">
    {options.map(([value, meaning]) => (
      <span key={value} className="print-choice">
        <span className="print-box" />
        <span>
          {value}
          {meaning && <span className="print-choice-meaning"> · {meaning}</span>}
        </span>
      </span>
    ))}
  </div>
);

const Comb = ({ cells, caption }: { cells: number; caption: string }) => (
  <span className="print-comb">
    <span className="print-comb-cells">
      {Array.from({ length: cells }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical empty cells
        <span key={i} />
      ))}
    </span>
    <span className="print-comb-caption">{caption}</span>
  </span>
);

const Separator = ({ children }: { children: string }) => (
  <span className="print-comb-separator">{children}</span>
);

const DateTimeCombs = () => (
  <div className="print-combs">
    <Comb cells={2} caption="DD" />
    <Separator>.</Separator>
    <Comb cells={2} caption="MM" />
    <Separator>.</Separator>
    <Comb cells={4} caption="YYYY" />
    <span style={{ width: "3mm" }} />
    <Comb cells={2} caption="HH" />
    <Separator>:</Separator>
    <Comb cells={2} caption="MM" />
  </div>
);

/** Writing surface per input kind, plus whether it needs the full row. */
const blank = (field: VisibleField): { surface: ReactNode; wide: boolean } => {
  if (field.kind === "data") {
    switch (field.input) {
      case "text":
        return { surface: <div className="print-line" />, wide: true };
      case "textarea":
        return { surface: <div className="print-area" />, wide: true };
      case "number":
        return { surface: <div className="print-line" />, wide: false };
      case "select":
        return field.options.length
          ? { surface: <Choices options={field.options.map((o) => [o])} />, wide: true }
          : { surface: <div className="print-line" />, wide: true };
      case "checkbox":
        return { surface: null, wide: false };
    }
  }
  switch (field.field) {
    case "eventTime":
      return { surface: <DateTimeCombs />, wide: false };
    case "admiraltyReliability":
      return { surface: <Choices options={RELIABILITY_MEANINGS} />, wide: true };
    case "admiraltyAccuracy":
      return { surface: <Choices options={CREDIBILITY_MEANINGS} />, wide: true };
    case "locationPoint":
      return {
        surface: (
          <div className="print-split">
            <span>Lat</span>
            <div className="print-line" />
            <span>Lng</span>
            <div className="print-line" />
          </div>
        ),
        wide: false,
      };
    default:
      return { surface: <div className="print-line" />, wide: true };
  }
};

const FieldLabel = ({ field }: { field: VisibleField }) => {
  const isCheckbox = field.kind === "data" && field.input === "checkbox";
  return (
    <div className="print-label" style={isCheckbox ? { display: "flex", gap: "2mm" } : undefined}>
      {isCheckbox && <span className="print-box" />}
      <span>
        {fieldLabel(field)}
        {field.required && <span className="print-required">*</span>}
      </span>
    </div>
  );
};

const SignoffLine = ({ label }: { label: string }) => (
  <div>
    <div className="print-line" />
    <div className="print-hint">{label}</div>
  </div>
);

/**
 * The form as a paper sheet to fill in by hand, e.g. when the network is down,
 * then typed in later. Fixed fields are submitted silently, so they don't appear.
 */
export const FormPrint = ({ fields }: Pick<FormConfig, "fields">) => {
  const visible = fields.filter((f): f is VisibleField => f.kind !== "fixed");
  const hasRequired = visible.some((f) => f.required);
  return (
    <div className="print-only">
      {hasRequired && (
        <div className="print-hint" style={{ marginBottom: "4mm" }}>
          Fields marked * are required.
        </div>
      )}
      <div className="print-form">
        {visible.map((f) => {
          const { surface, wide } = blank(f);
          return (
            <div key={f.id} className={wide ? "print-field print-field-wide" : "print-field"}>
              <FieldLabel field={f} />
              {f.description?.trim() && <div className="print-hint">{f.description}</div>}
              {surface}
            </div>
          );
        })}
      </div>
      <div className="print-signoff">
        <div className="print-label">Sign-off</div>
        <div className="print-signoff-lines">
          <SignoffLine label="Reported by" />
          <SignoffLine label="Date and time" />
          <SignoffLine label="Entered into BattleLog by" />
        </div>
      </div>
    </div>
  );
};
