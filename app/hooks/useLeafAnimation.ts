import confetti from "canvas-confetti";

export function useLeafAnimation() {
  const triggerLeafBurst = (
    originElement?: HTMLElement | null,
    count = 1,
  ) => {
    const rect = originElement?.getBoundingClientRect();
    const x = rect
      ? (rect.left + rect.width / 2) / window.innerWidth
      : 0.5;
    const y = rect
      ? (rect.top + rect.height / 2) / window.innerHeight
      : 0.5;

    confetti({
      particleCount: count >= 5 ? 30 : 12,
      spread: 60,
      origin: { x, y },
      colors: ["#2D5A3D", "#5c7f63", "#8ab495", "#c4d4b6"],
      shapes: ["circle"],
      scalar: 1.2,
      gravity: 0.8,
      drift: 0.5,
      ticks: 80,
    });
  };

  return { triggerLeafBurst };
}
