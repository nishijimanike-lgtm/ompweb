"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  ExternalLink,
  Folder,
  Download,
  Copy,
  ChevronRight,
  Pin,
} from "lucide-react";
import { toast } from "./ui/toast";
import { useI18n } from "@/lib/i18n";
import { encodeFilePathForApi, getRelativeFilePath } from "@/lib/file-paths";
import type { SupportedOpenApp } from "@/app/api/files/open-app/route";

export interface FileExplorerContextTarget {
  name: string;
  fullPath: string;
  isDir: boolean;
}

interface Props {
  target: FileExplorerContextTarget;
  x: number;
  y: number;
  cwd: string;
  onClose: () => void;
  onOpenInNewTab: (target: FileExplorerContextTarget) => void;
  onOpenToSide: (target: FileExplorerContextTarget) => void;
}

// Custom SVGs for developer tools matching the screenshot
function VsCodeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.27a1 1 0 0 0-.005 1.517L4.1 12 .322 15.213a1 1 0 0 0 .005 1.517l1.322 1.212c.367.336.92.358 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zM18 17.597l-6.848-5.597L18 6.403v11.194z"
        fill="#007ACC"
      />
    </svg>
  );
}

function CursorIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M12 2L2 8l10 6 10-6-10-6z"
        fill="var(--text)"
        opacity="0.9"
      />
      <path
        d="M2 8v8l10 6v-8L2 8z"
        fill="var(--text)"
        opacity="0.6"
      />
      <path
        d="M22 8v8l-10 6v-8l10-6z"
        fill="var(--text)"
        opacity="0.75"
      />
    </svg>
  );
}

function ZedIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect width="24" height="24" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M6 7h12l-12 10h12"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Hash / tab icon matching the screenshot `# 在新 Tab 中打开`
function HashTabIcon({ size = 14 }: { size?: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontFamily: "var(--font-mono, monospace)",
        fontWeight: 700,
        fontSize: size * 0.95,
        color: "var(--text-muted)",
        lineHeight: 1,
        userSelect: "none",
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      #
    </span>
  );
}

