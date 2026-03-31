import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDbStore } from "@/stores/dbStore";
import type { DbConnectionRow } from "@/types/db";

interface ConnectParams {
  connection_id: string;
  engine: string;
  host?: string | null;
  port?: number | null;
  database_name?: string | null;
  username?: string | null;
  password?: string | null;
  sqlite_file_path?: string | null;
  use_ssl?: boolean;
  ssl_mode?: string;
  ssl_ca_path?: string | null;
  tunnel_local_port?: number | null;
}

interface TestResult {
  success: boolean;
  message: string;
  latency_ms: number;
}

export function useDbConnection() {
  const {
    connections,
    loading,
    activePoolIds,
    activeConnectionId,
    activeDatabase,
    loadConnections,
    loadConnectionsByProject,
    createConnection,
    updateConnection,
    deleteConnection,
    touchConnected,
    setActiveConnection,
    setActiveDatabase,
    markPoolConnected,
    markPoolDisconnected,
    setViewMode,
  } = useDbStore();

  const [connecting, setConnecting] = useState<string | null>(null);

  const connect = useCallback(
    async (conn: DbConnectionRow, password?: string) => {
      setConnecting(conn.id);
      try {
        const params: ConnectParams = {
          connection_id: conn.id,
          engine: conn.engine,
          host: conn.host,
          port: conn.port,
          database_name: conn.database_name,
          username: conn.username,
          password: password ?? null,
          sqlite_file_path: conn.sqlite_file_path,
          use_ssl: conn.use_ssl === 1,
          ssl_mode: conn.ssl_mode,
          ssl_ca_path: conn.ssl_ca_path,
          tunnel_local_port: conn.use_ssh_tunnel === 1 ? conn.ssh_local_port : null,
        };

        const poolId = await invoke<string>("dbc_connect", { params });
        markPoolConnected(poolId);
        touchConnected(conn.id);
        setActiveConnection(conn.id);
        setViewMode("workspace");
        return poolId;
      } finally {
        setConnecting(null);
      }
    },
    [markPoolConnected, touchConnected, setActiveConnection, setViewMode],
  );

  const disconnect = useCallback(
    async (poolId: string) => {
      await invoke("dbc_disconnect", { poolId });
      markPoolDisconnected(poolId);
      if (activeConnectionId === poolId) {
        setActiveConnection(null);
        setViewMode("connections");
      }
    },
    [activeConnectionId, markPoolDisconnected, setActiveConnection, setViewMode],
  );

  const testConnection = useCallback(
    async (params: ConnectParams): Promise<TestResult> => {
      return invoke<TestResult>("dbc_test_connection", { params });
    },
    [],
  );

  const isConnected = useCallback(
    (connectionId: string) => activePoolIds.has(connectionId),
    [activePoolIds],
  );

  return {
    connections,
    loading,
    connecting,
    activeConnectionId,
    activeDatabase,
    connect,
    disconnect,
    testConnection,
    isConnected,
    loadConnections,
    loadConnectionsByProject,
    createConnection,
    updateConnection,
    deleteConnection,
    setActiveConnection,
    setActiveDatabase,
  };
}
