import { createReactBlockSpec } from "@blocknote/react";
import { Video, ExternalLink } from "lucide-react";
import { useState } from "react";

function getEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.replace("www.", "");

    // YouTube
    if (h === "youtube.com" || h === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      const shorts = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shorts) return `https://www.youtube.com/embed/${shorts[1]}`;
      const live = u.pathname.match(/^\/live\/([^/?]+)/);
      if (live) return `https://www.youtube.com/embed/${live[1]}`;
    }
    if (h === "youtu.be") {
      const v = u.pathname.slice(1).split("?")[0];
      if (v) return `https://www.youtube.com/embed/${v}`;
    }

    // Vimeo
    if (h === "vimeo.com" || h === "player.vimeo.com") {
      const v = u.pathname.match(/^\/(?:video\/)?(\d+)/);
      if (v) return `https://player.vimeo.com/video/${v[1]}`;
    }

    // Dailymotion
    if (h === "dailymotion.com") {
      const v = u.pathname.match(/^\/video\/([^_/?]+)/);
      if (v) return `https://www.dailymotion.com/embed/video/${v[1]}`;
    }
    if (h === "dai.ly") {
      const v = u.pathname.slice(1).split("?")[0];
      if (v) return `https://www.dailymotion.com/embed/video/${v}`;
    }

    return null;
  } catch {
    return null;
  }
}

function detectPlatform(url: string): string {
  try {
    const h = new URL(url).hostname.replace("www.", "");
    if (h.includes("youtube") || h === "youtu.be") return "YouTube";
    if (h.includes("vimeo")) return "Vimeo";
    if (h.includes("dailymotion") || h === "dai.ly") return "Dailymotion";
    return "Video";
  } catch {
    return "Video";
  }
}

export const VideoEmbed = createReactBlockSpec(
  {
    type: "videoEmbed" as const,
    propSchema: {
      url: { default: "" },
      caption: { default: "" },
    },
    content: "none",
  } as const,
  {
    render: ({ block, editor }) => {
      const savedUrl = block.props.url;
      const embedUrl = savedUrl ? getEmbedUrl(savedUrl) : null;
      const [inputValue, setInputValue] = useState(savedUrl);
      const [isEditing, setIsEditing] = useState(!savedUrl);
      const [error, setError] = useState("");

      const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = inputValue.trim();
        if (!trimmed) return;
        const resolved = getEmbedUrl(trimmed);
        if (!resolved) {
          setError(
            "URL tidak dikenali. Masukkan link YouTube, Vimeo, atau Dailymotion.",
          );
          return;
        }
        setError("");
        editor.updateBlock(block, {
          type: "videoEmbed",
          props: { url: trimmed },
        });
        setIsEditing(false);
      };

      const handleCancel = () => {
        setInputValue(savedUrl);
        setError("");
        setIsEditing(false);
      };

      if (embedUrl && !isEditing) {
        return (
          <div className="group relative my-1 w-full">
            {/* 16:9 responsive wrapper */}
            <div className="relative overflow-hidden rounded-xl" style={{ paddingTop: "56.25%" }}>
              <iframe
                src={embedUrl}
                className="absolute inset-0 h-full w-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                title={detectPlatform(savedUrl)}
              />
            </div>

            {/* hover controls */}
            <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setInputValue(savedUrl);
                  setIsEditing(true);
                }}
                className="rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm hover:bg-black/80"
              >
                Edit URL
              </button>
              <a
                href={savedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm hover:bg-black/80"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {block.props.caption && (
              <p className="mt-1 text-center text-xs text-muted-foreground">
                {block.props.caption}
              </p>
            )}
          </div>
        );
      }

      return (
        <div className="my-1 w-full rounded-xl border border-dashed border-border bg-muted/30 p-4">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground">
            <Video className="h-4 w-4" />
            <span className="text-sm font-medium">Embed Video</span>
          </div>

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setError("");
              }}
              placeholder="Tempel link YouTube, Vimeo, atau Dailymotion…"
              type="url"
              autoFocus
            />
            <button
              type="submit"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Embed
            </button>
            {savedUrl && (
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg border border-input px-3 py-1.5 text-sm transition-colors hover:bg-muted"
              >
                Batal
              </button>
            )}
          </form>

          {error && (
            <p className="mt-1.5 text-xs text-destructive">{error}</p>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            Mendukung: YouTube, Vimeo, Dailymotion
          </p>
        </div>
      );
    },
  },
);
