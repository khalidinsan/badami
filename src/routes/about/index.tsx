import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import logoImg from "/logo.png";

export const Route = createFileRoute("/about/")({
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8">
      <div className="w-full max-w-sm space-y-8">
        {/* App identity */}
        <div className="text-center">
          <img
            src={logoImg}
            alt="Badami"
            className="mx-auto mb-4 h-14 w-auto"
          />
          <p className="mt-1 text-sm font-medium text-muted-foreground">Version 1.5.0</p>
        </div>

        {/* Description */}
        <p className="text-center text-sm leading-relaxed text-muted-foreground">
          A personal productivity desktop app — tasks, planning, notes, server
          management, credentials, and REST API tools in one place.
        </p>

        {/* Divider */}
        <div className="border-t border-border/50" />

        {/* Author */}
        <div className="space-y-3">
          <p className="text-center text-xs font-medium uppercase tracking-widest text-muted-foreground/60">
            Made by
          </p>
          <p className="text-center text-base font-semibold">Khalid</p>

          <div className="flex items-center justify-center gap-2">
            <a
              href="https://github.com/khalidinsan"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span>GitHub</span>
            </a>
            <div className="h-4 w-px bg-border" />
            <a
              href="https://instagram.com/khalidinsan"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              <span>Instagram</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
