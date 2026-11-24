import { describe, expect, it } from "vitest";

// React treats whatever an effect returns as its cleanup and calls it on the next re-run or unmount.
// An expression-bodied effect such as `useEffect(() => element.scrollIntoView(), [...])` returns that
// call's result; modern browsers return a Promise from scrollIntoView, so React later calls the
// Promise, throws "is not a function", and unmounts the whole app (a blank screen).
// Effects must use a block body, or return a cleanup function (`() => () => { ... }`).
const expressionBodiedEffect = /use(?:Layout|Insertion)?Effect\(\s*\(\)\s*=>\s*(?![{\s]|\(\)\s*=>)/g;

const sources = import.meta.glob<string>(["./*.ts", "./*.tsx", "!./*.test.ts"], { query: "?raw", import: "default", eager: true });

describe("React effects", () => {
  it("never return the value of an expression as their cleanup", () => {
    expect(Object.keys(sources)).toContain("./features.tsx");
    const offenders = Object.entries(sources).flatMap(([file, source]) =>
      [...source.matchAll(expressionBodiedEffect)].map((match) => `${file}:${source.slice(0, match.index).split("\n").length}`));
    expect(offenders).toEqual([]);
  });
});
