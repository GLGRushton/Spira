import { type KeyboardEvent, useMemo, useState } from "react";
import styles from "./YouTrackStateListEditor.module.css";

interface YouTrackStateListEditorProps {
  label: string;
  description: string;
  placeholder: string;
  values: string[];
  availableStates: string[];
  invalidStates: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}

const normalizeStateName = (value: string): string => value.trim().toLowerCase();

export function YouTrackStateListEditor({
  label,
  description,
  placeholder,
  values,
  availableStates,
  invalidStates,
  disabled = false,
  onChange,
}: YouTrackStateListEditorProps) {
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedStateNames = useMemo(() => new Set(values.map((state) => normalizeStateName(state))), [values]);
  const invalidStateNames = useMemo(
    () => new Set(invalidStates.map((state) => normalizeStateName(state))),
    [invalidStates],
  );
  const suggestions = useMemo(() => {
    const query = normalizeStateName(draft);
    return availableStates.filter((state) => {
      const normalizedState = normalizeStateName(state);
      if (selectedStateNames.has(normalizedState)) {
        return false;
      }

      return query.length === 0 ? true : normalizedState.includes(query);
    });
  }, [availableStates, draft, selectedStateNames]);

  const exactMatch = useMemo(() => {
    const normalizedDraft = normalizeStateName(draft);
    if (!normalizedDraft) {
      return null;
    }

    return suggestions.find((state) => normalizeStateName(state) === normalizedDraft) ?? null;
  }, [draft, suggestions]);

  const addState = (state: string) => {
    const normalizedState = normalizeStateName(state);
    if (!normalizedState || selectedStateNames.has(normalizedState)) {
      return;
    }

    onChange([...values, state]);
    setDraft("");
    setIsOpen(false);
    setActiveIndex(-1);
  };

  const removeState = (stateToRemove: string) => {
    const normalizedState = normalizeStateName(stateToRemove);
    onChange(values.filter((state) => normalizeStateName(state) !== normalizedState));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && draft.length === 0 && values.length > 0) {
      event.preventDefault();
      removeState(values[values.length - 1] ?? "");
      return;
    }

    if (!isOpen || suggestions.length === 0) {
      if (event.key === "Enter" && exactMatch) {
        event.preventDefault();
        addState(exactMatch);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }

    if (event.key === "Enter") {
      const nextState = suggestions[activeIndex] ?? exactMatch ?? suggestions[0] ?? null;
      if (nextState) {
        event.preventDefault();
        addState(nextState);
      }
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{values.length}</span>
      </div>
      <div className={styles.caption}>{description}</div>
      <div className={styles.chipList}>
        {values.length > 0 ? (
          values.map((state) => {
            const isInvalid = invalidStateNames.has(normalizeStateName(state));
            return (
              <span key={state} className={`${styles.chip} ${isInvalid ? styles.chipInvalid : ""}`}>
                <span className={styles.chipLabel}>{state}</span>
                <button
                  type="button"
                  className={styles.chipRemove}
                  onClick={() => removeState(state)}
                  disabled={disabled}
                  aria-label={`Remove ${state}`}
                >
                  Remove
                </button>
              </span>
            );
          })
        ) : (
          <div className={styles.empty}>No states selected.</div>
        )}
      </div>
      <div className={styles.inputWrap}>
        <input
          className={styles.input}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            setIsOpen(true);
            setActiveIndex(suggestions.length > 0 ? 0 : -1);
          }}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 100)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || availableStates.length === 0}
        />
        {!disabled && isOpen && availableStates.length > 0 && (draft.trim() || suggestions.length > 0) ? (
          <div className={styles.dropdown}>
            {suggestions.length > 0 ? (
              suggestions.map((state, index) => (
                <button
                  key={state}
                  type="button"
                  className={`${styles.option} ${index === activeIndex ? styles.optionActive : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    addState(state);
                  }}
                >
                  {state}
                </button>
              ))
            ) : (
              <div className={styles.helper}>No matching YouTrack states.</div>
            )}
          </div>
        ) : null}
      </div>
      {availableStates.length === 0 ? (
        <div className={styles.helper}>Connect YouTrack to load live workflow states.</div>
      ) : (
        <div className={styles.helper}>Type to filter the live states exposed by the connected YouTrack instance.</div>
      )}
    </div>
  );
}
