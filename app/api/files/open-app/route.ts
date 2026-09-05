import { NextRequest, NextResponse } from "next/server";
import { execFileSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";

export type SupportedOpenApp = "explorer" | "vscode" | "cursor" | "zed";

const APP_NAMES: Record<SupportedOpenApp, string> = {
  explorer: "资源管理器",
  vscode: "VS Code",
  cursor: "Cursor",
  zed: "Zed",
};

function resolveExecutable(cmd: string, fallbackCandidates: string[] = []): string | null {
  const isWin = process.platform === "win32";
  const lookupTool = isWin ? "where" : "which";

  try {
    const stdout = execFileSync(lookupTool, [cmd], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const firstLine = stdout.split(/\r?\n/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {
    // Ignore lookup failures and try fallback candidates
  }

  for (const candidate of fallbackCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { filePath, app } = body as { filePath?: string; app?: SupportedOpenApp };

    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json({ ok: false, error: "Missing filePath parameter" }, { status: 400 });
    }

    if (!app || !["explorer", "vscode", "cursor", "zed"].includes(app)) {
      return NextResponse.json({ ok: false, error: "Invalid app parameter" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(filePath, allowedRoots) && !isExistingFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const isDir = stat.isDirectory();
    const isWin = process.platform === "win32";
    const isMac = process.platform === "darwin";

    if (app === "explorer") {
      if (isWin) {
        const normPath = path.win32.normalize(filePath);
        if (isDir) {
          spawn("explorer.exe", [normPath], { detached: true, stdio: "ignore" }).unref();
        } else {
          spawn("explorer.exe", [`/select,${normPath}`], { detached: true, stdio: "ignore" }).unref();
        }
      } else if (isMac) {
        if (isDir) {
          spawn("open", [filePath], { detached: true, stdio: "ignore" }).unref();
        } else {
          spawn("open", ["-R", filePath], { detached: true, stdio: "ignore" }).unref();
        }
      } else {
        // Linux
        const target = isDir ? filePath : path.dirname(filePath);
        spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
      }
      return NextResponse.json({ ok: true, app: APP_NAMES.explorer });
    }

    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    let exePath: string | null = null;

    if (app === "vscode") {
      const candidates = isWin
        ? [
            path.join(localAppData, "Programs", "Microsoft VS Code", "bin", "code.cmd"),
            path.join(programFiles, "Microsoft VS Code", "bin", "code.cmd"),
            path.join(programFilesX86, "Microsoft VS Code", "bin", "code.cmd"),
            path.join(localAppData, "Programs", "Microsoft VS Code", "Code.exe"),
            path.join(programFiles, "Microsoft VS Code", "Code.exe"),
          ]
        : [];
      exePath = resolveExecutable("code", candidates);
    } else if (app === "cursor") {
      const candidates = isWin
        ? [
            path.join(localAppData, "Programs", "cursor", "Cursor.exe"),
            path.join(localAppData, "Programs", "Cursor", "Cursor.exe"),
            path.join(localAppData, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd"),
            path.join(programFiles, "Cursor", "Cursor.exe"),
          ]
        : [];
      exePath = resolveExecutable("cursor", candidates);
    } else if (app === "zed") {
      const candidates = isWin
        ? [
            path.join(localAppData, "Programs", "Zed", "zed.exe"),
            path.join(localAppData, "Zed", "zed.exe"),
            path.join(programFiles, "Zed", "zed.exe"),
          ]
        : [];
      exePath = resolveExecutable("zed", candidates);
    }

    if (!exePath) {
      return NextResponse.json({
        ok: false,
        error: `未检测到 ${APP_NAMES[app]} 可执行文件，请确认已安装并添加到系统 PATH`,
      });
    }

    spawn(exePath, [filePath], {
      shell: isWin && (exePath.endsWith(".cmd") || exePath.endsWith(".bat")),
      detached: true,
      stdio: "ignore",
    }).unref();

    return NextResponse.json({ ok: true, app: APP_NAMES[app] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to launch application";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
