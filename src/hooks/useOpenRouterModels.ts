import { useState, useEffect } from "react";

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length: number;
  top_provider?: { is_moderated: boolean };
}

const CACHE_KEY = "badami_openrouter_models";
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

interface CachedData {
  models: OpenRouterModel[];
  fetchedAt: number;
}

export function useOpenRouterModels() {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Try cache first
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached: CachedData = JSON.parse(raw);
        if (Date.now() - cached.fetchedAt < CACHE_TTL) {
          setModels(cached.models);
          return;
        }
      }
    } catch {}

    // Fetch fresh
    setLoading(true);
    fetch("https://openrouter.ai/api/v1/models")
      .then((res) => res.json())
      .then((data) => {
        const list: OpenRouterModel[] = (data.data ?? [])
          .filter((m: any) => m.id && m.name)
          .sort((a: any, b: any) => a.name.localeCompare(b.name));
        setModels(list);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ models: list, fetchedAt: Date.now() }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models");
      const data = await res.json();
      const list: OpenRouterModel[] = (data.data ?? [])
        .filter((m: any) => m.id && m.name)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      setModels(list);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ models: list, fetchedAt: Date.now() }));
    } finally {
      setLoading(false);
    }
  };

  return { models, loading, refresh };
}
