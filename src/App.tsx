import { useEffect, useRef, useState } from "react";
import './index.css';

// --------------------------------------------------
// CONFIG
// --------------------------------------------------
/**
 * Toggle quick‑test mode. When true each block lasts 1 minute and the
 * short‑interval rule uses a 30 s threshold. When false we use 1 h / 30 min.
 */
const TEST_MODE = false;

const BLOCK_MS = TEST_MODE ? 60_000 : 3_600_000;     // 1 min or 1 h
const THRESHOLD_MS = TEST_MODE ? 30_000 : 1_800_000; // 30 s or 30 min
const MAX_BLOCKS = 100;

// --------------------------------------------------
// Types
// --------------------------------------------------
interface Block {
  id: string;
  start: string; // ISO
  end: string;   // ISO | "" when in‑progress
  text: string;
}

interface Session {
  id: string;
  startedAt: string; // ISO
  blocks: Block[];   // newest first
}

// --------------------------------------------------
// Helpers
// --------------------------------------------------
const STORAGE_KEY = "hourly-journal-data";
const uuid = () => crypto.randomUUID();

function playTune() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    const melody = [
      { note: 523.25, duration: 0.4 }, // C5
      { note: 659.25, duration: 0.3 }, // E5
      { note: 783.99, duration: 0.3 }, // G5
      { note: 659.25, duration: 0.3 }, // E5
      { note: 880.00, duration: 0.4 }, // A5
      { note: 1046.50, duration: 0.5 }, // C6
    ];

    let time = ctx.currentTime;

    for (const { note, duration } of melody) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(note, time);

      gain.gain.setValueAtTime(0.001, time);
      gain.gain.exponentialRampToValueAtTime(0.15, time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

      osc.connect(gain).connect(ctx.destination);
      osc.start(time);
      osc.stop(time + duration);

      time += duration * 0.9; // slight overlap for smoother transitions
    }
  } catch (err) {
    console.warn('Unable to play tune', err);
  }
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: TEST_MODE ? "2-digit" : undefined,
  });

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: TEST_MODE ? "2-digit" : undefined,
  });