export function FileExplorerContextMenu({
  target,
  x,
  y,
  cwd,
  onClose,
  onOpenInNewTab,
  onOpenToSide,
}: Props) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: y, left: x });
  const [submenuPos, setSubmenuPos] = useState<"right" | "left">("right");

  // Adjust menu position so it stays within viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const winWidth = window.innerWidth;
    const winHeight = window.innerHeight;

    let adjustedLeft = x;
    let adjustedTop = y;

    if (x + rect.width > winWidth - 8) {
      adjustedLeft = Math.max(8, winWidth - rect.width - 8);
    }
    if (y + rect.height > winHeight - 8) {
      adjustedTop = Math.max(8, winHeight - rect.height - 8);
    }

    // Determine submenu side
    const spaceOnRight = winWidth - (adjustedLeft + rect.width);
    if (spaceOnRight < 180 && adjustedLeft > 180) {
      setSubmenuPos("left");
    } else {
      setSubmenuPos("right");
    }

    setPos({ top: adjustedTop, left: adjustedLeft });
  }, [x, y]);

  // Handle outside click, scroll, and escape
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleScroll = () => {
      onClose();
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const handleOpenInApp = useCallback(
    async (app: SupportedOpenApp) => {
      onClose();
      try {
        const res = await fetch("/api/files/open-app", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: target.fullPath, app }),
        });
        const data = await res.json();
        if (data.ok) {
          toast.success(
            t("fileExplorer.openInAppSuccess", { app: data.app || app }) || `已在 ${data.app || app} 中打开`
          );
        } else {
          toast.error(
            data.error || t("fileExplorer.openInAppFailed", { error: "" }) || "打开应用失败"
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "请求失败");
      }
    },
    [target.fullPath, onClose, t]
  );

  const handleCopyRelative = useCallback(() => {
    onClose();
    const rel = getRelativeFilePath(target.fullPath, cwd);
    navigator.clipboard.writeText(rel).then(
      () => {
        toast.success(t("fileExplorer.copiedRelativePath") || "已复制相对地址");
      },
      () => {
        toast.error("复制失败");
      }
    );
  }, [target.fullPath, cwd, onClose, t]);

  const handleCopyAbsolute = useCallback(() => {
    onClose();
    navigator.clipboard.writeText(target.fullPath).then(
      () => {
        toast.success(t("fileExplorer.copiedAbsolutePath") || "已复制绝对地址");
      },
      () => {
        toast.error("复制失败");
      }
    );
  }, [target.fullPath, onClose, t]);

  const handleDownload = useCallback(() => {
    onClose();
    if (target.isDir) {
      toast.info("暂不支持直接下载文件夹");
      return;
    }
    const link = document.createElement("a");
    link.href = `/api/files/${encodeFilePathForApi(target.fullPath)}?type=download`;
    link.download = target.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [target, onClose]);

  const menuItemStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "6px 10px",
    fontSize: 12,
    color: "var(--text)",
    background: "transparent",
    border: "none",
    borderRadius: "var(--radius-control, 6px)",
    cursor: "pointer",
    textAlign: "left",
    userSelect: "none",
    whiteSpace: "nowrap",
    transition: "background var(--dur-fast, 120ms) var(--ease-out-warm)",
  };

  const appSubmenuItems: {
    key: SupportedOpenApp;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: "explorer",
      label: t("fileExplorer.appExplorer") || "资源管理器",
      icon: <Folder size={14} color="var(--accent, #3b82f6)" />,
    },
    {
      key: "vscode",
      label: "VS Code",
      icon: <VsCodeIcon size={14} />,
    },
    {
      key: "cursor",
      label: "Cursor",
      icon: <CursorIcon size={14} />,
    },
    {
      key: "zed",
      label: "Zed",
      icon: <ZedIcon size={14} />,
    },
  ];

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="File context menu"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 99999,
        minWidth: 164,
        background: "var(--bg-panel, #ffffff)",
        border: "1px solid var(--border, rgba(0, 0, 0, 0.1))",
        borderRadius: "var(--radius-card, 10px)",
        boxShadow: "var(--shadow-pop, 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1))",
        padding: 4,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        backdropFilter: "blur(12px)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 在新 Tab 中打开 */}
      <button
        type="button"
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          setSubmenuOpen(false);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        onClick={() => {
          onClose();
          onOpenInNewTab(target);
        }}
      >
        <HashTabIcon size={14} />
        <span style={{ flex: 1 }}>{t("fileExplorer.openInNewTab") || "在新 Tab 中打开"}</span>
      </button>

      {/* 在侧边打开 */}
      <button
        type="button"
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          setSubmenuOpen(false);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        onClick={() => {
          onClose();
          onOpenToSide(target);
        }}
      >
        <Folder size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{t("fileExplorer.openToSide") || "在侧边打开"}</span>
      </button>

      {/* 在应用中打开 (带子菜单) */}
      <div
        style={{ position: "relative" }}
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <button
          type="button"
          style={{
            ...menuItemStyle,
            background: submenuOpen ? "var(--bg-hover)" : "transparent",
          }}
          onClick={() => setSubmenuOpen((v) => !v)}
        >
          <ExternalLink size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{t("fileExplorer.openInApp") || "在应用中打开"}</span>
          <ChevronRight size={12} color="var(--text-dim)" style={{ flexShrink: 0 }} />
        </button>

        {/* 子菜单 */}
        {submenuOpen && (
          <div
            ref={submenuRef}
            role="menu"
            style={{
              position: "absolute",
              top: 0,
              ...(submenuPos === "right"
                ? { left: "calc(100% + 4px)" }
                : { right: "calc(100% + 4px)" }),
              minWidth: 156,
              background: "var(--bg-panel, #ffffff)",
              border: "1px solid var(--border, rgba(0, 0, 0, 0.1))",
              borderRadius: "var(--radius-card, 10px)",
              boxShadow: "var(--shadow-pop, 0 10px 25px -5px rgba(0, 0, 0, 0.15))",
              padding: 4,
              display: "flex",
              flexDirection: "column",
              gap: 1,
              zIndex: 100000,
              backdropFilter: "blur(12px)",
            }}
          >
            {appSubmenuItems.map((app) => (
              <button
                key={app.key}
                type="button"
                style={menuItemStyle}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
                onClick={() => handleOpenInApp(app.key)}
              >
                {app.icon}
                <span style={{ flex: 1 }}>{app.label}</span>
                <Pin
                  size={12}
                  color="var(--text-dim)"
                  style={{
                    flexShrink: 0,
                    opacity: 0.65,
                    transform: "rotate(45deg)",
                  }}
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 下载 (仅文件有效或置灰) */}
      <button
        type="button"
        style={{
          ...menuItemStyle,
          opacity: target.isDir ? 0.45 : 1,
          cursor: target.isDir ? "not-allowed" : "pointer",
        }}
        disabled={target.isDir}
        onMouseEnter={(e) => {
          if (!target.isDir) e.currentTarget.style.background = "var(--bg-hover)";
          setSubmenuOpen(false);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        onClick={handleDownload}
      >
        <Download size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{t("fileExplorer.download") || "下载"}</span>
      </button>

      {/* 分隔线 */}
      <div style={{ height: 1, background: "var(--border)", margin: "3px 4px" }} />

      {/* 复制相对地址 */}
      <button
        type="button"
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          setSubmenuOpen(false);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        onClick={handleCopyRelative}
      >
        <Copy size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{t("fileExplorer.copyRelativePath") || "复制相对地址"}</span>
      </button>

      {/* 复制绝对地址 */}
      <button
        type="button"
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--bg-hover)";
          setSubmenuOpen(false);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
        onClick={handleCopyAbsolute}
      >
        <Copy size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1 }}>{t("fileExplorer.copyAbsolutePath") || "复制绝对地址"}</span>
      </button>
    </div>
  );
}
