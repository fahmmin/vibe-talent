"use client";

import Link from "next/link";
import type { Project } from "@/lib/types/database";

interface ShippedTodayDialogProps {
  project: Project;
  username: string;
  onClose: () => void;
}

export function ShippedTodayDialog({ project, username, onClose }: ShippedTodayDialogProps) {
  const techStack = project.tech_stack?.slice(0, 3) ?? [];
  const description = project.description
    ? project.description.slice(0, 100) + (project.description.length > 100 ? "…" : "")
    : null;

  return (
    /* Backdrop — click outside to close */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.65)" }}
      onClick={onClose}
    >
      {/* Dialog card */}
      <div
        className="relative w-full max-w-md animate-bounce-in"
        style={{
          backgroundColor: "#FFE500",
          border: "3px solid #0F0F0F",
          boxShadow: "8px 8px 0 #0F0F0F",
        }}
        /* Stop backdrop click from closing when clicking inside */
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center font-extrabold text-lg hover:bg-black/10 transition-colors"
          style={{ border: "2px solid #0F0F0F" }}
        >
          ×
        </button>

        <div className="p-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-4xl animate-wiggle select-none" aria-hidden="true">🚀</span>
            <div>
              <h2
                className="text-xl font-extrabold uppercase leading-tight"
                style={{ color: "#0F0F0F", letterSpacing: "0.02em" }}
              >
                You Shipped in Public Today!
              </h2>
              <p className="text-sm font-bold mt-0.5" style={{ color: "#333" }}>
                Code pushed to one of your projects.
              </p>
            </div>
          </div>

          {/* Project preview card */}
          <div
            className="mb-4 p-4"
            style={{
              backgroundColor: "#fff",
              border: "2px solid #0F0F0F",
              boxShadow: "4px 4px 0 #0F0F0F",
            }}
          >
            <h3
              className="text-base font-extrabold uppercase leading-tight mb-1"
              style={{ color: "#0F0F0F" }}
            >
              {project.title}
            </h3>
            {description && (
              <p className="text-xs font-medium mb-2" style={{ color: "#444" }}>
                {description}
              </p>
            )}
            {techStack.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {techStack.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-0.5 text-[10px] font-extrabold uppercase"
                    style={{
                      backgroundColor: "#0F0F0F",
                      color: "#FFE500",
                      border: "1px solid #0F0F0F",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* CTA */}
          <Link
            href={`/profile/${username}`}
            onClick={onClose}
            className="block w-full text-center px-4 py-3 text-sm font-extrabold uppercase tracking-wide"
            style={{
              backgroundColor: "#0F0F0F",
              color: "#FFE500",
              border: "2px solid #0F0F0F",
              boxShadow: "4px 4px 0 #444",
              transition: "box-shadow 0.1s, transform 0.1s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = "2px 2px 0 #444";
              (e.currentTarget as HTMLElement).style.transform = "translate(2px, 2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = "4px 4px 0 #444";
              (e.currentTarget as HTMLElement).style.transform = "translate(0, 0)";
            }}
          >
            View Your Public Profile →
          </Link>

          {/* Footer tagline */}
          <p className="mt-3 text-xs font-bold text-center" style={{ color: "#555" }}>
            Keep the streak alive! 🔥
          </p>
        </div>

        {/* Speech-bubble notch pointing down-left */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: -18,
            left: 32,
            width: 0,
            height: 0,
            borderLeft: "12px solid transparent",
            borderRight: "0px solid transparent",
            borderTop: "18px solid #0F0F0F",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: -14,
            left: 34,
            width: 0,
            height: 0,
            borderLeft: "10px solid transparent",
            borderRight: "0px solid transparent",
            borderTop: "16px solid #FFE500",
          }}
        />
      </div>
    </div>
  );
}
