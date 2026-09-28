"use client";

import * as React from "react";
import { greeting } from "@/lib/greeting";

/**
 * "Good morning, Shahriar Ahmed". Rendered on the server for the first paint,
 * then kept current while the page stays open (morning turns to afternoon).
 */
export function Greeting({ name, timeZone, initial }: { name: string; timeZone: string; initial: string }) {
  const [text, setText] = React.useState(initial);
  React.useEffect(() => {
    const update = () => setText(greeting(timeZone));
    const first = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [timeZone]);
  return (
    <>
      {text}
      {name ? `, ${name}` : ""}
    </>
  );
}
