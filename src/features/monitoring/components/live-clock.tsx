"use client";

import { useEffect, useMemo, useState } from "react";

type LiveClockProps = {
  initialTimeLabel: string;
  timeZone?: string;
};

export function LiveClock({
  initialTimeLabel,
  timeZone = "Asia/Jakarta",
}: LiveClockProps) {
  const [timeLabel, setTimeLabel] = useState(initialTimeLabel);

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone,
      }),
    [timeZone],
  );

  useEffect(() => {
    function updateClock() {
      setTimeLabel(`${formatter.format(new Date()).replaceAll(".", ":")} WIB`);
    }

    updateClock();
    const intervalId = window.setInterval(updateClock, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [formatter]);

  return <span>{timeLabel}</span>;
}
