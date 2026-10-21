import type { FieldErrors, FormField, FormSchema } from "@axioforms/shared";

export interface FormFieldsProps {
  schema: FormSchema;
  visible: Set<string>;
  answers: Record<string, unknown>;
  setValue: (fieldId: string, value: unknown) => void;
  setFile?: (fieldId: string, file: File | null) => void;
  errors: FieldErrors;
  showAllErrors?: boolean;
}

function FieldControl({
  field,
  answers,
  setValue,
  setFile,
  error,
  describedBy,
}: {
  field: FormField;
  answers: Record<string, unknown>;
  setValue: (fieldId: string, value: unknown) => void;
  setFile?: (fieldId: string, file: File | null) => void;
  error?: string;
  describedBy?: string;
}) {
  const invalid = Boolean(error);

  if (field.type === "section") return null;

  if (field.type === "text" || field.type === "email" || field.type === "date") {
    return (
      <input
        id={`f-${field.id}`}
        type={field.type}
        value={(answers[field.id] as string) ?? ""}
        onChange={(e) => setValue(field.id, e.target.value)}
        placeholder={field.placeholder}
        required={field.required}
        minLength={field.validation?.minLength}
        maxLength={field.validation?.maxLength}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <textarea
        id={`f-${field.id}`}
        rows={4}
        value={(answers[field.id] as string) ?? ""}
        onChange={(e) => setValue(field.id, e.target.value)}
        placeholder={field.placeholder}
        maxLength={field.validation?.maxLength}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  }
  if (field.type === "number") {
    return (
      <input
        id={`f-${field.id}`}
        type="number"
        value={(answers[field.id] as number | string) ?? ""}
        onChange={(e) =>
          setValue(field.id, e.target.value === "" ? "" : Number(e.target.value))
        }
        min={field.validation?.min}
        max={field.validation?.max}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  }
  if (field.type === "select") {
    return (
      <select
        id={`f-${field.id}`}
        value={(answers[field.id] as string) ?? ""}
        onChange={(e) => setValue(field.id, e.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      >
        <option value="">— Choisir —</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "radio") {
    return (
      <div
        role="radiogroup"
        aria-label={field.label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      >
        {(field.options ?? []).map((opt) => (
          <label key={opt.value} className="choice">
            <input
              type="radio"
              name={field.id}
              value={opt.value}
              checked={answers[field.id] === opt.value}
              onChange={() => setValue(field.id, opt.value)}
            />
            {opt.label}
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "checkbox") {
    const list = (answers[field.id] as string[] | undefined) ?? [];
    return (
      <div
        role="group"
        aria-label={field.label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      >
        {(field.options ?? []).map((opt) => {
          const checked = list.includes(opt.value);
          return (
            <label key={opt.value} className="choice">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setValue(
                    field.id,
                    checked
                      ? list.filter((v) => v !== opt.value)
                      : [...list, opt.value],
                  )
                }
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    );
  }
  if (field.type === "file") {
    return (
      <input
        id={`f-${field.id}`}
        type="file"
        accept={field.validation?.acceptedMimeTypes?.join(",")}
        onChange={(e) => setFile?.(field.id, e.target.files?.[0] ?? null)}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  }
  return null;
}

export default function FormFields({
  schema,
  visible,
  answers,
  setValue,
  setFile,
  errors,
  showAllErrors = false,
}: FormFieldsProps) {
  return (
    <>
      {schema.fields.map((field) => {
        if (!visible.has(field.id)) return null;

        if (field.type === "section") {
          return (
            <section key={field.id} className="form-section" data-field={field.id}>
              <h2>{field.label}</h2>
              {field.description && <p className="muted">{field.description}</p>}
            </section>
          );
        }

        const error =
          showAllErrors || errors[field.id] ? errors[field.id] : undefined;
        const describedBy = error ? `err-${field.id}` : undefined;

        return (
          <div key={field.id} className="field" data-field={field.id}>
            {field.type !== "checkbox" && field.type !== "radio" && (
              <label htmlFor={`f-${field.id}`}>
                {field.label}
                {field.required && <span aria-hidden="true"> *</span>}
              </label>
            )}
            {field.description && (
              <p className="muted small">{field.description}</p>
            )}
            <FieldControl
              field={field}
              answers={answers}
              setValue={setValue}
              setFile={setFile}
              error={error}
              describedBy={describedBy}
            />
            {error && (
              <p className="field-error" id={`err-${field.id}`} role="alert">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