// --------------------------------------------------
// Component
// --------------------------------------------------
export default function HourlyJournalApp() {
  const [sessions, setSessions] = useState<Session[]>([]); // newest first
  const [isRunning, setIsRunning] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setSessions(JSON.parse(raw));
        lastSavedRef.current = raw;
      } catch {
        /* ignore corrupt data */
      }
    }
  }, []);

  useEffect(() => {
    const serialized = JSON.stringify(sessions);
    if (serialized !== lastSavedRef.current && sessions.length > 0) {
      localStorage.setItem(STORAGE_KEY, serialized);
      lastSavedRef.current = serialized;
    }
  }, [sessions]);

  // ----------------------------------
  // Timing helpers
  // ----------------------------------
  const scheduleTimers = () => {
    const now = Date.now();
    const millisPast = now % BLOCK_MS;
    let delay = BLOCK_MS - millisPast; // until next boundary
    if (delay < THRESHOLD_MS) delay += BLOCK_MS; // extend if too short

    timeoutRef.current = window.setTimeout(() => {
      onTick();
      intervalRef.current = window.setInterval(onTick, BLOCK_MS);
    }, delay);
  };

  /** Called when a block completes */
  const onTick = () => {
    playTune();
    const now = new Date();

    setSessions((prev) => {
      const [current, ...rest] = prev;
      if (!current) return prev;

      // close current in‑progress block
      const updatedBlocks = [...current.blocks];
      if (updatedBlocks.length && !updatedBlocks[0].end) {
        updatedBlocks[0] = { ...updatedBlocks[0], end: now.toISOString() };
      }

      // create new in‑progress block
      const newBlock: Block = {
        id: uuid(),
        start: now.toISOString(),
        end: "",
        text: "",
      };

      const updatedCurrent: Session = {
        ...current,
        blocks: [newBlock, ...updatedBlocks],
      };

      // trim to MAX_BLOCKS
      let excess =
        updatedCurrent.blocks.length + rest.reduce((n, s) => n + s.blocks.length, 0) -
        MAX_BLOCKS;
      const trimmedRest: Session[] = [];
      for (const s of rest) {
        if (excess <= 0) {
          trimmedRest.push(s);
          continue;
        }
        if (s.blocks.length <= excess) {
          excess -= s.blocks.length; // drop whole session
          continue;
        }
        trimmedRest.push({ ...s, blocks: s.blocks.slice(0, s.blocks.length - excess) });
        excess = 0;
      }

      return [updatedCurrent, ...trimmedRest];
    });
  };

  // ----------------------------------
  // Controls
  // ----------------------------------
  const startJournal = () => {
    if (isRunning) return;
    const now = new Date();
    const firstBlock: Block = {
      id: uuid(),
      start: now.toISOString(),
      end: "",
      text: "",
    };
    const session: Session = {
      id: uuid(),
      startedAt: now.toISOString(),
      blocks: [firstBlock],
    };
    setSessions((prev) => [session, ...prev]);
    setIsRunning(true);
    scheduleTimers();
  };

  const stopJournal = () => {
    if (!isRunning) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timeoutRef.current = intervalRef.current = null;
    setIsRunning(false);
  };

  const updateBlockText = (sid: string, bid: string, text: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sid
          ? {
              ...s,
              blocks: s.blocks.map((b) => (b.id === bid ? { ...b, text } : b)),
            }
          : s
      )
    );
  };

  const downloadData = () => {
    const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hourly-journal-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ----------------------------------
  // Rendering helpers
  // ----------------------------------
  const blockClasses = (b: Block): string => {
    const inProgress = !b.end;
    const missingText = !inProgress && b.text.trim() === "";
    if (inProgress) return "border-yellow-400 bg-yellow-50";
    if (missingText) return "border-red-400 bg-red-50";
    return "border-gray-200 bg-white";
  };

  const labelContent = (b: Block): { text: string; cls: string } | null => {
    if (!b.end) return { text: "In progress", cls: "text-yellow-600" };
    if (b.text.trim() === "") return { text: "No entry", cls: "text-red-600" };
    return null;
  };

  // ----------------------------------
  // UI
  // ----------------------------------
  return (
    <div className="min-h-screen bg-gray-50 p-4 flex flex-col items-center">
      <h1 className="text-2xl font-bold mb-4">
        Hourly Journal
        {TEST_MODE && <span className="text-sm text-orange-600 ml-2">(TEST MODE)</span>}
      </h1>

      <div className="flex gap-2 mb-6">
        {!isRunning ? (
          <button onClick={startJournal} className="px-4 py-2 bg-green-600 text-white rounded shadow hover:bg-green-700">Start</button>
        ) : (
          <button onClick={stopJournal} className="px-4 py-2 bg-red-600 text-white rounded shadow hover:bg-red-700">Stop</button>
        )}
        <button onClick={downloadData} className="px-4 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700">Download Data</button>
      </div>

      <div className="w-full max-w-3xl flex flex-col gap-6">
        {sessions.map((session) => (
          <div key={session.id} className="flex flex-col gap-4">
            <div className="text-sm font-semibold text-gray-600 border-b">Session started {formatDateTime(session.startedAt)}</div>

            {session.blocks.map((block) => {
              const label = labelContent(block);
              return (
                <div key={block.id} className={`border rounded-xl p-3 shadow-sm flex flex-col gap-2 ${blockClasses(block)}`}>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>
                      {formatTime(block.start)} – {block.end ? formatTime(block.end) : "…"}
                    </span>
                    {label && <span className={`font-semibold ${label.cls}`}>{label.text}</span>}
                  </div>

                  <textarea
                    className="w-full border rounded p-2 text-sm resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    rows={TEST_MODE ? 2 : 3}
                    placeholder="What did you do during this time block?"
                    value={block.text}
                    onChange={(e) => updateBlockText(session.id, block.id, e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
