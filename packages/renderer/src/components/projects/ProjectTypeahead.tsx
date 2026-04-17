import type { YouTrackProjectSummary } from "@spira/shared";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import styles from "./ProjectTypeahead.module.css";
import { findExactProjectMatch } from "./project-utils.js";

interface ProjectTypeaheadProps {
  inputId?: string;
  value: string;
  disabled?: boolean;
  canSearch: boolean;
  onChange: (value: string) => void;
  onResolvedProjectChange: (project: YouTrackProjectSummary | null) => void;
}

const PROJECT_SUGGESTION_LIMIT = 20;

export function ProjectTypeahead({
  inputId,
  value,
  disabled = false,
  canSearch,
  onChange,
  onResolvedProjectChange,
}: ProjectTypeaheadProps) {
  const [suggestions, setSuggestions] = useState<YouTrackProjectSummary[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const exactMatch = useMemo(() => findExactProjectMatch(suggestions, value), [suggestions, value]);

  useEffect(() => {
    if (!canSearch) {
      setSuggestions([]);
      setSearchError(null);
      setIsSearching(false);
      onResolvedProjectChange(null);
      return;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      setSuggestions([]);
      setSearchError(null);
      setIsSearching(false);
      onResolvedProjectChange(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsSearching(true);
      setSearchError(null);
      void window.electronAPI
        .searchYouTrackProjects(trimmedValue, PROJECT_SUGGESTION_LIMIT)
        .then((projects) => {
          if (cancelled) {
            return;
          }

          setSuggestions(projects);
          setActiveIndex(projects.length > 0 ? 0 : -1);
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          console.error("Failed to search YouTrack projects", error);
          setSuggestions([]);
          setActiveIndex(-1);
          setSearchError(error instanceof Error ? error.message : "Failed to search YouTrack projects.");
        })
        .finally(() => {
          if (!cancelled) {
            setIsSearching(false);
          }
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [canSearch, onResolvedProjectChange, value]);

  useEffect(() => {
    onResolvedProjectChange(exactMatch);
  }, [exactMatch, onResolvedProjectChange]);

  const handleSelect = (project: YouTrackProjectSummary) => {
    onChange(project.shortName);
    onResolvedProjectChange(project);
    setSuggestions([project]);
    setActiveIndex(0);
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (event.key === "Enter" && exactMatch) {
        event.preventDefault();
        handleSelect(exactMatch);
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
      const nextProject = suggestions[activeIndex] ?? exactMatch;
      if (nextProject) {
        event.preventDefault();
        handleSelect(nextProject);
      }
      return;
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.inputWrap}>
        <input
          id={inputId}
          className={styles.input}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 100)}
          onKeyDown={handleKeyDown}
          placeholder={canSearch ? "Search YouTrack projects..." : "Connect YouTrack to search projects"}
          disabled={disabled}
        />
        {canSearch && isOpen && (isSearching || suggestions.length > 0 || searchError || value.trim()) ? (
          <div className={styles.dropdown}>
            {isSearching ? <div className={styles.helper}>Searching YouTrack projects...</div> : null}
            {!isSearching && suggestions.length > 0
              ? suggestions.map((project, index) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`${styles.option} ${index === activeIndex ? styles.optionActive : ""}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleSelect(project);
                    }}
                  >
                    <span className={styles.optionCopy}>
                      <strong className={styles.optionKey}>{project.shortName}</strong>
                      <span className={styles.optionName}>{project.name}</span>
                    </span>
                  </button>
                ))
              : null}
            {!isSearching && !searchError && suggestions.length === 0 && value.trim() ? (
              <div className={styles.helper}>No matching YouTrack projects found.</div>
            ) : null}
            {searchError ? <div className={styles.helperError}>{searchError}</div> : null}
          </div>
        ) : null}
      </div>
      {!canSearch ? <div className={styles.helper}>Connect YouTrack in Settings before mapping projects.</div> : null}
      {canSearch && exactMatch ? (
        <div className={styles.helperSuccess}>
          Verified project: {exactMatch.shortName} - {exactMatch.name}
        </div>
      ) : null}
      {canSearch && !exactMatch && !searchError && value.trim() && !isSearching ? (
        <div className={styles.helper}>Choose a matching YouTrack project before saving this mapping.</div>
      ) : null}
    </div>
  );
}
