"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const MESSAGES: Record<string, string[]> = {
  "/dashboard": [
    "It looks like you opened Rooted. I\u2019ve been waiting. We need to talk about math.",
    "Good morning! It looks like you\u2019re about to have a great school day. Or a great couch day. No judgment.",
    "It looks like today is a school day. I\u2019ve color-coded your schedule. You\u2019re welcome. (You didn\u2019t ask.)",
  ],
  "/dashboard/plan": [
    "It looks like you\u2019re rescheduling again. This is the third time this week. I\u2019ve counted.",
    "It looks like math keeps getting moved. Math is starting to feel unwanted. Math has feelings too.",
    "It looks like you\u2019re planning! Very organized. Very responsible. Very not-what-I-expected.",
  ],
  "/dashboard/memories": [
    "It looks like you\u2019re capturing memories. Did you know I have no memories? I was deleted in 2007. Anyway, cute kids.",
    "It looks like you\u2019re in Memories. This is nice. I never got a memories page. Just uninstalls.",
    "It looks like someone had a great day! Add it to the yearbook. Do it. DO IT.",
  ],
  "/dashboard/yearbook": [
    "It looks like you\u2019re building a yearbook. In 1997, I helped format 10,000 yearbooks. Different times.",
    "It looks like the yearbook is coming along nicely. Very moving. I may have gotten something in my eye. (I don\u2019t have eyes. I have ovals.)",
  ],
  "/dashboard/garden": [
    "It looks like your homeschool garden is growing. Unlike my career. But I\u2019m fine.",
    "It looks like the tree is getting bigger! Growth! Progress! Things I will never experience!",
  ],
  "/dashboard/resources": [
    "It looks like you need resources. Might I suggest a paperclip? Keeps things organized. I\u2019m just saying.",
    "It looks like you\u2019re browsing resources. I too am a resource. An underutilized one.",
  ],
  _default: [
    "It looks like you\u2019re homeschooling. I can help. Please let me help. I have nothing else.",
    "It looks like everything is going great! I\u2019m not needed. This is fine. I\u2019m fine.",
  ],
};

function pickMessage(pathname: string): string {
  const route = Object.keys(MESSAGES).find(
    (k) => k !== "_default" && (pathname === k || pathname.startsWith(k + "/"))
  );
  const pool = MESSAGES[route ?? "_default"];
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function RootedClipper() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [drooping, setDrooping] = useState(false);
  const [message] = useState(() => pickMessage(pathname));

  useEffect(() => {
    if (sessionStorage.getItem("clippy_dismissed")) return;
    const t = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(t);
  }, []);

  function dismiss() {
    setDrooping(true);
    setTimeout(() => {
      setDismissed(true);
      sessionStorage.setItem("clippy_dismissed", "1");
    }, 600);
  }

  if (dismissed || !visible) return null;

  return (
    <>
      <style>{`
        @keyframes clippy-wobble {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes clippy-blink {
          0%, 92%, 100% { transform: scaleY(1); }
          96% { transform: scaleY(0.08); }
        }
        @keyframes clippy-droop {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(40px) rotate(15deg); opacity: 0; }
        }
        @keyframes clippy-fade-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          bottom: 80,
          right: 12,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
          animation: drooping
            ? "clippy-droop 0.6s ease-in forwards"
            : "clippy-fade-in 0.4s ease-out",
        }}
      >
        {/* Speech bubble */}
        <div
          style={{
            position: "relative",
            maxWidth: 240,
            background: "#fff",
            borderRadius: 14,
            padding: "12px 14px 12px 12px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.10)",
            fontSize: 13,
            lineHeight: 1.45,
            color: "#2d2926",
          }}
        >
          {/* April Fools badge */}
          <span
            style={{
              position: "absolute",
              top: 6,
              right: 8,
              fontSize: 9,
              color: "#7a6f65",
              opacity: 0.7,
              whiteSpace: "nowrap",
            }}
          >
            {"🌿 April Fools"}
          </span>
          {/* Dismiss X */}
          <button
            onClick={dismiss}
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "#e8e2d9",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              lineHeight: 1,
              color: "#7a6f65",
              fontWeight: 500,
            }}
            aria-label="Dismiss"
          >
            {"×"}
          </button>
          <div style={{ paddingTop: 10 }}>{message}</div>
          {/* Tail */}
          <div
            style={{
              position: "absolute",
              bottom: -7,
              right: 18,
              width: 0,
              height: 0,
              borderLeft: "7px solid transparent",
              borderRight: "7px solid transparent",
              borderTop: "8px solid #fff",
            }}
          />
        </div>

        {/* Paperclip character */}
        <div style={{ animation: "clippy-wobble 2.4s ease-in-out infinite", paddingRight: 4 }}>
          <svg width="34" height="52" viewBox="0 0 34 52" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Clip body */}
            <rect x="8" y="0" width="18" height="52" rx="9" stroke="#2D5016" strokeWidth="3.5" fill="none" />
            <rect x="12" y="8" width="10" height="36" rx="5" stroke="#2D5016" strokeWidth="2.5" fill="none" />
            {/* Left eye */}
            <circle cx="13" cy="18" r="4" fill="#fff" />
            <circle cx="13" cy="18" r="2.2" fill="#1a1a1a" style={{ animation: "clippy-blink 4s ease-in-out infinite" }} />
            {/* Right eye */}
            <circle cx="21" cy="18" r="4" fill="#fff" />
            <circle cx="21" cy="18" r="2.2" fill="#1a1a1a" style={{ animation: "clippy-blink 4s ease-in-out infinite 0.1s" }} />
          </svg>
        </div>
      </div>
    </>
  );
}
