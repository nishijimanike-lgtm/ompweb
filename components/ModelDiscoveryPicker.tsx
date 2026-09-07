"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/primitives";
import { formatCompactNumber } from "@/lib/format";
import { Search, Loader2, Download, CheckSquare, Square } from "lucide-react";
import type { ProviderEntry, DiscoveredModelEntry } from "./ModelsConfig-types";

/**
 * Fetch the current model list served by a custom provider's endpoint (via
 * /api/models-config/discover, which runs an isolated omp discovery probe) and
 * let the user pick which ones to pin into providers.<name>.models.
 */

interface ModelDiscoveryPickerProps {
  open: boolean;
  providerName: string;
  provider: ProviderEntry;
  existingIds: ReadonlySet<string>;
  onAdd: (models: DiscoveredModelEntry[]) => void;
  onClose: () => void;
}

type DiscoverPhase =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; models: DiscoveredModelEntry[]; endpoint: string }
  | { phase: "error"; message: string };

export function ModelDiscoveryPicker({ open, providerName, provider, existingIds, onAdd, onClose }: ModelDiscoveryPickerProps) {
  const { t } = useI18n();
  const [state, setState] = useState<DiscoverPhase>({ phase: "idle" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const fetchSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    // Capture the provider snapshot for this fetch (the caller keeps editing
    // elsewhere is unlikely while the dialog is up, but never fire a stale one).
    const seq = ++fetchSeq.current;
    setState({ phase: "loading" });
    setQuery("");
    setSelected(new Set());
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/models-config/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            providerName,
            provider: {
              ...provider,
              // models are irrelevant to the probe
              models: undefined,
            },
          }),
          signal: controller.signal,
        });
        const data = await res.json() as { ok?: boolean; models?: DiscoveredModelEntry[]; endpoint?: string; error?: string };
        if (fetchSeq.current !== seq) return;
        if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        const models = (data.models ?? []).filter((m) => m && typeof m.id === "string" && !existingIds.has(m.id));
        setState({ phase: "ready", models, endpoint: data.endpoint ?? provider.baseUrl ?? "" });
        setSelected(new Set(models.map((m) => m.id)));
      } catch (e) {
        if (fetchSeq.current !== seq) return;
        if ((e as Error).name !== "AbortError") {
          setState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => { controller.abort(); };
    // existingIds intentionally excluded: re-adding an already-pinned model is
    // a no-op guarded below, and depending on it would refetch on every add.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, providerName, provider.baseUrl, provider.api, provider.apiKey, provider.auth]);

  const filtered = useMemo(() => {
    if (state.phase !== "ready") return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.models;
    return state.models.filter((m) =>
      m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q),
    );
  }, [state, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const rowStyle: React.CSSProperties = {
    display: "flex", flexDirection: "row", alignItems: "center", gap: 10,
    padding: "9px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-control)",
    marginBottom: 6,
    minWidth: 0,
    cursor: "pointer",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        ariaLabel={t("modelsConfig.importAvailableModels")}
        style={{
          width: 720,
          maxWidth: "min(92vw, 720px)",
          maxHeight: "min(76dvh, calc(100dvh - 32px))",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <DialogTitle style={{ margin: "14px 18px 4px", fontSize: 16 }}>
          {t("modelsConfig.importAvailableModels")}
        </DialogTitle>
        <p style={{ margin: "0 18px 10px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t("modelsConfig.importAvailableModelsDesc")}
        </p>

        {state.phase === "ready" && state.endpoint && (
          <div style={{ padding: "0 18px 8px", fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("modelsConfig.discoveryEndpointsNote", { endpoint: state.endpoint })}
          </div>
        )}

        {/* Filter + count toolbar */}
        {state.phase === "ready" && (
          <div style={{ padding: "4px 18px 12px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, padding: "6px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", minWidth: 0 }}>
              <Search size={13} style={{ color: "var(--text-dim)", flexShrink: 0 }} aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label={t("modelsConfig.discoverySearchPlaceholder")}
                placeholder={t("modelsConfig.discoverySearchPlaceholder")}
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, boxSizing: "border-box", minWidth: 0 }}
              />
            </div>
            <button
              type="button"
              onClick={() => setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((m) => m.id)))}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, flexShrink: 0 }}
            >
              {allFilteredSelected ? <CheckSquare size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
              {t("modelsConfig.discoverySelectAll")}
            </button>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 18px 14px" }}>
          {state.phase === "loading" ? (
            <div role="status" aria-live="polite" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "36px 0", fontSize: 12, color: "var(--text-dim)" }}>
              <Loader2 size={14} className="icon-spin" aria-hidden="true" /> {t("modelsConfig.discoveryFetching")}
            </div>
          ) : state.phase === "error" ? (
            <div role="alert" style={{ padding: "20px 0", fontSize: 12, color: "var(--status-error)", textAlign: "center", lineHeight: 1.6 }}>
              {t("modelsConfig.discoveryFetchFailed", { error: state.message })}
            </div>
          ) : state.phase === "ready" && state.models.length === 0 ? (
            <div style={{ padding: "20px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
              {t("modelsConfig.discoveryNoModels")}
            </div>
          ) : state.phase === "ready" && filtered.length === 0 ? (
            <div style={{ padding: "20px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>
              {t("modelsConfig.catalogNoResults")}
            </div>
          ) : state.phase === "ready" ? (
            filtered.map((m) => {
              const checked = selected.has(m.id);
              return (
                <div key={m.id} style={rowStyle} role="checkbox" aria-checked={checked} onClick={() => toggle(m.id)}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(m.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 14, height: 14, accentColor: "var(--accent)", flexShrink: 0, cursor: "pointer" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.id}</span>
                      {m.reasoning && (
                        <span style={{ fontSize: 9, padding: "1px 4px", background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", borderRadius: 3, flexShrink: 0 }}>T</span>
                      )}
                    </div>
                    {m.name && (
                      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                    )}
                  </div>
                  {m.contextWindow !== undefined ? (
                    <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
                      {t("modelsConfig.catalogContext", { n: formatCompactNumber(m.contextWindow) })}
                    </span>
                  ) : null}
                </div>
              );
            })
          ) : null}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {state.phase === "ready" ? (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("modelsConfig.discoverySelectedCount", { count: selected.size })}</span>
          ) : <span />}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}
            >
              {t("modelsConfig.cancel")}
            </button>
            <button
              type="button"
              disabled={state.phase !== "ready" || selected.size === 0}
              onClick={() => {
                if (state.phase !== "ready") return;
                const picked = state.models.filter((m) => selected.has(m.id));
                onAdd(picked);
                onClose();
              }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 14px", background: "var(--accent)", border: "none", borderRadius: 6,
                color: "var(--on-accent)", cursor: state.phase === "ready" && selected.size > 0 ? "pointer" : "default",
                fontSize: 13, fontWeight: 600, opacity: state.phase === "ready" && selected.size > 0 ? 1 : 0.5,
              }}
            >
              <Download size={13} aria-hidden="true" />
              {t("modelsConfig.discoveryAddSelected", { count: selected.size })}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
