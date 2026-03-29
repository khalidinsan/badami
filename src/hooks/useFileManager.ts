import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { v4 as uuidv4 } from "uuid";
import type { FileEntry } from "@/types/server";
import type { ServerCredentialRow } from "@/types/db";
import * as serverQueries from "@/db/queries/servers";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export type FileManagerStatus = "idle" | "connecting" | "connected" | "disconnected";

interface TransferItem {
  id: string;
  direction: "upload" | "download";
  localPath: string;
  remotePath: string;
  fileName: string;
  progress: number;
  status: "pending" | "transferring" | "completed" | "failed";
  error?: string;
}

interface UseFileManagerOptions {
  server: ServerCredentialRow;
}

async function notifyTransfer(direction: "upload" | "download", fileName: string) {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({
        title: direction === "upload" ? "Upload Complete" : "Download Complete",
        body: fileName,
      });
    }
  } catch { /* notification not critical */ }
}

export function useFileManager({ server }: UseFileManagerOptions) {
  const [status, setStatus] = useState<FileManagerStatus>("idle");
  const [sessionId] = useState(() => uuidv4());
  const [currentPath, setCurrentPath] = useState(server.initial_directory || "/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const statusRef = useRef<FileManagerStatus>("idle");

  const isSSH = server.protocol === "ssh";
  const isFTP = server.protocol === "ftp" || server.protocol === "ftps";

  const updateStatus = useCallback((s: FileManagerStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // Connect
  const connect = useCallback(async () => {
    if (statusRef.current === "connecting" || statusRef.current === "connected") return;
    updateStatus("connecting");

    try {
      let password: string | undefined;
      let pemContent: string | undefined;
      let passphrase: string | undefined;

      if (isSSH) {
        // SFTP uses the same auth as SSH
        if (server.auth_type === "password") {
          password = await invoke<string>("get_server_password", { serverId: server.id });
        } else if (server.auth_type === "pem_file" && server.pem_file_path) {
          const { readTextFile } = await import("@tauri-apps/plugin-fs");
          pemContent = await readTextFile(server.pem_file_path);
        } else if (server.auth_type === "pem_saved" && server.pem_key_id) {
          const pemKey = await serverQueries.getPemKeyById(server.pem_key_id);
          if (pemKey) {
            pemContent = await invoke<string>("decrypt_pem_key", {
              encryptedData: pemKey.encrypted_data,
              iv: pemKey.iv,
            });
          }
        } else if (server.auth_type === "pem_passphrase" && server.pem_file_path) {
          const { readTextFile } = await import("@tauri-apps/plugin-fs");
          pemContent = await readTextFile(server.pem_file_path);
          try {
            passphrase = await invoke<string>("get_server_passphrase", { serverId: server.id });
          } catch { /* might not be saved */ }
        }

        await invoke("sftp_connect", {
          sessionId,
          host: server.host,
          port: server.port,
          username: server.username,
          authType: server.auth_type,
          password: password ?? null,
          pemContent: pemContent ?? null,
          passphrase: passphrase ?? null,
        });
      } else if (isFTP) {
        password = await invoke<string>("get_server_password", { serverId: server.id }).catch(() => "");
        await invoke("ftp_connect", {
          sessionId,
          host: server.host,
          port: server.port,
          username: server.username,
          password: password ?? null,
          useTls: server.protocol === "ftps",
        });
      }

      updateStatus("connected");
      serverQueries.touchServerConnected(server.id);

      // Load initial directory
      await listDir(server.initial_directory || "/");
    } catch (err) {
      updateStatus("disconnected");
      throw err;
    }
  }, [sessionId, server, isSSH, isFTP, updateStatus]);

  // Disconnect
  const disconnect = useCallback(async () => {
    try {
      if (isSSH) {
        await invoke("sftp_disconnect", { sessionId });
      } else if (isFTP) {
        await invoke("ftp_disconnect", { sessionId });
      }
    } catch { /* ignore */ }
    updateStatus("disconnected");
  }, [sessionId, isSSH, isFTP, updateStatus]);

  // List directory
  const listDir = useCallback(async (path: string) => {
    setLoading(true);
    try {
      let result: FileEntry[];
      if (isSSH) {
        result = await invoke<FileEntry[]>("sftp_list_dir", { sessionId, path });
      } else {
        result = await invoke<FileEntry[]>("ftp_list_dir", { sessionId, path });
      }
      setEntries(result);
      setCurrentPath(path);
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, [sessionId, isSSH]);

  // Navigate into a directory
  const navigateTo = useCallback(async (path: string) => {
    await listDir(path);
  }, [listDir]);

  // Go up one directory
  const navigateUp = useCallback(async () => {
    if (currentPath === "/") return;
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    await listDir(parent);
  }, [currentPath, listDir]);

  // Create directory
  const mkdir = useCallback(async (name: string) => {
    const newPath = currentPath.endsWith("/")
      ? `${currentPath}${name}`
      : `${currentPath}/${name}`;
    if (isSSH) {
      await invoke("sftp_mkdir", { sessionId, path: newPath });
    } else {
      await invoke("ftp_mkdir", { sessionId, path: newPath });
    }
    await listDir(currentPath);
  }, [sessionId, currentPath, isSSH, listDir]);

  // Rename
  const rename = useCallback(async (oldPath: string, newName: string) => {
    const parent = oldPath.replace(/\/[^/]+\/?$/, "") || "/";
    const newPath = parent.endsWith("/")
      ? `${parent}${newName}`
      : `${parent}/${newName}`;
    if (isSSH) {
      await invoke("sftp_rename", { sessionId, oldPath, newPath });
    } else {
      await invoke("ftp_rename", { sessionId, oldPath, newPath });
    }
    await listDir(currentPath);
  }, [sessionId, currentPath, isSSH, listDir]);

  // Delete file
  const deleteFile = useCallback(async (path: string) => {
    if (isSSH) {
      await invoke("sftp_delete_file", { sessionId, path });
    } else {
      await invoke("ftp_delete_file", { sessionId, path });
    }
    await listDir(currentPath);
  }, [sessionId, currentPath, isSSH, listDir]);

  // Delete directory
  const deleteDir = useCallback(async (path: string) => {
    if (isSSH) {
      await invoke("sftp_rmdir", { sessionId, path });
    } else {
      await invoke("ftp_rmdir", { sessionId, path });
    }
    await listDir(currentPath);
  }, [sessionId, currentPath, isSSH, listDir]);

  // Read text file (SFTP only)
  const readFile = useCallback(async (path: string): Promise<string> => {
    if (!isSSH) throw new Error("Read file only supported via SFTP");
    return await invoke<string>("sftp_read_file", { sessionId, path });
  }, [sessionId, isSSH]);

  // Write text file (SFTP only)
  const writeFile = useCallback(async (path: string, content: string) => {
    if (!isSSH) throw new Error("Write file only supported via SFTP");
    await invoke("sftp_write_file", { sessionId, path, content });
  }, [sessionId, isSSH]);

  // Download file
  const download = useCallback(async (remotePath: string, localPath: string) => {
    const transferId = uuidv4();
    const fileName = remotePath.split("/").pop() || "file";

    const item: TransferItem = {
      id: transferId,
      direction: "download",
      localPath,
      remotePath,
      fileName,
      progress: 0,
      status: "transferring",
    };
    setTransfers((prev) => [...prev, item]);

    const unlisten = await listen<{ progress: number }>(
      `transfer-progress-${transferId}`,
      (event) => {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, progress: event.payload.progress }
              : t,
          ),
        );
      },
    );

    try {
      if (isSSH) {
        await invoke("sftp_download", { sessionId, remotePath, localPath, transferId });
      } else {
        await invoke("ftp_download", { sessionId, remotePath, localPath, transferId });
      }
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId ? { ...t, status: "completed", progress: 100 } : t,
        ),
      );
      serverQueries.createTransferEntry({
        server_id: server.id,
        direction: "download",
        local_path: localPath,
        remote_path: remotePath,
        file_size: null,
        status: "completed",
      }).catch(() => {});
      notifyTransfer("download", fileName);
    } catch (err) {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? { ...t, status: "failed", error: String(err) }
            : t,
        ),
      );
      serverQueries.createTransferEntry({
        server_id: server.id,
        direction: "download",
        local_path: localPath,
        remote_path: remotePath,
        file_size: null,
        status: "failed",
        error_message: String(err),
      }).catch(() => {});
      throw err;
    } finally {
      unlisten();
    }
  }, [sessionId, isSSH, server.id]);

  // Upload file
  const upload = useCallback(async (localPath: string, remotePath: string) => {
    const transferId = uuidv4();
    const fileName = localPath.split("/").pop() || "file";

    const item: TransferItem = {
      id: transferId,
      direction: "upload",
      localPath,
      remotePath,
      fileName,
      progress: 0,
      status: "transferring",
    };
    setTransfers((prev) => [...prev, item]);

    const unlisten = await listen<{ progress: number }>(
      `transfer-progress-${transferId}`,
      (event) => {
        setTransfers((prev) =>
          prev.map((t) =>
            t.id === transferId
              ? { ...t, progress: event.payload.progress }
              : t,
          ),
        );
      },
    );

    try {
      if (isSSH) {
        await invoke("sftp_upload", { sessionId, localPath, remotePath, transferId });
      } else {
        await invoke("ftp_upload", { sessionId, localPath, remotePath, transferId });
      }
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId ? { ...t, status: "completed", progress: 100 } : t,
        ),
      );
      serverQueries.createTransferEntry({
        server_id: server.id,
        direction: "upload",
        local_path: localPath,
        remote_path: remotePath,
        file_size: null,
        status: "completed",
      }).catch(() => {});
      notifyTransfer("upload", fileName);
      // Refresh current dir in case uploaded file is here
      await listDir(currentPath);
    } catch (err) {
      setTransfers((prev) =>
        prev.map((t) =>
          t.id === transferId
            ? { ...t, status: "failed", error: String(err) }
            : t,
        ),
      );
      serverQueries.createTransferEntry({
        server_id: server.id,
        direction: "upload",
        local_path: localPath,
        remote_path: remotePath,
        file_size: null,
        status: "failed",
        error_message: String(err),
      }).catch(() => {});
      throw err;
    } finally {
      unlisten();
    }
  }, [sessionId, isSSH, currentPath, listDir, server.id]);

  // Refresh
  const refresh = useCallback(async () => {
    await listDir(currentPath);
  }, [currentPath, listDir]);

  // Clear completed transfers
  const clearCompletedTransfers = useCallback(() => {
    setTransfers((prev) => prev.filter((t) => t.status === "transferring" || t.status === "pending"));
  }, []);

  // Auto-disconnect on unmount
  useEffect(() => {
    return () => {
      if (statusRef.current === "connected") {
        if (isSSH) {
          invoke("sftp_disconnect", { sessionId }).catch(() => {});
        } else if (isFTP) {
          invoke("ftp_disconnect", { sessionId }).catch(() => {});
        }
      }
    };
  }, [sessionId, isSSH, isFTP]);

  return {
    status,
    sessionId,
    currentPath,
    entries,
    loading,
    transfers,
    connect,
    disconnect,
    navigateTo,
    navigateUp,
    mkdir,
    rename,
    deleteFile,
    deleteDir,
    readFile,
    writeFile,
    download,
    upload,
    refresh,
    clearCompletedTransfers,
  };
}

export type { TransferItem };
